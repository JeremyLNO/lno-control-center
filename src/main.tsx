import React from 'react'
import * as ReactDOM from 'react-dom/client'
import './index.css'
import type { DataStatus } from './types'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  FUND_PALETTE, PERMISSIONS, ALL_PERMS, ROLE_PERMS, ROLE_OPTIONS, WA_MSG_TYPES, WA_ROLE_COLS, fmtUSD, fmtSigned, fmtNum, fmtPct, fmtPctPlain, clsPnl, fmtPrice, fmtDate, fmtAgo, fmtTime, fmtDT, fmtDur, initialsOf, DAY, NOW, baseOf, TOKEN_KEY, getToken, setToken, PREF, GOOGLE_CLIENT_ID, downloadBlob, b64ToBlob, toCSV, exportRows, api, _toastSubs, toast, Toaster, ICONS, Icon, GOLD, LNO_PATH, Logo, Card, SectionTitle, Btn, Badge, darken, StatusPill, Toggle, Select, Field, Input, ExportMenu, Modal, Confirm, AreaChart, App, useApp, hasPerm, fundOf, sliceByPeriod, riskMetrics, ExposureBars, RiskPanel, Underwater, PnlCalendar, LiveBadge, MarketTicker, LoadingScreen, Login, MAIN_NAV, TOOLS_NAV, ADMIN_NAV, ACCT_NAV, NavItem, Sidebar, GlobalSearch, Header, MobileNav, PageHead, Denied, KpiCard, TrendBadge, SortHeader, sortRows, EmptyState, SideTag, FundTag, PeriodControls, OnboardingCard
} from './ui'
import {
  ActivityPage, RealtimePage, TradesPage, AdminUsers, AdminExchanges, AdminOpenWA,
  FundsPage, BotsPage, ProfilePage, SupportPage, PricesPage, StatusPage, AdminReports
} from './pages/index'

/* ============================================================
   ROUTER + ROOT
   ============================================================ */
function useHashRoute(){
  const parse=()=>{ let h=window.location.hash.replace(/^#/,'')||'/activity'; const [path,query]=h.split('?'); const parts=path.split('/').filter(Boolean); const params=Object.fromEntries(new URLSearchParams(query||'')); return {parts,params}; };
  const [route,setRoute]=useState(parse);
  useEffect(()=>{ const h=()=>setRoute(parse()); window.addEventListener('hashchange',h); return ()=>window.removeEventListener('hashchange',h); },[]);
  return route;
}

/* Real data: fetch bots + funds + snapshots on login; refresh bots/live every ~30s.
   Builds the derived `data` shape the UI reads, plus the funds array + a reload(). */
function useData(authed){
  const [raw,setRaw]=useState(null);     // { bots, live }
  const [funds,setFunds]=useState([]);
  const [snaps,setSnaps]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(null);

  const loadBots=useCallback(async()=>{ const r=await api('bots'); setRaw({bots:r.bots||[],live:r.live||null}); return r; },[]);
  const loadFunds=useCallback(async()=>{ const r=await api('funds'); setFunds(r.funds||[]); return r.funds; },[]);
  const loadSnaps=useCallback(async()=>{ const r=await api('snapshots'); setSnaps(r.snapshots||[]); return r.snapshots; },[]);
  // reloadData: re-fetch everything (used after sync / fund or bot mutations).
  const reloadData=useCallback(async()=>{ try{ await Promise.all([loadBots(),loadFunds(),loadSnaps()]); setError(null); }catch(e){ setError(e); } },[loadBots,loadFunds,loadSnaps]);

  useEffect(()=>{
    if(!authed){ setRaw(null); setFunds([]); setSnaps([]); setLoading(true); return; }
    let alive=true; setLoading(true);
    Promise.allSettled([loadBots(),loadFunds(),loadSnaps()]).then(rs=>{ if(!alive)return; const bad=rs.find(x=>x.status==='rejected'); setError(bad?bad.reason:null); setLoading(false); });
    return ()=>{alive=false;};
  },[authed,loadBots,loadFunds,loadSnaps]);

  // poll positions/live every 30s (snapshots/funds change rarely)
  useEffect(()=>{ if(!authed)return; const iv=setInterval(()=>{ loadBots().catch(e=>setError(e)); },30000); return ()=>clearInterval(iv); },[authed,loadBots]);

  const data=useMemo(()=>{
    if(!raw) return null;
    const bots=raw.bots, live=raw.live;
    const series=snaps.map(s=>({t:new Date(s.day+'T00:00:00Z').getTime(), equity:s.equity, pnlDay:s.pnlDay, metrics:s.metrics}));
    const lastSnapEq=series.length? series[series.length-1].equity : 0;
    const equity = (live&&live.equity!=null)? live.equity : lastSnapEq;
    const openBots=bots.filter(b=>b.status==='open');
    const unassigned=openBots.filter(b=>b.fundId==null);
    // group ALL bots (open+closed) by fund for counts/PnL; uPnl/notional reflect open ones.
    const map=new Map(funds.map(f=>[f.id,{...f,bots:[],uPnl:0,notional:0}]));
    const unb={id:null,name:'Unassigned',color:null,bots:[],uPnl:0,notional:0};
    bots.forEach(b=>{ const g=(b.fundId&&map.get(b.fundId))||unb; g.bots.push(b); if(b.status==='open'){ g.uPnl+=b.unrealizedPnl||0; g.notional+=Math.abs(b.notional||0); } });
    const byFund=[...map.values()]; if(unb.bots.length) byFund.push(unb);
    return { bots, live, series, equity, openBots, unassigned, byFund, loading, error };
  },[raw,funds,snaps,loading,error]);

  const dataStatus: DataStatus = error? 'partial' : (raw&&raw.live&&raw.live.connected>0)? (raw.live.errors? 'partial':'live') : 'offline';
  return { data, funds, setFunds, reloadData, reloadFunds:loadFunds, dataStatus };
}

// Global keyboard navigation: `g` then a letter jumps between pages, `/` focuses
// search, `?` toggles help. Ignored while typing in a field (except Escape).
function useKeyboardNav(navigate,user){
  const [help,setHelp]=useState(false);
  useEffect(()=>{
    let gPending=false, gTimer=null;
    const isTyping=(el)=>el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.tagName==='SELECT'||el.isContentEditable);
    const onKey=(e)=>{
      if(e.metaKey||e.ctrlKey||e.altKey) return;
      const typing=isTyping(document.activeElement);
      if(e.key==='Escape'){ setHelp(false); if(typing)(document.activeElement as HTMLElement).blur(); return; }
      if(typing) return;
      if(e.key==='?'){ e.preventDefault(); setHelp(h=>!h); return; }
      if(e.key==='/'){ e.preventDefault(); const s=document.querySelector('input[placeholder^="Search positions"]'); if(s)(s as HTMLElement).focus(); return; }
      if(gPending){
        gPending=false; clearTimeout(gTimer); const k=e.key.toLowerCase();
        const go={a:'/activity',r:'/realtime',t:'/trades',f:'/funds',s:'/status'}[k];
        const adminGo={b:'/admin/bots',u:'/admin/users',e:'/admin/exchanges',w:'/admin/openwa'}[k];
        if(go){ e.preventDefault(); navigate(go); }
        else if(adminGo&&user.role==='admin'){ e.preventDefault(); navigate(adminGo); }
        return;
      }
      if(e.key==='g'){ gPending=true; gTimer=setTimeout(()=>{gPending=false;},1200); }
    };
    window.addEventListener('keydown',onKey);
    return ()=>{ window.removeEventListener('keydown',onKey); clearTimeout(gTimer); };
  },[navigate,user]);
  return {help,setHelp};
}
function ShortcutsModal({open,onClose,isAdmin}: any){
  const rows=[
    ['g a','Activity Dashboard'],['g r','Live'],['g t','Positions'],['g f','Funds'],['g s','System Status'],
    ...(isAdmin?[['g b','Admin · Bots'],['g u','Admin · Users'],['g e','Admin · Exchanges'],['g w','Admin · WhatsApp']]:[]),
    ['/','Focus search'],['?','Toggle this help'],['Esc','Close / blur field'],
  ];
  return <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
      {rows.map(([k,d])=><div key={k} className="flex items-center justify-between gap-3 py-1">
        <span className="text-sm text-slate-600">{d}</span>
        <span className="flex gap-1">{k.split(' ').map((part,i)=><kbd key={i} className="px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[11px] font-mono text-navy">{part}</kbd>)}</span>
      </div>)}
    </div>
    <div className="text-[11px] text-slate-400 mt-4">Press <kbd className="px-1 rounded bg-slate-100 border border-slate-200 font-mono">g</kbd> then a letter to jump between pages.</div>
  </Modal>;
}

function Shell(){
  const {route,navigate,user}=useApp();
  const {help,setHelp}=useKeyboardNav(navigate,user);
  const [a,b]=route.parts;
  let page;
  if(a==='activity') page=<ActivityPage/>;
  else if(a==='realtime') page=<RealtimePage/>;
  else if(a==='prices') page=<PricesPage/>;
  else if(a==='trades') page=<TradesPage/>;
  else if(a==='funds') page=<FundsPage/>;
  else if(a==='status') page=<StatusPage/>;
  else if(a==='admin'&&b==='bots') page=<BotsPage/>;
  else if(a==='admin'&&b==='users') page=<AdminUsers/>;
  else if(a==='admin'&&b==='exchanges') page=<AdminExchanges/>;
  else if(a==='admin'&&(b==='openwa'||b==='whatsapp')) page=<AdminOpenWA/>;
  else if(a==='admin'&&b==='funds') page=<FundsPage/>;
  else if(a==='admin'&&b==='reports') page=<AdminReports/>;
  else if(a==='profile') page=<ProfilePage/>;
  else if(a==='support') page=<SupportPage/>;
  else page=<ActivityPage/>;
  return <div className="flex h-full">
    <Sidebar/>
    <div className="flex-1 flex flex-col min-w-0">
      <Header/>
      <main className="flex-1 overflow-y-auto p-4 lg:p-6 pb-20 lg:pb-6">{page}</main>
      <MobileNav/>
    </div>
    <ShortcutsModal open={help} onClose={()=>setHelp(false)} isAdmin={user.role==='admin'}/>
  </div>;
}

function Root(){
  const route=useHashRoute();
  const [user,setUser]=useState(null);
  const [booting,setBooting]=useState(true);
  const {data,funds,setFunds,reloadData,reloadFunds,dataStatus}=useData(!!user);

  // restore session from the JWT on load
  useEffect(()=>{
    let alive=true;
    (async()=>{
      if(!getToken()){ if(alive){setBooting(false);} return; }
      try{ const r=await api('auth'); if(alive) setUser(r.user); }
      catch(e){ setToken(null); }
      finally{ if(alive) setBooting(false); }
    })();
    return ()=>{alive=false;};
  },[]);

  // graceful session expiry: any 401 with a token -> sign out + tell the user
  useEffect(()=>{
    const onUnauth=()=>{ if(getToken()){ setToken(null); setUser(null); window.location.hash='#/activity'; toast.error('Session expired — please sign in again.'); } };
    window.addEventListener('lno:unauthorized', onUnauth);
    return ()=>window.removeEventListener('lno:unauthorized', onUnauth);
  },[]);

  // presence heartbeat: keep last-seen fresh so the admin Users page shows who's online
  useEffect(()=>{
    if(!user) return;
    const ping=()=>api('auth',{method:'POST',body:{action:'heartbeat'}}).catch(()=>{});
    const iv=setInterval(ping,60000);
    return ()=>clearInterval(iv);
  },[user]);

  async function login(email,password){
    const r=await api('auth',{method:'POST',body:{action:'login',email,password}});
    setToken(r.token); setUser(r.user); return r.user;
  }
  async function loginGoogle(credential){
    const r=await api('auth',{method:'POST',body:{action:'google',credential}});
    setToken(r.token); setUser(r.user); return r.user;
  }
  function logout(){ api('auth',{method:'POST',body:{action:'logout'}}).catch(()=>{}); setToken(null); setUser(null); window.location.hash='#/activity'; }
  function navigate(to){ window.location.hash='#'+to; }

  const ctx={route,navigate,user,setUser,login,loginGoogle,logout,api,funds,setFunds,reloadFunds,reloadData,data,dataStatus};

  const content = booting ? <LoadingScreen/>
    : !user ? <Login/>
    : !data ? <LoadingScreen/>
    : <Shell/>;
  return <App.Provider value={ctx}>{content}<Toaster/></App.Provider>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root/>);
