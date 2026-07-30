import React from 'react'
import * as ReactDOM from 'react-dom/client'
import './index.css'
import type { DataStatus, Lang } from './types'
import { SUPPORTED_LANGS, detectBrowserLang, translate } from './i18n'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  FUND_PALETTE, ROLE_OPTIONS, WA_MSG_TYPES, WA_ROLE_COLS, fmtUSD, fmtSigned, fmtNum, fmtPct, fmtPctPlain, clsPnl, fmtPrice, fmtDate, fmtAgo, fmtTime, fmtDT, fmtDur, fmtSeconds, initialsOf, DAY, NOW, baseOf, TOKEN_KEY, getToken, setToken, PREF, GOOGLE_CLIENT_ID, consumeGoogleRedirectCallback, downloadBlob, b64ToBlob, toCSV, exportRows, api, _toastSubs, toast, Toaster, ICONS, Icon, GOLD, LNO_PATH, Logo, Card, SectionTitle, Btn, Badge, darken, StatusPill, Toggle, Select, Field, Input, ExportMenu, Modal, Confirm, AreaChart, App, useApp, hasPerm, fundOf, sliceByPeriod, riskMetrics, ExposureBars, RiskPanel, Underwater, PnlCalendar, PositionsHeatmap, LiveBadge, MarketTicker, LoadingScreen, Loader, Login, MAIN_NAV, TOOLS_NAV, ADMIN_NAV, ACCT_NAV, NavItem, Sidebar, GlobalSearch, Header, MobileNav, PageHead, Denied, KpiCard, TrendBadge, SortHeader, sortRows, EmptyState, SideTag, FundTag, PeriodControls, OnboardingCard
} from './ui'
import {
  ActivityPage, RealtimePage, TradesPage, AdminUsers, RulesPage, AdminExchanges, AdminOpenWA,
  AnalysisPage, PlaybookPage, AnomaliesPage, CalendarPage, PositionPage, GuidePage, FundsPage, BotsPage, ProfilePage, MyEquityPage, EmployeeFundPage, SupportPage, PricesPage, StatusPage, AdminReports, AuditPage
} from './pages/index'

/* ============================================================
   ROUTER + ROOT
   ============================================================ */
// Mobile app bridge: the iOS Control Center app opens this site inside an
// ASWebAuthenticationSession with ?mobile_redirect=<scheme>://<path> so it can reuse
// this exact login page (incl. the real Google Sign-In button) with zero extra Google
// Cloud config. On a successful login we hand the fresh JWT to that custom scheme
// instead of rendering the dashboard; a plain browser visit (no param) is unaffected.
function mobileHandoff(token: string, explicitRedirect?: string|null){
  // explicitRedirect covers the Google classic-redirect flow: by the time Google's
  // own redirect lands back on us, the original ?mobile_redirect= query param is
  // long gone (replaced by whatever redirect_uri we gave Google), so that value
  // travels in Google's `state` param instead — see consumeGoogleRedirectCallback.
  const redirect=explicitRedirect||new URLSearchParams(window.location.search).get('mobile_redirect');
  if(!redirect) return false;
  window.location.href = redirect+(redirect.includes('?')?'&':'?')+'token='+encodeURIComponent(token);
  return true;
}
function useHashRoute(){
  const parse=()=>{ let h=window.location.hash.replace(/^#/,'')||'/activity'; const [path,query]=h.split('?'); const parts=path.split('/').filter(Boolean); const params=Object.fromEntries(new URLSearchParams(query||'')); return {parts,params}; };
  const [route,setRoute]=useState(parse);
  useEffect(()=>{ const h=()=>setRoute(parse()); window.addEventListener('hashchange',h); return ()=>window.removeEventListener('hashchange',h); },[]);
  return route;
}

/* Real data: fetch bots + funds + snapshots on login; refresh bots/live every ~30s.
   Builds the derived `data` shape the UI reads, plus the funds array + a reload().
   When the logged-in user is an admin, that 30s refresh also triggers a REAL re-sync
   from the exchange first (not just a re-read of whatever's cached) — this is what
   keeps exchange-derived numbers (positions, equity) genuinely live rather than stuck
   at whatever the last manual "Sync now" click or the once-daily cron last recorded.
   Non-admins still get the 30s cache refresh unchanged; the sync action itself stays
   admin-gated (see api/bots.js) so a lower-privileged or shareholder tab can never
   trigger a live signed Binance call. */
const DATA_REFRESH_MS=30000;
function useData(authed,isAdmin){
  const [raw,setRaw]=useState(null);     // { bots, live }
  const [funds,setFunds]=useState([]);
  const [snaps,setSnaps]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(null);
  // bumped on every successful refreshLive (interval-driven, WS-triggered, or manual) so
  // pages can show a "time until next refresh" progress bar that restarts on ANY real
  // refresh, not just the fixed-interval ones — see RefreshBar in ui.tsx.
  const [refreshTick,setRefreshTick]=useState(0);

  const loadBots=useCallback(async()=>{ const r=await api('bots'); setRaw({bots:r.bots||[],live:r.live||null}); return r; },[]);
  const loadFunds=useCallback(async()=>{ const r=await api('funds'); setFunds(r.funds||[]); return r.funds; },[]);
  const loadSnaps=useCallback(async()=>{ const r=await api('snapshots'); setSnaps(r.snapshots||[]); return r.snapshots; },[]);
  // refreshLive: what the 30s poll (and the initial load) actually calls — re-syncs from
  // the exchange first when the viewer is an admin, then re-reads bots/live either way.
  const refreshLive=useCallback(async()=>{
    if(isAdmin){ try{ await api('bots',{method:'POST',body:{action:'sync'}}); }catch(e){ /* best-effort — a failed sync shouldn't block reading whatever's cached */ } }
    const r=await loadBots();
    setRefreshTick(x=>x+1);
    return r;
  },[isAdmin,loadBots]);
  // reloadData: re-fetch everything (used after sync / fund or bot mutations).
  const reloadData=useCallback(async()=>{ try{ await Promise.all([refreshLive(),loadFunds(),loadSnaps()]); setError(null); }catch(e){ setError(e); } },[refreshLive,loadFunds,loadSnaps]);

  useEffect(()=>{
    if(!authed){ setRaw(null); setFunds([]); setSnaps([]); setLoading(true); return; }
    let alive=true; setLoading(true);
    Promise.allSettled([refreshLive(),loadFunds(),loadSnaps()]).then(rs=>{ if(!alive)return; const bad=rs.find(x=>x.status==='rejected'); setError(bad?bad.reason:null); setLoading(false); });
    return ()=>{alive=false;};
  },[authed,refreshLive,loadFunds,loadSnaps]);

  // poll positions/live every 30s (snapshots/funds change rarely) — kept as a fallback net
  // even with the WebSocket below, in case that connection is silently stuck.
  useEffect(()=>{ if(!authed)return; const iv=setInterval(()=>{ refreshLive().catch(e=>setError(e)); },DATA_REFRESH_MS); return ()=>clearInterval(iv); },[authed,refreshLive]);

  // True real-time trigger: an admin session opens Binance's private user-data WebSocket via
  // a short-lived listenKey (minted server-side — see api/bots.js — the account's actual key
  // + secret never leave the server, only this scoped, revocable, time-limited token does).
  // Rather than re-deriving balances/positions from Binance's raw WS payload client-side
  // (duplicating the margin/liquidation/notional math that already lives, tested, in
  // api/_lib/binance.js), any message on it is treated as "something changed, re-sync now" —
  // reuses the exact same REST sync pipeline, just triggered within ~1-2s of a real change
  // instead of waiting for the 30s fallback poll above.
  useEffect(()=>{
    if(!authed||!isAdmin) return;
    let stopped=false, ws: WebSocket|null=null, keepaliveIv: any=null, reconnectTimer: any=null, debounceTimer: any=null;
    let reconnectDelay=2000, lastSyncAt=0;

    const triggerSync=()=>{
      const now=Date.now(), gap=now-lastSyncAt;
      if(gap>2000){ lastSyncAt=now; refreshLive().catch(()=>{}); }
      else { clearTimeout(debounceTimer); debounceTimer=setTimeout(()=>{ lastSyncAt=Date.now(); refreshLive().catch(()=>{}); },2000-gap); }
    };
    const scheduleReconnect=()=>{
      if(stopped) return;
      reconnectTimer=setTimeout(connect,reconnectDelay);
      reconnectDelay=Math.min(reconnectDelay*2,30000);
    };
    async function connect(){
      if(stopped) return;
      try{
        const r=await api('bots?listenKey=1');
        if(stopped||!r.wsUrl) { scheduleReconnect(); return; }
        ws=new WebSocket(r.wsUrl);
        ws.onopen=()=>{ reconnectDelay=2000; };
        ws.onmessage=()=>{ triggerSync(); };
        ws.onclose=()=>{ if(!keepaliveIv)return; clearInterval(keepaliveIv); keepaliveIv=null; scheduleReconnect(); };
        ws.onerror=()=>{ try{ ws&&ws.close(); }catch(e){} };
        keepaliveIv=setInterval(()=>{ api('bots',{method:'POST',body:{action:'listenKeyKeepAlive'}}).catch(()=>{}); },30*60*1000);
      }catch(e){ scheduleReconnect(); }
    }
    connect();
    return ()=>{
      stopped=true;
      if(ws){ try{ ws.close(); }catch(e){} }
      if(keepaliveIv) clearInterval(keepaliveIv);
      if(reconnectTimer) clearTimeout(reconnectTimer);
      if(debounceTimer) clearTimeout(debounceTimer);
    };
  },[authed,isAdmin,refreshLive]);

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
  return { data, funds, setFunds, reloadData, reloadFunds:loadFunds, dataStatus, refreshTick, refreshMs:DATA_REFRESH_MS };
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
  useEffect(()=>{
    if(!user) return;
    const key='guide_seen_'+user.id;
    if(PREF.get(key,false)) return;
    PREF.set(key,true);
    navigate('/guide');
  },[user]);
  const {help,setHelp}=useKeyboardNav(navigate,user);
  const [a,b]=route.parts;
  let page;
  if(a==='activity') page=<ActivityPage/>;
  else if(a==='realtime') page=<RealtimePage/>;
  else if(a==='prices') page=<PricesPage/>;
  else if(a==='trades') page=<TradesPage/>;
  else if(a==='analysis') page=<AnalysisPage/>;
  else if(a==='playbook') page=<PlaybookPage/>;
  else if(a==='anomalies') page=<AnomaliesPage/>;
  else if(a==='calendar') page=<CalendarPage/>;
  else if(a==='position') page=<PositionPage/>;
  else if(a==='guide') page=<GuidePage/>;
  else if(a==='funds') page=<FundsPage/>;
  else if(a==='status') page=<StatusPage/>;
  else if(a==='admin'&&b==='bots') page=<BotsPage/>;
  else if(a==='admin'&&b==='users') page=<AdminUsers/>;
  else if(a==='admin'&&b==='rules') page=<RulesPage/>;
  else if(a==='admin'&&b==='exchanges') page=<AdminExchanges/>;
  else if(a==='admin'&&(b==='openwa'||b==='whatsapp')) page=<AdminOpenWA/>;
  else if(a==='admin'&&b==='funds') page=<FundsPage/>;
  else if(a==='admin'&&b==='reports') page=<AdminReports/>;
  else if(a==='admin'&&b==='audit') page=<AuditPage/>;
  else if(a==='profile') page=<ProfilePage/>;
  else if(a==='equity') page=<MyEquityPage/>;
  else if(a==='admin'&&b==='employee-fund') page=<EmployeeFundPage/>;
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

// No component in this tree ever threw during normal development, so there was never an
// error boundary — meaning any future render-time exception unmounts straight to a blank
// #root with nothing in the console to explain why. This surfaces it instead of hiding it.
class ErrorBoundary extends React.Component<{children:any},{error:any}>{
  constructor(props:any){ super(props); this.state={error:null}; }
  static getDerivedStateFromError(error:any){ return {error}; }
  componentDidCatch(error:any, info:any){ console.error('App crashed:', error, info && info.componentStack); }
  render(){
    if(this.state.error){
      const e=this.state.error;
      return <div style={{padding:24,fontFamily:'monospace',whiteSpace:'pre-wrap',color:'#DC2626',background:'#FEF2F2',minHeight:'100vh'}}>
        <h2 style={{marginBottom:8}}>Something went wrong.</h2>
        <div>{String(e&&e.message||e)}</div>
        <div style={{marginTop:12,fontSize:12,color:'#64748B'}}>{e&&e.stack}</div>
      </div>;
    }
    return this.props.children;
  }
}

function Root(){
  // Must run before useHashRoute's own lazy parse of window.location.hash — this
  // strips Google's raw id_token out of the hash first so the router never sees it.
  const [googleCallback]=useState(consumeGoogleRedirectCallback);
  const route=useHashRoute();
  const [user,setUser]=useState(null);
  const [booting,setBooting]=useState(true);
  const {data,funds,setFunds,reloadData,reloadFunds,dataStatus,refreshTick,refreshMs}=useData(!!user,!!(user&&user.role==='admin'));

  // Global period filter — rendered once in Header rather than per-page (was Activity-page-
  // local); persisted the same way the old page-local version was, just under a shared key.
  const [period,setPeriod]=useState<string>(()=>PREF.get('global_period','90'));
  const [custom,setCustom]=useState<{start:number|null;end:number|null}>({start:null,end:null});
  useEffect(()=>{ PREF.set('global_period',period); },[period]);

  // Language: defaults to the browser's language; once a user explicitly picks one (the
  // sidebar switcher), it's persisted both locally (instant on next visit, incl. logged out)
  // and server-side on their account (users.language) — so it's also their default on any
  // other client reading the same account, e.g. the iOS app.
  const [lang,setLangState]=useState<Lang>(()=>(PREF.get('lang',null) as Lang)||detectBrowserLang());
  useEffect(()=>{ if(user&&user.language&&SUPPORTED_LANGS.includes(user.language)&&user.language!==lang){ setLangState(user.language); PREF.set('lang',user.language); } },[user]);
  async function setLang(l: Lang){
    setLangState(l); PREF.set('lang',l);
    if(user){ try{ const r=await api('profile',{method:'PATCH',body:{language:l}}); setUser(r.user); }catch(e){ toast.error(e.message); } }
  }
  const t=useCallback((key: string, vars?: Record<string,string|number>)=>translate(lang,key,vars),[lang]);

  // restore session from the JWT on load — except for the iOS app's mobile
  // handoff flow (?mobile_redirect=…): the user just tapped "Sign in with
  // Google" on the *native* login screen, often right after signing out of
  // the app itself, expecting a fresh sign-in. Silently restoring whatever
  // session happens to be cached in this shared ASWebAuthenticationSession
  // web view (e.g. from a previous handoff, or from browsing cc.lno.company
  // directly on the same device) would skip Login/the Google redirect
  // entirely and hand back a stale identity instead of authenticating
  // whoever is actually sitting at the phone right now.
  useEffect(()=>{
    let alive=true;
    (async()=>{
      if(new URLSearchParams(window.location.search).get('mobile_redirect')){
        setToken(null); setBooting(false); return;
      }
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
    setToken(r.token); setUser(r.user); mobileHandoff(r.token); return r.user;
  }
  async function loginGoogle(credential){
    const r=await api('auth',{method:'POST',body:{action:'google',credential}});
    setToken(r.token); setUser(r.user); mobileHandoff(r.token); return r.user;
  }
  // Finishes the classic-redirect Google flow the iOS app's login page kicks off
  // (see startGoogleRedirectFlow in ui.tsx) — same backend verification as the
  // regular button/One-Tap credential, just delivered via a redirect instead.
  useEffect(()=>{
    if(!googleCallback) return;
    (async()=>{
      try{
        const r=await api('auth',{method:'POST',body:{action:'google',credential:googleCallback.idToken}});
        setToken(r.token); setUser(r.user);
        if(googleCallback.redirect) mobileHandoff(r.token, googleCallback.redirect);
      }catch(e){ toast.error(e.message||'Google sign-in failed'); }
    })();
  },[googleCallback]);
  function logout(){ api('auth',{method:'POST',body:{action:'logout'}}).catch(()=>{}); setToken(null); setUser(null); window.location.hash='#/activity'; }
  function navigate(to){ window.location.hash='#'+to; }

  const ctx={route,navigate,user,setUser,login,loginGoogle,logout,api,funds,setFunds,reloadFunds,reloadData,data,dataStatus,refreshTick,refreshMs,period,setPeriod,custom,setCustom,lang,setLang,t};

  const content = booting ? <LoadingScreen/>
    : !user ? <Login/>
    : !data ? <LoadingScreen/>
    : <Shell/>;
  return <App.Provider value={ctx}>{content}<Toaster/></App.Provider>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<ErrorBoundary><Root/></ErrorBoundary>);
