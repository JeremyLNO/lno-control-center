import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  FUND_PALETTE, PERMISSIONS, ALL_PERMS, ROLE_PERMS, ROLE_OPTIONS, WA_MSG_TYPES, WA_ROLE_COLS, fmtUSD, fmtSigned, fmtNum, fmtPct, fmtPctPlain, clsPnl, fmtPrice, fmtDate, fmtAgo, fmtTime, fmtDT, fmtDur, initialsOf, DAY, NOW, baseOf, TOKEN_KEY, getToken, setToken, PREF, GOOGLE_CLIENT_ID, downloadBlob, b64ToBlob, toCSV, exportRows, api, _toastSubs, toast, Toaster, ICONS, Icon, GOLD, LNO_PATH, Logo, Card, SectionTitle, Btn, Badge, darken, StatusPill, Toggle, Select, Field, Input, ExportMenu, Modal, Confirm, AreaChart, App, useApp, hasPerm, fundOf, sliceByPeriod, riskMetrics, ExposureBars, RiskPanel, Underwater, PnlCalendar, LiveBadge, MarketTicker, LoadingScreen, Login, MAIN_NAV, TOOLS_NAV, ADMIN_NAV, ACCT_NAV, NavItem, Sidebar, GlobalSearch, Header, MobileNav, PageHead, Denied, KpiCard, TrendBadge, SortHeader, sortRows, EmptyState, SideTag, FundTag, PeriodControls, OnboardingCard
} from './ui.jsx'

function ActivityPage(){
  const {funds,navigate,user,data}=useApp();
  const [period,setPeriod]=useState(()=>PREF.get('activity_period2','90'));
  const [custom,setCustom]=useState({start:null,end:null});
  useEffect(()=>{ PREF.set('activity_period2',period); },[period]);
  if(!hasPerm(user,'view_activity')) return <Denied/>;

  const {series,equity,openBots,byFund,bots}=data;
  const view=sliceByPeriod(series,period,custom);            // real equity history, sliced
  const hasHistory=series.length>=2;
  const periodPnl = view.length>1? view[view.length-1].equity-view[0].equity : 0;
  const periodPnlPct = view.length>1&&view[0].equity? periodPnl/view[0].equity*100 : 0;
  const positive = periodPnl>=0;

  // PnL day = last snapshot's pnlDay (or last-2 snapshots delta as fallback)
  const lastSnap = series.length? series[series.length-1] : null;
  const pnlDay = lastSnap&&lastSnap.pnlDay!=null? lastSnap.pnlDay
    : series.length>=2? series[series.length-1].equity-series[series.length-2].equity : 0;
  const openPnl = openBots.reduce((a,b)=>a+(b.unrealizedPnl||0),0);
  const exposure = openBots.reduce((a,b)=>a+Math.abs(b.notional||0),0);
  const fundsWithExposure = byFund.filter(f=>f.id!=null);  // real funds (drop the Unassigned bucket from this list view)

  const empty = !hasHistory && !openBots.length;

  return <div>
    <PageHead title="Activity Dashboard" subtitle="Portfolio performance across all funds"
      actions={hasHistory&&<PeriodControls {...{period,setPeriod,custom,setCustom}}/>}/>

    <OnboardingCard/>
    <MarketTicker/>

    {empty? <EmptyState icon="dollar" title="No positions yet"
        hint="Connect an exchange and run a sync — your account equity, positions and funds will appear here automatically."
        action={user.role==='admin'&&<Btn onClick={()=>navigate('/admin/exchanges')}><Icon name="link" className="w-4 h-4"/>Connect an exchange</Btn>}/>
    : <>
      {/* Hero: account equity + KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <KpiCard label="Account Equity" value={fmtUSD(equity)} icon="dollar"/>
        <KpiCard label="PnL Day" value={<span className={clsPnl(pnlDay)}>{fmtSigned(pnlDay)}</span>} badge={equity?<TrendBadge pct={pnlDay/equity*100}/>:null}/>
        <KpiCard label="Open PnL" value={<span className={clsPnl(openPnl)}>{fmtSigned(openPnl)}</span>}/>
        <KpiCard label="Exposure" value={fmtUSD(exposure)} icon="briefcase"/>
        <KpiCard label="Open / Funds" value={`${openBots.length} / ${fundsWithExposure.length||funds.length}`} icon="layers"/>
      </div>

      {/* Equity curve */}
      <Card className="p-5 mb-5">
        <SectionTitle right={hasHistory&&<span className={`text-sm font-semibold ${clsPnl(periodPnl)}`}>{fmtSigned(periodPnl)} <span className="tnum">({fmtPct(periodPnlPct)})</span> this period</span>}>Equity Curve</SectionTitle>
        {hasHistory? <>
          <AreaChart data={view} positive={positive} resetKey={`${period}|${custom.start||''}`}/>
          <div className="flex justify-between text-[11px] text-slate-400 mt-1"><span>{view.length?fmtDate(view[0].t):''}</span><span>{view.length?fmtDate(view[view.length-1].t):''}</span></div>
        </> : <div className="h-[180px] grid place-items-center text-center text-sm text-slate-400">No equity history yet — the daily sync records one snapshot per day.</div>}
      </Card>

      {/* By-fund breakdown */}
      <Card className="overflow-hidden mb-5">
        <div className="p-5 pb-3"><SectionTitle>By Fund</SectionTitle></div>
        {byFund.length===0? <div className="px-5 pb-5 text-sm text-slate-400">No funds yet.</div>
        : <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
            <th className="px-4 py-2.5 text-left font-medium">Fund</th>
            <th className="px-4 py-2.5 text-right font-medium">Open PnL</th>
            <th className="px-4 py-2.5 text-right font-medium">Exposure</th>
            <th className="px-4 py-2.5 text-right font-medium">Positions</th>
          </tr></thead>
          <tbody>
            {byFund.map(f=><tr key={f.id||'unassigned'} className="border-b border-slate-50 hover:bg-slate-50/60">
              <td className="px-4 py-2.5"><span className="flex items-center gap-2">{f.id!=null?<span className="w-2.5 h-2.5 rounded-full" style={{background:f.color}}/>:<span className="w-2.5 h-2.5 rounded-full border border-slate-300"/>}<span className={f.id!=null?'font-medium text-navy':'text-slate-500'}>{f.name}</span></span></td>
              <td className={`px-4 py-2.5 text-right tnum ${clsPnl(f.uPnl)}`}>{fmtSigned(f.uPnl)}</td>
              <td className="px-4 py-2.5 text-right tnum text-slate-500">{fmtUSD(f.notional)}</td>
              <td className="px-4 py-2.5 text-right tnum">{f.bots.length}</td>
            </tr>)}
          </tbody>
        </table></div>}
      </Card>

      {/* Risk & exposure (only meaningful with history/exposure) */}
      {(hasHistory||openBots.length>0)&&<div className="mb-5"><RiskPanel series={view.length?view:series} openBots={openBots} byFund={byFund}/></div>}

      {/* Drawdown + PnL calendar (need history) */}
      {hasHistory&&<div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <Card className="p-5"><SectionTitle right={<span className="text-[11px] text-slate-400">underwater</span>}>Drawdown</SectionTitle><Underwater series={view}/></Card>
        <Card className="p-5"><SectionTitle right={<span className="text-[11px] text-slate-400">daily</span>}>PnL Calendar</SectionTitle><PnlCalendar series={view}/></Card>
      </div>}

      {/* Open positions snapshot */}
      <Card className="overflow-hidden">
        <div className="p-5 pb-0"><SectionTitle right={<button onClick={()=>navigate(hasPerm(user,'view_realtime')?'/realtime':'/trades')} className="text-xs text-gold hover:underline">View all</button>}>Open Positions</SectionTitle></div>
        {openBots.length===0? <div className="p-8 text-center text-slate-400 text-sm">No open positions.</div>
        : <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
            <th className="px-3 py-2.5 text-left font-medium">Symbol</th><th className="px-3 py-2.5 text-left font-medium">Side</th>
            <th className="px-3 py-2.5 text-left font-medium">Fund</th>
            <th className="px-3 py-2.5 text-right font-medium">Open PnL</th><th className="px-3 py-2.5 text-right font-medium hidden sm:table-cell">Notional</th>
            <th className="px-3 py-2.5 text-right font-medium hidden md:table-cell">Lev</th>
          </tr></thead>
          <tbody>
            {openBots.slice(0,10).map(b=>{ const f=fundOf(funds,b); return <tr key={b.id} className="border-b border-slate-50 hover:bg-slate-50/60">
              <td className="px-3 py-2.5 font-mono text-xs text-navy">{b.symbol}</td>
              <td className="px-3 py-2.5"><SideTag side={b.side}/></td>
              <td className="px-3 py-2.5"><FundTag fund={f}/></td>
              <td className={`px-3 py-2.5 text-right font-medium tnum ${clsPnl(b.unrealizedPnl)}`}>{fmtSigned(b.unrealizedPnl)}</td>
              <td className="px-3 py-2.5 text-right tnum text-slate-500 hidden sm:table-cell">{fmtUSD(Math.abs(b.notional))}</td>
              <td className="px-3 py-2.5 text-right tnum text-slate-500 hidden md:table-cell">{b.leverage?b.leverage+'×':'—'}</td>
            </tr>; })}
          </tbody>
        </table></div>}
      </Card>
    </>}
  </div>;
}

/* ============================================================
   REAL-TIME OPERATIONS
   ============================================================ */
function RealtimePage(){
  const {funds,user,data,dataStatus}=useApp();
  const [fund,setFund]=useState('all');
  const [sort,setSort]=useState({col:'uPnl',dir:'desc'});
  const [incidents,setIncidents]=useState(null);
  useEffect(()=>{ if(!hasPerm(user,'view_realtime'))return; api('alerts').then(r=>setIncidents((r.alerts||[]).slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,6))).catch(()=>setIncidents([])); },[]);
  if(!hasPerm(user,'view_realtime')) return <Denied/>;

  const selFund=fund!=='all'?(fund==='unassigned'?'unassigned':funds.find(f=>f.id===fund)):null;
  let open=data.openBots;
  if(fund==='unassigned') open=open.filter(b=>!b.fundId);
  else if(selFund) open=open.filter(b=>b.fundId===fund);

  const livePnl=open.reduce((a,b)=>a+(b.unrealizedPnl||0),0);
  const exposure=open.reduce((a,b)=>a+Math.abs(b.notional||0),0);

  let rows=open.map(b=>({...b,fund:fundOf(funds,b)}));
  rows=sortRows(rows,sort,{symbol:r=>r.symbol,side:r=>r.side,exchange:r=>r.exchange,fund:r=>r.fund?.name||'',qty:r=>r.qty,entry:r=>r.entry,mark:r=>r.mark,uPnl:r=>r.unrealizedPnl,notional:r=>Math.abs(r.notional),leverage:r=>r.leverage});

  const fundOpts=[{value:'all',label:'All Funds'},...funds.map(f=>({value:f.id,label:f.name})),{value:'unassigned',label:'Unassigned'}];
  return <div>
    <PageHead title="Live" subtitle="Open futures positions across all connected exchanges"
      actions={<div className="flex items-center gap-3">
        <Select value={fund} onChange={setFund} className="w-40" options={fundOpts}/>
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">{data.live&&data.live.syncedAt?<>synced {fmtAgo(data.live.syncedAt)}</>:'not synced yet'}</span>
      </div>}/>

    <MarketTicker/>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      <KpiCard label="Account Equity" value={fmtUSD(data.equity)} icon="dollar"/>
      <KpiCard label="Open PnL" value={<span className={clsPnl(livePnl)}>{fmtSigned(livePnl)}</span>}/>
      <KpiCard label="Open Positions" value={open.length} icon="briefcase"/>
      <KpiCard label="Exposure" value={fmtUSD(exposure)} icon="layers"/>
    </div>

    <Card className="overflow-hidden">
      <div className="p-5 pb-0"><SectionTitle right={data.live&&data.live.connected>0&&<span className="flex items-center gap-1.5 text-xs text-success"><span className="w-1.5 h-1.5 rounded-full bg-success pulse-dot"/>{data.live.connected} connected</span>}>Open Positions</SectionTitle></div>
      {rows.length===0? <div className="p-8"><EmptyState icon="briefcase" title="No open positions" hint={data.live&&data.live.connected? 'No positions are currently open on your connected exchange.' : 'Connect an exchange and sync to see live positions here.'}/></div>
      : <>
      {/* desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
            <SortHeader label="Symbol" col="symbol" sort={sort} setSort={setSort}/>
            <SortHeader label="Side" col="side" sort={sort} setSort={setSort}/>
            <SortHeader label="Qty" col="qty" sort={sort} setSort={setSort} align="right"/>
            <SortHeader label="Entry" col="entry" sort={sort} setSort={setSort} align="right"/>
            <SortHeader label="Mark" col="mark" sort={sort} setSort={setSort} align="right"/>
            <SortHeader label="Open PnL" col="uPnl" sort={sort} setSort={setSort} align="right"/>
            <SortHeader label="Notional" col="notional" sort={sort} setSort={setSort} align="right"/>
            <SortHeader label="Lev" col="leverage" sort={sort} setSort={setSort} align="right"/>
            <SortHeader label="Fund" col="fund" sort={sort} setSort={setSort}/>
            <th className="px-3 py-2.5 text-left font-medium">Exchange</th>
          </tr></thead>
          <tbody>
            {rows.map(r=><tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
              <td className="px-3 py-2.5 font-mono text-xs text-navy">{r.symbol}</td>
              <td className="px-3 py-2.5"><SideTag side={r.side}/></td>
              <td className="px-3 py-2.5 text-right tnum text-slate-500">{fmtNum(r.qty,r.qty<1?4:2)}</td>
              <td className="px-3 py-2.5 text-right tnum text-slate-500">{fmtPrice(r.entry)}</td>
              <td className="px-3 py-2.5 text-right tnum text-slate-500">{fmtPrice(r.mark)}</td>
              <td className={`px-3 py-2.5 text-right font-medium tnum ${clsPnl(r.unrealizedPnl)}`}>{fmtSigned(r.unrealizedPnl)}</td>
              <td className="px-3 py-2.5 text-right tnum text-slate-500">{fmtUSD(Math.abs(r.notional))}</td>
              <td className="px-3 py-2.5 text-right tnum text-slate-500">{r.leverage?r.leverage+'×':'—'}</td>
              <td className="px-3 py-2.5">{r.fund? <Badge color={r.fund.color} dot onClick={()=>setFund(r.fund.id)}>{r.fund.name}</Badge> : <span className="text-xs text-slate-400">Unassigned</span>}</td>
              <td className="px-3 py-2.5 text-slate-500 capitalize">{r.exchange}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {/* mobile cards */}
      <div className="md:hidden p-3 space-y-2">
        {rows.map(r=><div key={r.id} className="border border-slate-100 rounded-lg p-3">
          <div className="flex items-center justify-between"><div className="font-mono text-sm text-navy">{r.symbol} <SideTag side={r.side}/></div><span className={`font-medium tnum ${clsPnl(r.unrealizedPnl)}`}>{fmtSigned(r.unrealizedPnl)}</span></div>
          <div className="flex items-center justify-between mt-2 text-xs text-slate-500"><FundTag fund={r.fund}/><span className="tnum">{fmtUSD(Math.abs(r.notional))} · {r.leverage?r.leverage+'×':'—'}</span></div>
        </div>)}
      </div>
      </>}
    </Card>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
      <Card className="p-5">
        <SectionTitle right={<LiveBadge status={dataStatus}/>}>Service health</SectionTitle>
        <div className="space-y-2.5">
          {[
            ['Exchange sync', data.live&&data.live.connected>0?'ok':'neutral', data.live&&data.live.connected>0?`${data.live.connected} connected`:'No exchange connected'],
            ['Market data feed', dataStatus==='live'?'ok':dataStatus==='partial'?'warn':'neutral', dataStatus==='live'?'Streaming':dataStatus==='partial'?'Degraded':'Idle'],
            ['Open positions', data.openBots.length?'ok':'neutral', `${data.openBots.length} open · ${data.bots.length} tracked`],
            ['Last sync', data.live&&data.live.syncedAt?'ok':'neutral', data.live&&data.live.syncedAt?fmtAgo(data.live.syncedAt):'never'],
          ].map(([label,state,sub])=><div key={label} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-navy"><span className={`w-2 h-2 rounded-full ${state==='ok'?'bg-success':state==='warn'?'bg-amber-500':'bg-slate-300'}`}/>{label}</span>
            <span className="text-xs text-slate-400">{sub}</span>
          </div>)}
        </div>
      </Card>
      <Card className="p-5">
        <SectionTitle right={<span className="text-[11px] text-slate-400">latest alerts</span>}>Recent incidents</SectionTitle>
        {incidents===null? <div className="text-sm text-slate-400">Loading…</div>
         : incidents.length===0? <div className="text-sm text-slate-400 py-2 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-success"/>No incidents — all clear.</div>
         : <div className="space-y-2.5">
            {incidents.map(a=><div key={a.id} className="flex items-start gap-2.5 text-sm">
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${a.ackedAt?'bg-success':'bg-danger'}`}/>
              <div className="flex-1 min-w-0"><div className="text-navy">{a.summary}</div>
                <div className="text-[11px] text-slate-400">{fmtAgo(a.createdAt)} · {a.ackedAt?'acknowledged':'pending'}</div></div>
            </div>)}
          </div>}
      </Card>
    </div>
  </div>;
}

/* ============================================================
   TABLE PRODUCTIVITY HELPERS — virtual rows, column picker, presets
   ============================================================ */
// Windowed row virtualization for a fixed-row-height scroll container.
function useVirtual({count,rowH,overscan=10,resetKey}){
  const ref=useRef(null);
  const [scrollTop,setScrollTop]=useState(0);
  const [h,setH]=useState(640);
  useEffect(()=>{ const el=ref.current; if(!el)return; const onScroll=()=>setScrollTop(el.scrollTop); const measure=()=>setH(el.clientHeight||640); measure(); el.addEventListener('scroll',onScroll,{passive:true}); window.addEventListener('resize',measure); return ()=>{ el.removeEventListener('scroll',onScroll); window.removeEventListener('resize',measure); }; },[]);
  useEffect(()=>{ const el=ref.current; if(el) el.scrollTop=0; setScrollTop(0); },[resetKey]);
  const start=Math.max(0,Math.floor(scrollTop/rowH)-overscan);
  const end=Math.min(count,Math.ceil((scrollTop+h)/rowH)+overscan);
  return {ref,start,end,padTop:start*rowH,padBottom:Math.max(0,(count-end)*rowH)};
}
// Show/hide columns; order always follows the canonical `columns` array.
function ColumnPicker({columns,visible,onChange}){
  const [open,setOpen]=useState(false); const ref=useRef();
  useEffect(()=>{ const h=e=>{ if(ref.current&&!ref.current.contains(e.target))setOpen(false); }; document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h); },[]);
  const toggle=(k)=>{ const set=new Set(visible); set.has(k)?set.delete(k):set.add(k); if(set.size===0)return; onChange(columns.filter(c=>set.has(c.key)).map(c=>c.key)); };
  return <div ref={ref} className="relative">
    <Btn variant="outline" size="sm" onClick={()=>setOpen(o=>!o)}><Icon name="columns" className="w-4 h-4"/>Columns</Btn>
    {open&&<div className="absolute right-0 mt-1 w-52 bg-white rounded-lg shadow-xl border border-slate-200 p-2 z-40 fadein max-h-72 overflow-y-auto">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 px-1 pb-1">Visible columns</div>
      {columns.map(c=><label key={c.key} className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-slate-50 text-sm cursor-pointer text-navy">
        <input type="checkbox" checked={visible.includes(c.key)} onChange={()=>toggle(c.key)} className="accent-navy w-4 h-4"/>{c.label}
      </label>)}
    </div>}
  </div>;
}
// Saved views: persists named snapshots (filters/sort/columns) to localStorage.
function PresetMenu({storeKey,current,onApply}){
  const [presets,setPresets]=useState(()=>PREF.get(storeKey,[]));
  const [open,setOpen]=useState(false); const [name,setName]=useState(''); const ref=useRef();
  useEffect(()=>{ const h=e=>{ if(ref.current&&!ref.current.contains(e.target))setOpen(false); }; document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h); },[]);
  const persist=(next)=>{ setPresets(next); PREF.set(storeKey,next); };
  const save=()=>{ const n=name.trim(); if(!n)return; persist([...presets.filter(p=>p.name!==n),{name:n,state:current}]); setName(''); toast.success(`View “${n}” saved`); };
  return <div ref={ref} className="relative">
    <Btn variant="outline" size="sm" onClick={()=>setOpen(o=>!o)}><Icon name="save" className="w-4 h-4"/>Views{presets.length>0&&<span className="text-[10px] text-slate-400">{presets.length}</span>}</Btn>
    {open&&<div className="absolute right-0 mt-1 w-60 bg-white rounded-lg shadow-xl border border-slate-200 p-2 z-40 fadein">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 px-1 pb-1">Saved views</div>
      {presets.length===0&&<div className="text-xs text-slate-400 px-1 py-2">No saved views yet — set up filters and columns, then save.</div>}
      {presets.map(p=><div key={p.name} className="flex items-center gap-1">
        <button onClick={()=>{onApply(p.state);setOpen(false);}} className="flex-1 text-left px-2 py-1.5 rounded-md hover:bg-slate-50 text-sm text-navy truncate">{p.name}</button>
        <button onClick={()=>persist(presets.filter(x=>x.name!==p.name))} className="text-slate-300 hover:text-danger px-1" title="Delete view"><Icon name="trash" className="w-3.5 h-3.5"/></button>
      </div>)}
      <div className="flex items-center gap-1 mt-2 pt-2 border-t border-slate-100">
        <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')save();}} placeholder="Save current view…" className="flex-1 min-w-0 bg-slate-100 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"/>
        <Btn size="sm" onClick={save} disabled={!name.trim()}>Save</Btn>
      </div>
    </div>}
  </div>;
}

/* ============================================================
   POSITIONS (all bots — open + closed; full table, sort/filter/export)
   ============================================================ */
// Columns operate on a "bot" (one exchange/symbol futures position). `csv` returns
// a plain value for export; `cell` renders the table cell. `fund` is attached per row.
const POS_COLS=[
  {key:'symbol',label:'Symbol',cell:b=><span className="font-mono text-xs text-navy">{b.symbol}</span>,csv:b=>b.symbol,def:true},
  {key:'exchange',label:'Exchange',cell:b=><span className="text-slate-500 capitalize">{b.exchange}</span>,csv:b=>b.exchange,def:true},
  {key:'fund',label:'Fund',cell:b=> b.fund? <Badge color={b.fund.color} dot>{b.fund.name}</Badge> : <span className="text-xs text-slate-400">Unassigned</span>,csv:b=>b.fund?.name||'',def:true},
  {key:'side',label:'Side',cell:b=><SideTag side={b.side}/>,csv:b=>b.side,def:true},
  {key:'qty',label:'Qty',align:'right',cell:b=><span className="tnum text-slate-500">{fmtNum(b.qty,b.qty&&b.qty<1?4:2)}</span>,csv:b=>b.qty,def:true},
  {key:'entry',label:'Entry',align:'right',cell:b=><span className="tnum text-slate-500">{fmtPrice(b.entry)}</span>,csv:b=>b.entry,def:true},
  {key:'mark',label:'Mark',align:'right',cell:b=><span className="tnum text-slate-500">{fmtPrice(b.mark)}</span>,csv:b=>b.mark,def:true},
  {key:'uPnl',label:'Open PnL',align:'right',cell:b=><span className={`font-medium tnum ${clsPnl(b.unrealizedPnl)}`}>{fmtSigned(b.unrealizedPnl)}</span>,csv:b=>Number((b.unrealizedPnl||0).toFixed(2)),def:true},
  {key:'notional',label:'Notional',align:'right',cell:b=><span className="tnum text-slate-500">{fmtUSD(Math.abs(b.notional))}</span>,csv:b=>Math.round(Math.abs(b.notional)),def:true},
  {key:'leverage',label:'Lev',align:'right',cell:b=><span className="tnum text-slate-500">{b.leverage?b.leverage+'×':'—'}</span>,csv:b=>b.leverage,def:false},
  {key:'status',label:'Status',cell:b=><StatusPill status={b.status==='open'?'active':'inactive'}/>,csv:b=>b.status,def:true},
];
const POS_GETTERS={symbol:r=>r.symbol,exchange:r=>r.exchange,fund:r=>r.fund?.name||'',side:r=>r.side,qty:r=>r.qty,entry:r=>r.entry,mark:r=>r.mark,uPnl:r=>r.unrealizedPnl,notional:r=>Math.abs(r.notional),leverage:r=>r.leverage,status:r=>r.status};

function TradesPage(){
  const {user,data,funds}=useApp();
  const [f,setF]=useState(()=>PREF.get('pos_filter',{fund:'all',side:'All',status:'open',q:''}));
  const [sort,setSort]=useState(()=>PREF.get('pos_sort',{col:'uPnl',dir:'desc'}));
  const [colKeys,setColKeys]=useState(()=>PREF.get('pos_cols',POS_COLS.filter(c=>c.def).map(c=>c.key)));
  useEffect(()=>{ PREF.set('pos_filter',f); },[f]);
  useEffect(()=>{ PREF.set('pos_sort',sort); },[sort]);
  useEffect(()=>{ PREF.set('pos_cols',colKeys); },[colKeys]);
  if(!hasPerm(user,'view_trades')) return <Denied/>;

  const cols=colKeys.map(k=>POS_COLS.find(c=>c.key===k)).filter(Boolean);
  let rows=data.bots.map(b=>({...b,fund:fundOf(funds,b)})).filter(b=>
    (f.fund==='all'|| (f.fund==='unassigned'? !b.fundId : b.fundId===f.fund))&&
    (f.side==='All'||b.side===f.side)&&
    (f.status==='all'||b.status===f.status)&&
    (!f.q|| (b.symbol+' '+b.exchange+' '+(b.fund?.name||'')).toLowerCase().includes(f.q.toLowerCase()))
  );
  rows=sortRows(rows,sort,POS_GETTERS);
  const vt=useVirtual({count:rows.length,rowH:41,resetKey:JSON.stringify(f)+sort.col+sort.dir});

  const clear=()=>setF({fund:'all',side:'All',status:'open',q:''});
  const active = f.fund!=='all'||f.side!=='All'||f.status!=='open'||f.q;
  const exportHeaders=cols.map(c=>c.label);
  const getExportRows=()=>rows.map(b=>cols.map(c=>c.csv(b)));
  const fundOpts=[{value:'all',label:'All funds'},...funds.map(ff=>({value:ff.id,label:ff.name})),{value:'unassigned',label:'Unassigned'}];

  return <div>
    <PageHead title="Positions" subtitle={`${rows.length} of ${data.bots.length} position${data.bots.length===1?'':'s'}`}
      actions={<div className="flex items-center gap-2">
        <PresetMenu storeKey="pos_presets" current={{f,sort,colKeys}} onApply={s=>{ if(s.f)setF(s.f); if(s.sort)setSort(s.sort); if(s.colKeys)setColKeys(s.colKeys); }}/>
        <ColumnPicker columns={POS_COLS} visible={colKeys} onChange={setColKeys}/>
        {hasPerm(user,'export_data')&&<ExportMenu filename="lno_positions" headers={exportHeaders} getRows={getExportRows}/>}
      </div>}/>
    <Card className="p-3 mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={f.fund} onChange={v=>setF({...f,fund:v})} className="w-44" options={fundOpts}/>
        <Select value={f.side} onChange={v=>setF({...f,side:v})} className="w-32" options={['All','LONG','SHORT']}/>
        <Select value={f.status} onChange={v=>setF({...f,status:v})} className="w-32" options={[{value:'all',label:'All'},{value:'open',label:'Open'},{value:'closed',label:'Closed'}]}/>
        <div className="relative flex-1 min-w-[160px]"><Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={f.q} onChange={e=>setF({...f,q:e.target.value})} placeholder="Search symbol, exchange, fund…" className="w-full bg-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"/></div>
        {active&&<Btn variant="ghost" size="sm" onClick={clear}><Icon name="x" className="w-3.5 h-3.5"/>Clear filters</Btn>}
      </div>
    </Card>
    <Card className="overflow-hidden">
      <div ref={vt.ref} className="overflow-auto" style={{maxHeight:'68vh'}}>
        <table className="w-full text-sm">
          <thead className="text-xs sticky top-0 z-10"><tr className="bg-white border-b border-slate-200 shadow-sm">
            {cols.map(c=><SortHeader key={c.key} label={c.label} col={c.key} sort={sort} setSort={setSort} align={c.align||'left'}/>)}
          </tr></thead>
          <tbody>
            {vt.padTop>0&&<tr style={{height:vt.padTop}}><td colSpan={cols.length}/></tr>}
            {rows.slice(vt.start,vt.end).map(b=><tr key={b.id} style={{height:41}} className="border-b border-slate-50 hover:bg-slate-50/60">
              {cols.map(c=><td key={c.key} className={`px-3 py-2.5 whitespace-nowrap ${c.align==='right'?'text-right':''} ${c.cls||''}`}>{c.cell(b)}</td>)}
            </tr>)}
            {vt.padBottom>0&&<tr style={{height:vt.padBottom}}><td colSpan={cols.length}/></tr>}
          </tbody>
        </table>
      </div>
      {rows.length===0&&<div className="p-10"><EmptyState icon="briefcase" title={data.bots.length===0?'No positions yet':'No positions match the current filters'} hint={data.bots.length===0?'Positions appear automatically when a sync detects them on a connected exchange.':undefined}/></div>}
    </Card>
  </div>;
}

/* ============================================================
   ADMIN — USERS
   ============================================================ */
// Recent sign-in audit for one user (timestamp · method · IP), loaded on expand.
function UserLoginHistory({userId}){
  const [rows,setRows]=useState(null);
  useEffect(()=>{ let alive=true; api('users?logins='+encodeURIComponent(userId)).then(r=>{ if(alive)setRows(r.logins||[]); }).catch(()=>{ if(alive)setRows([]); }); return ()=>{alive=false;}; },[userId]);
  if(rows===null) return <div className="text-xs text-slate-400">Loading…</div>;
  if(!rows.length) return <div className="text-xs text-slate-400">No sign-ins recorded yet.</div>;
  return <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
    {rows.map((l,i)=><div key={i} className="flex items-center justify-between gap-3 text-xs">
      <span className="text-slate-500 whitespace-nowrap">{fmtDT(l.createdAt)}</span>
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{l.method}</span>
      <span className="font-mono text-slate-400 truncate">{l.ip||'—'}</span>
    </div>)}
  </div>;
}
function AdminUsers(){
  const {user}=useApp();
  const [users,setUsers]=useState([]);
  const [exp,setExp]=useState(null); const [add,setAdd]=useState(false); const [del,setDel]=useState(null);
  const [sel,setSel]=useState(()=>new Set()); const [bulkDel,setBulkDel]=useState(false);
  // refetch periodically so the online lights + last-seen stay current
  useEffect(()=>{ if(user.role!=='admin') return; const load=()=>api('users').then(r=>setUsers(r.users||[])).catch(()=>{}); load(); const iv=setInterval(load,30000); return ()=>clearInterval(iv); },[]);
  if(user.role!=='admin') return <Denied/>;
  const isOnline=(u)=> u.lastSeenAt && (Date.now()-new Date(u.lastSeenAt).getTime() < 150000); // active within 2.5 min
  const up=async(id,patch)=>{ try{ const r=await api('users',{method:'PATCH',body:{id,...patch}}); setUsers(us=>us.map(u=>u.id===id?r.user:u)); }catch(e){ toast.error(e.message); } };
  const toggleSel=(id)=>setSel(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });
  const ids=[...sel];
  async function bulkPatch(patch,{skipSelf=false,verb='Updated'}={}){
    const targets=ids.filter(id=>!(skipSelf&&id===user.id)); if(!targets.length){ toast.info('Nothing to update (only your own account was selected).'); return; }
    let ok=0; await Promise.all(targets.map(async id=>{ try{ const r=await api('users',{method:'PATCH',body:{id,...patch}}); setUsers(us=>us.map(u=>u.id===id?r.user:u)); ok++; }catch(e){} }));
    toast.success(`${verb} ${ok} user${ok===1?'':'s'}${targets.length<ids.length?' · skipped you':''}`); setSel(new Set());
  }
  async function bulkDelete(){
    const targets=ids.filter(id=>id!==user.id); let ok=0;
    await Promise.all(targets.map(async id=>{ try{ await api('users',{method:'DELETE',body:{id}}); ok++; }catch(e){} }));
    setUsers(us=>us.filter(u=>!targets.includes(u.id))); toast.success(`Deleted ${ok} user${ok===1?'':'s'}`); setSel(new Set()); setBulkDel(false); setExp(null);
  }
  const allSel=users.length>0&&sel.size===users.length;
  return <div>
    <PageHead title="Users" subtitle={`${users.length} accounts`} actions={<Btn onClick={()=>setAdd(true)}><Icon name="plus" className="w-4 h-4"/>Add User</Btn>}/>
    <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
      <label className="flex items-center gap-2 text-sm text-slate-500 cursor-pointer select-none">
        <input type="checkbox" checked={allSel} ref={el=>{ if(el) el.indeterminate=sel.size>0&&!allSel; }} onChange={e=>setSel(e.target.checked?new Set(users.map(u=>u.id)):new Set())} className="accent-navy w-4 h-4"/>
        {sel.size>0?`${sel.size} selected`:'Select all'}
      </label>
      <div className="flex items-center gap-2 flex-wrap">
        {sel.size>0&&<>
          <Btn size="sm" variant="outline" onClick={()=>bulkPatch({active:true},{verb:'Activated'})}><Icon name="power" className="w-3.5 h-3.5"/>Activate</Btn>
          <Btn size="sm" variant="outline" onClick={()=>bulkPatch({active:false},{skipSelf:true,verb:'Deactivated'})}>Deactivate</Btn>
          <Select value="" onChange={v=>{ if(v) bulkPatch({role:v,permissions:ROLE_PERMS[v].slice()},{skipSelf:true,verb:'Re-roled'}); }} className="w-32" options={[{value:'',label:'Set role…'},...ROLE_OPTIONS]}/>
          <Btn size="sm" variant="danger" onClick={()=>setBulkDel(true)}><Icon name="trash" className="w-3.5 h-3.5"/>Delete</Btn>
        </>}
        <ExportMenu filename="lno_users" size="sm" variant="outline" headers={['Email','First name','Last name','Role','Active','Permissions']}
          getRows={()=>(sel.size?users.filter(u=>sel.has(u.id)):users).map(u=>[u.email,u.firstName||'',u.lastName||'',u.role,u.active?'yes':'no',(u.role==='admin'?ALL_PERMS:u.permissions||[]).join(' ')])}/>
      </div>
    </div>
    <div className="space-y-3">
      {users.map(u=><Card key={u.id} className={`overflow-hidden ${sel.has(u.id)?'ring-1 ring-gold/40':''}`}>
        <div className="flex items-center">
        <label className="pl-4 flex items-center shrink-0"><input type="checkbox" checked={sel.has(u.id)} onChange={()=>toggleSel(u.id)} className="accent-navy w-4 h-4"/></label>
        <button onClick={()=>setExp(exp===u.id?null:u.id)} className="flex-1 min-w-0 flex items-center gap-3 p-4 text-left hover:bg-slate-50/60">
          {u.avatar?<img src={u.avatar} className="w-10 h-10 rounded-full object-cover"/>:<span className="w-10 h-10 rounded-full bg-navy text-white grid place-items-center text-xs font-semibold shrink-0">{initialsOf(u)}</span>}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-navy flex items-center gap-2">{(u.firstName||u.lastName)?`${u.firstName} ${u.lastName}`.trim():u.email}
              <Badge className={u.role==='admin'?'bg-gold/15 text-gold':u.role==='operator'?'bg-blue-100 text-blue-700':u.role==='shareholder'?'bg-emerald-100 text-emerald-700':'bg-slate-100 text-slate-600'}>{u.role}</Badge>
            </div>
            <div className="text-xs text-slate-400 truncate">{u.email}</div>
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5 truncate">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOnline(u)?'bg-success pulse-dot':'bg-slate-300'}`}/>
              <span className={isOnline(u)?'text-success font-medium':''}>{isOnline(u)?'Online':(u.lastLoginAt?`Last sign-in ${fmtDT(u.lastLoginAt)}`:'Never signed in')}</span>
              {u.lastIp&&<span className="font-mono text-slate-400">· {u.lastIp}</span>}
            </div>
          </div>
          <StatusPill status={u.active?'active':'inactive'}/>
          <Icon name="chevdown" className={`w-4 h-4 text-slate-400 transition ${exp===u.id?'rotate-180':''}`}/>
        </button>
        </div>
        {exp===u.id&&<div className="border-t border-slate-100 p-4 space-y-4 fadein">
          <div className="flex flex-wrap gap-4">
            <div><Field label="Email"><div className="pt-1.5 text-sm font-mono text-slate-500">{u.email}</div></Field></div>
            <div className="w-44"><Field label="Role"><Select value={u.role} onChange={v=>up(u.id,{role:v,permissions:ROLE_PERMS[v].slice()})} options={ROLE_OPTIONS}/></Field></div>
            <div><Field label="Active"><div className="pt-1.5"><Toggle on={u.active} onChange={v=>up(u.id,{active:v})}/></div></Field></div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 mb-2">Permissions {u.role==='admin'&&<span className="text-slate-400">(admins always have all permissions)</span>}</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {PERMISSIONS.map(([p,l])=><label key={p} className={`flex items-center gap-2 text-sm ${u.role==='admin'?'opacity-50':''}`}>
                <input type="checkbox" disabled={u.role==='admin'} checked={u.role==='admin'||u.permissions.includes(p)} onChange={e=>up(u.id,{permissions:e.target.checked?[...u.permissions,p]:u.permissions.filter(x=>x!==p)})} className="accent-navy w-4 h-4"/>{l}
              </label>)}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 mb-2">Sign-in &amp; password</div>
            {u.authProvider==='google'
              ? <div className="text-sm text-slate-500 flex items-center gap-2"><Icon name="shield" className="w-4 h-4 text-slate-400 shrink-0"/>Signs in with Google (<span className="font-mono">{u.email}</span>) — no password to set.</div>
              : <AdminSetPassword user={u}/>}
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-2">Recent sign-ins
              {u.lastIp&&<span className="text-[11px] text-slate-400 font-normal">· last from <span className="font-mono">{u.lastIp}</span></span>}</div>
            <UserLoginHistory userId={u.id}/>
          </div>
          <div className="flex justify-end pt-1">
            <Btn variant="danger" size="sm" disabled={u.id===user.id} onClick={()=>setDel(u)}><Icon name="trash" className="w-3.5 h-3.5"/>Delete user</Btn>
          </div>
        </div>}
      </Card>)}
    </div>
    <AddUserModal open={add} onClose={()=>setAdd(false)} onCreated={u=>{setUsers(us=>[...us,u]);setAdd(false);}}/>
    <Confirm open={!!del} title="Delete user" message={`Permanently remove ${del?.email}? This cannot be undone.`} onCancel={()=>setDel(null)} onConfirm={async()=>{try{await api('users',{method:'DELETE',body:{id:del.id}});setUsers(us=>us.filter(u=>u.id!==del.id));toast.success('User deleted');}catch(e){toast.error(e.message);}setDel(null);setExp(null);}}/>
    <Confirm open={bulkDel} title="Delete selected users" message={`Permanently remove ${ids.filter(id=>id!==user.id).length} user(s)? Your own account is never deleted. This cannot be undone.`} confirmLabel="Delete all" onCancel={()=>setBulkDel(false)} onConfirm={bulkDelete}/>
  </div>;
}
// Password policy for shareholder accounts — mirrors api/_lib/auth.js passwordIssues().
const PW_RULES=[
  ['At least 12 characters', pw=>pw.length>=12],
  ['An uppercase letter', pw=>/[A-Z]/.test(pw)],
  ['A lowercase letter', pw=>/[a-z]/.test(pw)],
  ['A number', pw=>/[0-9]/.test(pw)],
  ['A special character', pw=>/[^A-Za-z0-9]/.test(pw)],
];
const passwordOk=(pw)=>PW_RULES.every(([,fn])=>fn(pw||''));
// Admin sets a new password for a password (non-Google) account.
function AdminSetPassword({user}){
  const [pw,setPw]=useState(''); const [show,setShow]=useState(false); const [busy,setBusy]=useState(false); const [msg,setMsg]=useState(null);
  async function save(){
    if(!passwordOk(pw)) return setMsg({err:'Password does not meet all the requirements below.'});
    setBusy(true);
    try{ await api('users',{method:'PATCH',body:{id:user.id,password:pw}}); setPw(''); setMsg({ok:'Password updated'}); toast.success(`New password set for ${user.email}`); }
    catch(e){ setMsg({err:e.message||'Could not set password'}); }
    finally{ setBusy(false); }
  }
  return <div>
    <div className="flex flex-wrap gap-2 items-start">
      <div className="relative flex-1 min-w-[220px] max-w-xs">
        <Input type={show?'text':'password'} value={pw} onChange={e=>{setPw(e.target.value);setMsg(null);}} placeholder="New password" className="pr-9 font-mono"/>
        <button type="button" onClick={()=>setShow(s=>!s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-navy"><Icon name={show?'eyeoff':'eye'} className="w-4 h-4"/></button>
      </div>
      <Btn type="button" variant="outline" size="sm" onClick={()=>{setPw(genPassword());setShow(true);setMsg(null);}}><Icon name="refresh" className="w-3.5 h-3.5"/>Generate</Btn>
      <Btn size="sm" onClick={save} disabled={busy||!pw}>{busy?'Setting…':'Set password'}</Btn>
      {msg?.ok&&<span className="text-sm text-success flex items-center gap-1 pt-1.5"><Icon name="check" className="w-4 h-4"/>{msg.ok}</span>}
      {msg?.err&&<span className="text-sm text-danger pt-1.5">{msg.err}</span>}
    </div>
    {pw&&<div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 mt-2">
      {PW_RULES.map(([label,fn])=>{ const ok=fn(pw); return <div key={label} className={`flex items-center gap-1.5 text-[11px] ${ok?'text-success':'text-slate-400'}`}><Icon name={ok?'check':'x'} className="w-3 h-3 shrink-0"/>{label}</div>; })}
    </div>}
    <div className="text-[11px] text-slate-400 mt-2">Share the new password with the user securely — they sign in with their email + this password.</div>
  </div>;
}
function genPassword(){
  const U='ABCDEFGHJKLMNPQRSTUVWXYZ',L='abcdefghijkmnopqrstuvwxyz',D='23456789',S='!@#$%^&*?-_',all=U+L+D+S;
  const rnd=(n)=>{ try{ const a=new Uint32Array(1); crypto.getRandomValues(a); return a[0]%n; }catch(e){ return Math.floor(Math.random()*n); } };
  const pick=s=>s[rnd(s.length)];
  const arr=[pick(U),pick(L),pick(D),pick(S)];
  while(arr.length<16) arr.push(pick(all));
  for(let i=arr.length-1;i>0;i--){ const j=rnd(i+1); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  return arr.join('');
}
function AddUserModal({open,onClose,onCreated}){
  const [v,setV]=useState({email:'',firstName:'',lastName:'',role:'viewer',password:''}); const [err,setErr]=useState(''); const [busy,setBusy]=useState(false); const [showPw,setShowPw]=useState(false);
  useEffect(()=>{ if(open){setV({email:'',firstName:'',lastName:'',role:'viewer',password:''});setErr('');setShowPw(false);} },[open]);
  const isShareholder=v.role==='shareholder';
  async function submit(){
    if(isShareholder){
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email))return setErr('A valid email is required.');
      if(!passwordOk(v.password))return setErr('Password does not meet all the requirements below.');
    } else if(!v.email.endsWith('@lno.company')) return setErr('Email must end with @lno.company');
    setBusy(true);
    try{ const body={email:v.email.trim(),firstName:v.firstName,lastName:v.lastName,role:v.role}; if(isShareholder) body.password=v.password; const r=await api('users',{method:'POST',body}); onCreated(r.user); }
    catch(e){ setErr(e.message); } finally{ setBusy(false); }
  }
  return <Modal open={open} onClose={onClose} title="Add User">
    <div className="space-y-3">
      <Field label="Role"><Select value={v.role} onChange={r=>setV({...v,role:r})} options={ROLE_OPTIONS}/></Field>
      <Field label="Email *" hint={isShareholder?'Any email — shareholders have external addresses':'Must end with @lno.company'}><Input value={v.email} onChange={e=>setV({...v,email:e.target.value})} placeholder={isShareholder?'investor@example.com':'jane.doe@lno.company'}/></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name"><Input value={v.firstName} onChange={e=>setV({...v,firstName:e.target.value})}/></Field>
        <Field label="Last name"><Input value={v.lastName} onChange={e=>setV({...v,lastName:e.target.value})}/></Field>
      </div>
      {isShareholder&&<Field label="Password *">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input type={showPw?'text':'password'} value={v.password} onChange={e=>setV({...v,password:e.target.value})} placeholder="Set a strong password" className="pr-9 font-mono"/>
            <button type="button" onClick={()=>setShowPw(s=>!s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-navy"><Icon name={showPw?'eyeoff':'eye'} className="w-4 h-4"/></button>
          </div>
          <Btn type="button" variant="outline" size="sm" onClick={()=>{setV(x=>({...x,password:genPassword()}));setShowPw(true);}}><Icon name="refresh" className="w-3.5 h-3.5"/>Generate</Btn>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-2">
          {PW_RULES.map(([label,fn])=>{ const ok=fn(v.password||''); return <div key={label} className={`flex items-center gap-1.5 text-[11px] ${ok?'text-success':'text-slate-400'}`}><Icon name={ok?'check':'x'} className="w-3 h-3 shrink-0"/>{label}</div>; })}
        </div>
      </Field>}
      {err&&<div className="text-sm text-danger">{err}</div>}
      <div className="text-[11px] text-slate-400">{isShareholder
        ? 'Shareholders sign in with their email + this password (they can’t use Google — external email). Share these credentials with them securely.'
        : <>Pre-provisions the account with a role. The user signs in with their <span className="font-mono">@lno.company</span> Google account — no password needed.</>}</div>
      <div className="flex justify-end gap-2 pt-1"><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn onClick={submit} disabled={busy}>{busy?'Creating…':'Create user'}</Btn></div>
    </div>
  </Modal>;
}

/* ============================================================
   ADMIN — EXCHANGES
   ============================================================ */
function AdminExchanges(){
  const {user}=useApp();
  const [exchanges,setExchanges]=useState([]);
  const [modal,setModal]=useState(null); const [del,setDel]=useState(null);
  const reload=()=>api('exchanges').then(r=>setExchanges(r.exchanges||[])).catch(()=>{});
  const [syncing,setSyncing]=useState(false);
  async function runSync(){ setSyncing(true); try{ const r=await api('bots',{method:'POST',body:{action:'sync'}}); await reload(); if(r.errors){ toast.error((r.errorMsgs&&r.errorMsgs[0])||`${r.errors} exchange${r.errors===1?'':'s'} failed to sync`); } else { toast.success(`Synced ${r.connected||0} exchange${(r.connected||0)===1?'':'s'} · ${r.positions||0} position${(r.positions||0)===1?'':'s'}`); } }catch(e){ toast.error(e.message); } finally{ setSyncing(false); } }
  useEffect(()=>{ if(user.role==='admin') reload(); },[]);
  if(user.role!=='admin') return <Denied/>;
  const mask=(s)=> s? s.slice(0,6)+'••••••••'+s.slice(-4) : '';
  return <div>
    <PageHead title="Exchanges" subtitle="Exchange API connections" actions={<div className="flex items-center gap-2">
      <Btn variant="outline" onClick={runSync} disabled={syncing}><Icon name="refresh" className="w-4 h-4"/>{syncing?'Syncing…':'Sync now'}</Btn>
      <Btn onClick={()=>setModal({mode:'add',data:{name:'binance',label:'',apiKey:'',secret:'',note:''}})}><Icon name="plus" className="w-4 h-4"/>Add Exchange</Btn>
    </div>}/>
    <div className="grid md:grid-cols-2 gap-4">
      {exchanges.map(e=><Card key={e.id} className="p-5">
        <div className="flex items-start justify-between">
          <div><div className="font-semibold text-navy">{e.label}</div><div className="text-xs text-slate-400 font-mono">{e.name}</div></div>
          <StatusPill status={e.status}/>
        </div>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-400">API Key</span><span className="font-mono text-xs">{mask(e.apiKey)}</span></div>
          <div className="flex justify-between items-center"><span className="text-slate-400">API Secret</span>
            <span className="flex items-center gap-1.5 font-mono text-xs">{e.hasSecret? e.secretMasked : <span className="text-slate-300">none</span>}<Icon name="shield" className="w-3.5 h-3.5 text-success" data-tip="Encrypted at rest"/></span>
          </div>
          <div className="flex justify-between"><span className="text-slate-400">Last sync</span><span className="text-xs">{e.lastSync?fmtDT(e.lastSync):'—'}</span></div>
          {e.note&&<div className="text-xs text-slate-400 pt-1">{e.note}</div>}
          {e.status==='error'&&e.lastError&&<div className="text-xs text-danger bg-danger/5 border border-danger/20 rounded-lg p-2 mt-1 break-words"><span className="font-medium">Sync error:</span> {e.lastError}</div>}
        </div>
        <div className="flex gap-2 mt-4">
          <Btn variant="outline" size="sm" onClick={()=>setModal({mode:'edit',data:{...e,secret:''}})}><Icon name="pencil" className="w-3.5 h-3.5"/>Edit</Btn>
          <Btn variant="ghost" size="sm" className="text-danger" onClick={()=>setDel(e)}><Icon name="trash" className="w-3.5 h-3.5"/>Delete</Btn>
        </div>
      </Card>)}
    </div>
    <ExchangeModal modal={modal} onClose={()=>setModal(null)} onSave={async(d)=>{
      try{
        const body={name:(d.name||'binance'),label:d.label,apiKey:d.apiKey,note:d.note}; if(d.secret) body.apiSecret=d.secret;
        if(modal.mode==='add') await api('exchanges',{method:'POST',body});
        else await api('exchanges',{method:'PATCH',body:{id:d.id,...body}});
        setModal(null); await runSync(); // kick off a first sync so it doesn't sit at "pending"
      }catch(e){ toast.error(e.message); }
    }}/>
    <Confirm open={!!del} title="Delete exchange" message={`Remove ${del?.label}? Bots using this connection will lose API access.`} onCancel={()=>setDel(null)} onConfirm={async()=>{try{await api('exchanges',{method:'DELETE',body:{id:del.id}});await reload();toast.success('Exchange removed');}catch(e){toast.error(e.message);}setDel(null);}}/>
  </div>;
}
function ExchangeModal({modal,onClose,onSave}){
  const [v,setV]=useState({}); useEffect(()=>{ if(modal)setV(modal.data); },[modal]);
  if(!modal)return null;
  return <Modal open={true} onClose={onClose} title={modal.mode==='add'?'Add Exchange':'Edit Exchange'}>
    <div className="space-y-3">
      <Field label="Exchange"><Select value={v.name||'binance'} onChange={x=>setV({...v,name:x})} options={[{value:'binance',label:'Binance (USDT-M Futures)'}]}/></Field>
      <Field label="Label" hint="Any name you like — e.g. “Main account”, “Sub-account 2”."><Input value={v.label||''} onChange={e=>setV({...v,label:e.target.value})} placeholder="Main account"/></Field>
      <Field label="API Key"><Input autoComplete="off" value={v.apiKey||''} onChange={e=>setV({...v,apiKey:e.target.value})}/></Field>
      <Field label="API Secret" hint={modal.mode==='edit'?'Leave blank to keep the existing secret':undefined}><Input type="password" autoComplete="new-password" value={v.secret||''} onChange={e=>setV({...v,secret:e.target.value})} placeholder={modal.mode==='edit'?'•••••••• — leave blank to keep':undefined}/></Field>
      <Field label="Note (optional)"><Input value={v.note||''} onChange={e=>setV({...v,note:e.target.value})}/></Field>
      <div className="text-[11px] text-slate-500 bg-navy/5 border border-slate-200 rounded-lg p-3">The key needs <span className="font-medium">Futures read</span> + <span className="font-medium">IP whitelist</span> (Vercel has no fixed IP, so route via a static-IP proxy). The secret is stored AES-encrypted and never returned. See <span className="font-mono">BINANCE_SETUP.md</span>.</div>
      <div className="flex justify-end gap-2 pt-1"><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn onClick={()=>onSave(v)}>Save</Btn></div>
    </div>
  </Modal>;
}

/* ============================================================
   ADMIN — WHATSAPP
   ============================================================ */
function AdminOpenWA(){
  const {user,funds,navigate}=useApp();
  const [cfg,setCfg]=useState(null);
  const [enabled,setEnabled]=useState(false); const [matrix,setMatrix]=useState({}); const [apiKey,setApiKey]=useState('');
  const [ddPct,setDdPct]=useState(10); const [pnlThr,setPnlThr]=useState(-5000); const [dailyReport,setDailyReport]=useState(true);
  const [rules,setRules]=useState([]);
  const [saved,setSaved]=useState(false); const [busy,setBusy]=useState(false); const [test,setTest]=useState(null); const [report,setReport]=useState(null);
  const [log,setLog]=useState(null); const [logQ,setLogQ]=useState(''); const [logStatus,setLogStatus]=useState('all');
  const loadLog=()=>api('openwa?log=1').then(r=>setLog(r.log||[])).catch(()=>setLog([]));
  useEffect(()=>{ if(user.role!=='admin')return; api('openwa').then(r=>{ const c=r.config; setCfg(c); setEnabled(c.enabled); setMatrix(c.notifMatrix||{}); setDdPct(c.drawdownPct??10); setPnlThr(c.pnlDayThreshold??-5000); setDailyReport(c.dailyReport??true); setRules(c.alertRules||[]); }).catch(()=>{}); loadLog(); },[]);
  if(user.role!=='admin') return <Denied/>;
  const scopeOpts=[{value:'portfolio',label:'Portfolio'},...funds.map(f=>({value:'fund:'+f.id,label:'Fund · '+f.name}))];
  const metricOpts=[{value:'drawdown',label:'Max drawdown (%)'},{value:'pnlDay',label:'Daily PnL ($)'}];
  const filteredLog=(log||[]).filter(l=>{
    if(logStatus==='ok'&&!l.ok) return false;
    if(logStatus==='fail'&&l.ok) return false;
    if(logQ){ const q=logQ.toLowerCase(); if(!((l.recipientName||'').toLowerCase().includes(q)||(l.phone||'').toLowerCase().includes(q)||(l.message||'').toLowerCase().includes(q))) return false; }
    return true;
  });
  const updateRule=(i,patch)=>setRules(rs=>rs.map((r,j)=>j===i?{...r,...patch}:r));
  const addRule=()=>setRules(rs=>[...rs,{id:'r'+Date.now(),scope:'portfolio',metric:'drawdown',value:10,enabled:true}]);
  const toggleMatrix=(type,role)=>setMatrix(m=>{ const cur=new Set(m[type]||[]); cur.has(role)?cur.delete(role):cur.add(role); return {...m,[type]:[...cur]}; });
  async function save(){ setBusy(true); try{ const body={enabled,drawdownPct:Number(ddPct),pnlDayThreshold:Number(pnlThr),dailyReport,alertRules:rules.map(r=>({...r,value:Number(r.value)})),notifMatrix:matrix}; if(apiKey.trim())body.apiKey=apiKey.trim(); const r=await api('openwa',{method:'PUT',body}); setCfg(r.config); setMatrix(r.config.notifMatrix||{}); setApiKey(''); setSaved(true); setTimeout(()=>setSaved(false),1800); }catch(e){ toast.error(e.message); } finally{ setBusy(false); } }
  async function sendTest(){ setTest({state:'sending'}); try{ const r=await api('openwa',{method:'POST',body:{action:'test'}}); setTest({state:r.ok?'ok':'err', msg:r.ok?'Message sent ✓':('Failed (HTTP '+(r.status||'?')+')')}); }catch(e){ setTest({state:'err',msg:e.message}); } loadLog(); }
  async function runReport(){ setReport({state:'sending'}); try{ const r=await api('cron/daily',{method:'POST'}); const n=(r.sent||[]).reduce((a,s)=>a+(s.sent||0),0); setReport({state:'ok',msg:`Ran ✓ — ${n} message(s) delivered`}); }catch(e){ setReport({state:'err',msg:e.message}); } loadLog(); }
  return <div className="max-w-2xl">
    <PageHead title="WhatsApp Alerts" subtitle="Send alerts to WhatsApp via TextMeBot — one firm-wide account key"/>
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div><div className="font-medium text-navy">Enable WhatsApp notifications</div><div className="text-xs text-slate-400">Master switch — if off, nobody receives anything</div></div>
        <Toggle on={enabled} onChange={setEnabled}/>
      </div>
      <div className="border-t border-slate-100 pt-4">
        <Field label="TextMeBot API key" hint={cfg&&cfg.hasApiKey?'Saved — leave blank to keep':'Required to send — paste your TextMeBot account key'}><Input type="password" autoComplete="new-password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={cfg&&cfg.apiKeyMasked?cfg.apiKeyMasked:'TextMeBot account key'}/></Field>
      </div>
      <div className="border-t border-slate-100 pt-4">
        <SectionTitle>Who gets notified</SectionTitle>
        <p className="text-xs text-slate-400 mb-3">Recipients are users who turned on WhatsApp in their <button onClick={()=>navigate('/profile')} className="text-gold hover:underline">profile</button>. Choose which role receives each message type.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-xs text-slate-500"><th className="text-left font-medium py-2 pr-3">Message type</th>{WA_ROLE_COLS.map(([k,l])=><th key={k} className="font-medium py-2 px-2 text-center w-20">{l}</th>)}</tr></thead>
          <tbody>
            {WA_MSG_TYPES.map(t=><tr key={t.key} className="border-t border-slate-50">
              <td className="py-2 pr-3 text-navy">{t.label}</td>
              {WA_ROLE_COLS.map(([role])=><td key={role} className="py-2 px-2 text-center"><input type="checkbox" checked={(matrix[t.key]||[]).includes(role)} onChange={()=>toggleMatrix(t.key,role)} className="accent-navy w-4 h-4"/></td>)}
            </tr>)}
          </tbody>
        </table></div>
      </div>
      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <Btn onClick={save} disabled={busy}>{busy?'Saving…':'Save settings'}</Btn>
        <Btn variant="outline" onClick={sendTest} disabled={!cfg}><Icon name="msg" className="w-4 h-4"/>Send test to me</Btn>
        {saved&&<span className="text-sm text-success flex items-center gap-1 fadein"><Icon name="check" className="w-4 h-4"/>Saved</span>}
        {test&&<span className={`text-sm flex items-center gap-1 ${test.state==='ok'?'text-success':test.state==='err'?'text-danger':'text-slate-400'}`}>{test.state==='sending'?'Sending…':test.msg}</span>}
      </div>
    </Card>

    <Card className="p-5 mt-4 space-y-4">
      <SectionTitle right={<span className="text-[11px] text-slate-400">checked daily · 08:00 Paris</span>}>Alert rules</SectionTitle>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Max drawdown alert (%)" hint="Alert when portfolio drawdown exceeds this"><Input type="number" value={ddPct} onChange={e=>setDdPct(e.target.value)} placeholder="10"/></Field>
        <Field label="Daily PnL alert ($)" hint="Alert when the day's PnL falls below this (e.g. -5000)"><Input type="number" value={pnlThr} onChange={e=>setPnlThr(e.target.value)} placeholder="-5000"/></Field>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 pt-4">
        <div><div className="text-sm font-medium text-navy">Daily portfolio report</div><div className="text-xs text-slate-400">Automatic WhatsApp summary every day at 08:00 (Europe/Paris)</div></div>
        <Toggle on={dailyReport} onChange={setDailyReport}/>
      </div>
      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <Btn onClick={save} disabled={busy}>{busy?'Saving…':'Save rules'}</Btn>
        <Btn variant="outline" onClick={runReport} disabled={!cfg||!cfg.enabled}><Icon name="trendup" className="w-4 h-4"/>Run report now</Btn>
        {report&&<span className={`text-sm flex items-center gap-1 ${report.state==='ok'?'text-success':report.state==='err'?'text-danger':'text-slate-400'}`}>{report.state==='sending'?'Running…':report.msg}</span>}
      </div>
    </Card>

    <Card className="p-5 mt-4 space-y-3">
      <SectionTitle right={<Btn variant="outline" size="sm" onClick={addRule}><Icon name="plus" className="w-3.5 h-3.5"/>Add rule</Btn>}>Scoped rules (per fund / bot)</SectionTitle>
      {rules.length===0&&<div className="text-sm text-slate-400 py-2">No scoped rules. The global thresholds above still apply to the whole portfolio.</div>}
      {rules.map((r,i)=><div key={r.id} className="flex flex-wrap items-center gap-2">
        <Select className="w-48" value={r.scope} onChange={v=>updateRule(i,{scope:v})} options={scopeOpts}/>
        <Select className="w-40" value={r.metric} onChange={v=>updateRule(i,{metric:v})} options={metricOpts}/>
        <Input type="number" className="w-24" value={r.value} onChange={e=>updateRule(i,{value:e.target.value})}/>
        <div data-tip="Enabled"><Toggle on={r.enabled} onChange={v=>updateRule(i,{enabled:v})} size="sm"/></div>
        <button onClick={()=>setRules(rs=>rs.filter((_,j)=>j!==i))} className="text-slate-400 hover:text-danger p-1"><Icon name="trash" className="w-4 h-4"/></button>
      </div>)}
      <div className="flex items-center gap-3 pt-1"><Btn onClick={save} disabled={busy}>{busy?'Saving…':'Save rules'}</Btn><span className="text-[11px] text-slate-400">Drawdown alerts when the scope's drawdown exceeds the % · PnL alerts when the day's PnL falls below the $ value · evaluated daily.</span></div>
    </Card>

    <Card className="p-5 mt-4">
      <SectionTitle>How it works</SectionTitle>
      <p className="text-sm text-slate-600 mb-4"><span className="font-mono text-xs bg-slate-100 px-1 rounded">TextMeBot</span> is a hosted WhatsApp relay — <span className="font-medium">no server to run</span>. One shared TextMeBot account key (set above, <span className="font-medium">encrypted at rest</span>) sends to every opted-in user's number; the backend just makes an HTTPS request. Recipients must have their WhatsApp number registered with TextMeBot. The matrix above decides which role gets each message type. <span className="text-slate-400">(Send-only: acknowledge alerts from the bell; the monthly PDF stays downloadable under Reports.)</span></p>
      <SectionTitle>Active alerts</SectionTitle>
      <ul className="text-sm text-slate-600 space-y-2">
        <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-success mt-0.5"/>Login-failure alerts to admins (after 3 failed attempts)</li>
        <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-success mt-0.5"/>Drawdown &amp; daily-PnL breaches — portfolio, per fund, or per bot</li>
        <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-success mt-0.5"/>Daily report, plus weekly (Mondays) &amp; monthly (1st) summaries</li>
      </ul>
    </Card>

    <Card className="p-5 mt-4">
      <SectionTitle right={<button onClick={loadLog} className="text-xs text-slate-400 hover:text-navy flex items-center gap-1"><Icon name="refresh" className="w-3.5 h-3.5"/>Refresh</button>}>Sent messages</SectionTitle>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]"><Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={logQ} onChange={e=>setLogQ(e.target.value)} placeholder="Filter by name, number or message…" className="w-full bg-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"/></div>
        <Select value={logStatus} onChange={setLogStatus} className="w-32" options={[{value:'all',label:'All'},{value:'ok',label:'Sent'},{value:'fail',label:'Failed'}]}/>
      </div>
      {log===null? <div className="text-sm text-slate-400">Loading…</div>
        : filteredLog.length===0? <div className="text-sm text-slate-400 py-3">{log.length===0?'No WhatsApp messages sent yet.':'No messages match the filter.'}</div>
        : <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500 text-left">
              <th className="px-3 py-2 font-medium">Recipient</th>
              <th className="px-3 py-2 font-medium">Number</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Sent at</th>
              <th className="px-3 py-2 font-medium">Message</th>
            </tr></thead>
            <tbody>
              {filteredLog.map(l=><tr key={l.id} className="border-b border-slate-50 align-top">
                <td className="px-3 py-2 whitespace-nowrap"><span className="inline-flex items-center gap-2"><span className={`w-2 h-2 rounded-full shrink-0 ${l.ok?'bg-success':'bg-danger'}`} title={l.ok?'Sent':'Failed'}/>{l.recipientName||<span className="text-slate-400">—</span>}</span></td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500 whitespace-nowrap">{l.phone}</td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap text-xs">{fmtDT(l.createdAt)}</td>
                <td className="px-3 py-2"><div className="text-navy whitespace-pre-wrap break-words max-w-md leading-snug">{l.message}</div>{!l.ok&&l.response&&<div className="text-[11px] text-danger break-words max-w-md mt-1" title={l.response}>{l.response}</div>}</td>
              </tr>)}
            </tbody>
          </table></div>}
    </Card>
  </div>;
}

/* ============================================================
   FUNDS — global CRUD (admins) / read-only list (operators, viewers)
   ============================================================ */
// Row of clickable colour chips from FUND_PALETTE.
function ColorPicker({value,onChange}){
  return <div className="flex flex-wrap gap-1.5">
    {FUND_PALETTE.map(c=><button key={c} type="button" onClick={()=>onChange(c)} title={c}
      className={`w-7 h-7 rounded-full transition ${value===c?'ring-2 ring-offset-2 ring-navy':'hover:scale-110'}`} style={{background:c}}>
      {value===c&&<Icon name="check" className="w-4 h-4 text-white mx-auto"/>}
    </button>)}
  </div>;
}
function FundModal({open,initial,onClose,onSave}){
  const [name,setName]=useState(''); const [color,setColor]=useState(FUND_PALETTE[0]); const [busy,setBusy]=useState(false);
  useEffect(()=>{ if(open){ setName(initial?.name||''); setColor(initial?.color||FUND_PALETTE[0]); setBusy(false); } },[open,initial]);
  if(!open) return null;
  const save=async()=>{ if(!name.trim())return; setBusy(true); try{ await onSave({name:name.trim(),color}); }catch(e){ toast.error(e.message); setBusy(false); } };
  return <Modal open={open} onClose={onClose} title={initial?'Edit fund':'Create fund'}>
    <div className="space-y-4">
      <Field label="Name"><Input value={name} autoFocus onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')save();}} placeholder="Delta Fund"/></Field>
      <Field label="Colour" hint="Shown as a coloured dot here and as an emoji in the WhatsApp report"><ColorPicker value={color} onChange={setColor}/></Field>
      <div className="flex justify-end gap-2 pt-1"><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy||!name.trim()}>{busy?'Saving…':(initial?'Save':'Create')}</Btn></div>
    </div>
  </Modal>;
}
function FundsPage(){
  const {funds,user,reloadData}=useApp();
  const isAdmin=user.role==='admin';
  const [modal,setModal]=useState(null); const [del,setDel]=useState(null);
  if(!hasPerm(user,'view_trades')) return <Denied/>;
  async function createFund(v){ await api('funds',{method:'POST',body:v}); await reloadData(); setModal(null); toast.success('Fund created'); }
  async function editFund(v){ await api('funds',{method:'PATCH',body:{id:modal.id,...v}}); await reloadData(); setModal(null); toast.success('Fund updated'); }
  async function removeFund(){ try{ await api('funds',{method:'DELETE',body:{id:del.id}}); await reloadData(); toast.success('Fund deleted — its bots are now unassigned'); }catch(e){ toast.error(e.message); } setDel(null); }
  return <div>
    <PageHead title="Funds" subtitle="Group your positions into funds — each gets a colour used in reports"
      actions={isAdmin&&<Btn onClick={()=>setModal({})}><Icon name="plus" className="w-4 h-4"/>New fund</Btn>}/>
    {funds.length===0? <EmptyState icon="layers" title="No funds yet"
        hint={isAdmin?'Create your first fund, then assign positions to it from the Bots page.':'No funds have been created yet.'}
        action={isAdmin&&<Btn onClick={()=>setModal({})}><Icon name="plus" className="w-4 h-4"/>Create a fund</Btn>}/>
    : <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {funds.map(f=><Card key={f.id} className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-4 h-4 rounded-full shrink-0" style={{background:f.color}}/>
            <span className="font-semibold text-navy truncate">{f.name}</span>
          </div>
          {isAdmin&&<div className="flex gap-1 shrink-0">
            <button onClick={()=>setModal(f)} className="text-slate-400 hover:text-navy p-1" data-tip="Edit"><Icon name="pencil" className="w-4 h-4"/></button>
            <button onClick={()=>setDel(f)} className="text-slate-400 hover:text-danger p-1" data-tip="Delete"><Icon name="trash" className="w-4 h-4"/></button>
          </div>}
        </div>
        <div className="flex items-center gap-4 mt-4 text-sm">
          <div><div className="text-[11px] text-slate-400">Bots</div><div className="text-lg font-bold text-navy tnum">{f.botCount}</div></div>
          <div><div className="text-[11px] text-slate-400">Open</div><div className="text-lg font-bold text-success tnum">{f.openCount}</div></div>
        </div>
      </Card>)}
    </div>}
    <FundModal open={!!modal} initial={modal&&modal.id?modal:null} onClose={()=>setModal(null)} onSave={modal&&modal.id?editFund:createFund}/>
    <Confirm open={!!del} title="Delete fund" confirmLabel="Delete fund"
      message={`Delete "${del?.name}"? Its ${del?.botCount||0} bot(s) will become unassigned (not deleted). This cannot be undone.`}
      onCancel={()=>setDel(null)} onConfirm={removeFund}/>
  </div>;
}

/* ============================================================
   ADMIN — BOTS (auto-detected positions; assign to funds, sync)
   ============================================================ */
function BotsPage(){
  const {funds,user,data,reloadData}=useApp();
  const [syncing,setSyncing]=useState(false); const [del,setDel]=useState(null);
  if(user.role!=='admin') return <Denied/>;
  const fundOpts=[{value:'',label:'— Unassigned —'},...funds.map(f=>({value:f.id,label:f.name}))];

  async function assign(id,fundId){ try{ await api('bots',{method:'PATCH',body:{id,fundId:fundId||null}}); await reloadData(); }catch(e){ toast.error(e.message); } }
  async function removeBot(){ try{ await api('bots',{method:'DELETE',body:{id:del.id}}); await reloadData(); toast.success('Bot removed'); }catch(e){ toast.error(e.message); } setDel(null); }
  async function sync(){ setSyncing(true); try{ const r=await api('bots',{method:'POST',body:{action:'sync'}}); await reloadData(); if(r.errors){ toast.error((r.errorMsgs&&r.errorMsgs[0])||`${r.errors} exchange${r.errors===1?'':'s'} failed to sync`); } else if(!r.connected){ toast.error('No exchange connected — add a Binance key under Exchanges.'); } else { toast.success(`Synced — ${r.positions} position${r.positions===1?'':'s'}, ${r.created} new`); } }catch(e){ toast.error(e.message); } finally{ setSyncing(false); } }

  const bots=data.bots;
  const unassigned=bots.filter(b=>b.status==='open'&&!b.fundId);
  const lastSynced=data.live&&data.live.syncedAt? fmtAgo(data.live.syncedAt) : 'never';

  const Row=({b})=>{ return <tr className="border-b border-slate-50 hover:bg-slate-50/60">
    <td className="px-3 py-2.5 font-mono text-xs text-navy">{b.symbol}<div className="text-[10px] text-slate-400 capitalize">{b.exchange}</div></td>
    <td className="px-3 py-2.5"><SideTag side={b.side}/></td>
    <td className="px-3 py-2.5 text-right tnum text-slate-500">{fmtNum(b.qty,b.qty&&b.qty<1?4:2)}</td>
    <td className={`px-3 py-2.5 text-right font-medium tnum ${clsPnl(b.unrealizedPnl)}`}>{fmtSigned(b.unrealizedPnl)}</td>
    <td className="px-3 py-2.5 text-right tnum text-slate-500 hidden sm:table-cell">{fmtUSD(Math.abs(b.notional))}</td>
    <td className="px-3 py-2.5"><StatusPill status={b.status==='open'?'active':'inactive'}/></td>
    <td className="px-3 py-2.5"><Select className="w-40" value={b.fundId||''} onChange={v=>assign(b.id,v)} options={fundOpts}/></td>
    <td className="px-3 py-2.5 text-right"><button onClick={()=>setDel(b)} className="text-slate-300 hover:text-danger p-1" data-tip="Remove bot"><Icon name="trash" className="w-4 h-4"/></button></td>
  </tr>; };
  const head=<tr className="border-b border-slate-100 text-slate-500">
    <th className="px-3 py-2.5 text-left font-medium">Symbol</th><th className="px-3 py-2.5 text-left font-medium">Side</th>
    <th className="px-3 py-2.5 text-right font-medium">Qty</th><th className="px-3 py-2.5 text-right font-medium">Open PnL</th>
    <th className="px-3 py-2.5 text-right font-medium hidden sm:table-cell">Notional</th><th className="px-3 py-2.5 text-left font-medium">Status</th>
    <th className="px-3 py-2.5 text-left font-medium">Fund</th><th className="px-3 py-2.5 w-10"></th>
  </tr>;

  return <div>
    <PageHead title="Bots" subtitle="Auto-detected positions — assign each to a fund"
      actions={<div className="flex items-center gap-3">
        <span className="hidden sm:block text-xs text-slate-400">last synced {lastSynced}</span>
        <Btn onClick={sync} disabled={syncing}><Icon name="refresh" className={`w-4 h-4 ${syncing?'animate-spin':''}`}/>{syncing?'Syncing…':'Sync now'}</Btn>
      </div>}/>

    {bots.length===0? <EmptyState icon="list" title="No bots yet"
        hint="Bots appear automatically when a position is detected on a connected exchange. Add a Binance key under Exchanges, then Sync now."/>
    : <>
      {/* Unassigned inbox — needs attention */}
      {unassigned.length>0&&<Card className="overflow-hidden mb-5 border border-gold/30">
        <div className="p-4 pb-2 flex items-center gap-2"><Icon name="triangle" className="w-4 h-4 text-gold"/><span className="text-sm font-semibold text-navy">Unassigned positions</span><span className="text-[11px] text-slate-400">{unassigned.length} need a fund</span></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs">{head}</thead>
          <tbody>{unassigned.map(b=><Row key={b.id} b={b}/>)}</tbody>
        </table></div>
      </Card>}

      {/* All bots */}
      <Card className="overflow-hidden">
        <div className="p-5 pb-0"><SectionTitle right={<span className="text-[11px] text-slate-400">{bots.filter(b=>b.status==='open').length} open · {bots.filter(b=>b.status==='closed').length} closed</span>}>All Bots</SectionTitle></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs">{head}</thead>
          <tbody>{bots.map(b=><Row key={b.id} b={b}/>)}</tbody>
        </table></div>
      </Card>
    </>}

    <Confirm open={!!del} title="Remove bot" confirmLabel="Remove"
      message={`Remove ${del?.symbol} (${del?.exchange})? It will reappear on the next sync if the position is still open.`}
      onCancel={()=>setDel(null)} onConfirm={removeBot}/>
  </div>;
}

/* ============================================================
   PROFILE
   ============================================================ */
function ProfilePage(){
  const {user,setUser}=useApp();
  const [v,setV]=useState({firstName:user.firstName,lastName:user.lastName}); const [saved,setSaved]=useState(false);
  const [pw,setPw]=useState({cur:'',n1:'',n2:''}); const [pwMsg,setPwMsg]=useState(null);
  const [notify,setNotify]=useState(user.notify); const [phone,setPhone]=useState(user.phone||'');
  const fileRef=useRef();
  async function patchSelf(patch){ try{ const r=await api('profile',{method:'PATCH',body:patch}); setUser(r.user); return true; }catch(e){ toast.error(e.message); return false; } }
  async function saveInfo(){ if(await patchSelf({firstName:v.firstName,lastName:v.lastName})){ setSaved(true); setTimeout(()=>setSaved(false),1800); } }
  async function changePw(){ if(!passwordOk(pw.n1))return setPwMsg({err:'New password does not meet all the requirements.'}); if(pw.n1!==pw.n2)return setPwMsg({err:'Confirmation must match'}); try{ await api('auth',{method:'POST',body:{action:'changePassword',current:pw.cur,next:pw.n1}}); setPw({cur:'',n1:'',n2:''}); setPwMsg({ok:'Password updated'}); }catch(e){ setPwMsg({err:e.message||'Could not update password'}); } }
  function upload(e){ const file=e.target.files[0]; if(!file)return; if(!['image/png','image/jpeg'].includes(file.type))return toast.error('Accepted formats: PNG, JPEG'); if(file.size>5*1024*1024)return toast.error('Maximum file size is 5 MB'); const r=new FileReader(); r.onload=()=>patchSelf({avatar:r.result}); r.readAsDataURL(file); }
  return <div className="max-w-2xl">
    <PageHead title="Profile & Settings" subtitle="Manage your personal account details"/>
    <Card className="p-5 mb-4">
      <div className="flex items-center gap-4 mb-5">
        <div className="relative">
          {user.avatar?<img src={user.avatar} className="w-20 h-20 rounded-full object-cover"/>:<span className="w-20 h-20 rounded-full bg-navy text-white grid place-items-center text-xl font-semibold">{initialsOf(user)}</span>}
          <button onClick={()=>fileRef.current.click()} className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-gold text-navy grid place-items-center shadow"><Icon name="camera" className="w-4 h-4"/></button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={upload}/>
        </div>
        <div><div className="font-semibold text-navy text-lg">{user.firstName||user.email}</div><div className="text-sm text-slate-400">{user.email} · {user.role}</div><div className="text-[11px] text-slate-400 mt-1">PNG or JPEG · max 5 MB</div></div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="First name"><Input value={v.firstName} onChange={e=>setV({...v,firstName:e.target.value})}/></Field>
        <Field label="Last name"><Input value={v.lastName} onChange={e=>setV({...v,lastName:e.target.value})}/></Field>
        <Field label="Email" hint="Contact an admin to change your email" className="sm:col-span-2"><Input value={user.email} disabled className="bg-slate-50 text-slate-400"/></Field>
      </div>
      <div className="flex items-center gap-3 mt-4"><Btn onClick={saveInfo}>Save changes</Btn>{saved&&<span className="text-sm text-success flex items-center gap-1 fadein"><Icon name="check" className="w-4 h-4"/>Changes saved</span>}</div>
    </Card>

    {user.authProvider==='google'
      ? <Card className="p-5 mb-4"><SectionTitle>Sign-in</SectionTitle>
          <div className="flex items-center gap-3 text-sm text-slate-600"><span className="w-9 h-9 rounded-lg bg-gold/15 text-gold grid place-items-center shrink-0"><Icon name="shield" className="w-5 h-5"/></span>
            <div>You sign in with <span className="font-medium text-navy">Google</span> (<span className="font-mono">{user.email}</span>). There's no password to manage.</div></div>
        </Card>
      : <Card className="p-5 mb-4">
          <SectionTitle>Change Password</SectionTitle>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Current password"><Input type="password" value={pw.cur} onChange={e=>setPw({...pw,cur:e.target.value})}/></Field>
            <Field label="New password"><Input type="password" value={pw.n1} onChange={e=>setPw({...pw,n1:e.target.value})}/></Field>
            <Field label="Confirm new"><Input type="password" value={pw.n2} onChange={e=>setPw({...pw,n2:e.target.value})}/></Field>
          </div>
          {pw.n1&&<div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 mt-2">
            {PW_RULES.map(([label,fn])=>{ const ok=fn(pw.n1); return <div key={label} className={`flex items-center gap-1.5 text-[11px] ${ok?'text-success':'text-slate-400'}`}><Icon name={ok?'check':'x'} className="w-3 h-3 shrink-0"/>{label}</div>; })}
          </div>}
          <div className="flex items-center gap-3 mt-4"><Btn onClick={changePw}>Update password</Btn>
            {pwMsg?.err&&<span className="text-sm text-danger">{pwMsg.err}</span>}{pwMsg?.ok&&<span className="text-sm text-success flex items-center gap-1"><Icon name="check" className="w-4 h-4"/>{pwMsg.ok}</span>}</div>
        </Card>}

    <Card className="p-5">
      <SectionTitle>WhatsApp Notifications</SectionTitle>
      <div className="flex items-center justify-between mb-3">
        <div><div className="text-sm font-medium text-navy">Receive notifications</div><div className="text-xs text-slate-400">{user.role==='shareholder'?'Get a WhatsApp when a new report is available':'WhatsApp alerts must also be enabled by an admin to deliver'}</div></div>
        <Toggle on={notify} onChange={async x=>{setNotify(x);if(await patchSelf({notify:x})&&x&&phone)toast.success('WhatsApp notifications on — welcome message sent');}}/>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Your phone number"><Input value={phone} onChange={e=>setPhone(e.target.value)} onBlur={()=>patchSelf({phone})} placeholder="+33 6 12 34 56 78"/></Field>
      </div>
      <div className="text-[11px] text-slate-500 mt-2 space-y-1 bg-navy/5 border border-slate-200 rounded-lg p-3">
        <div>Alerts are delivered through the firm's <span className="font-medium text-slate-600">TextMeBot</span> number — there's no personal key to set up. To receive them, make sure your WhatsApp number above is registered with TextMeBot. If you don't get the welcome message after turning notifications on, ask an admin to add your number.</div>
      </div>
    </Card>
  </div>;
}

/* ============================================================
   SUPPORT
   ============================================================ */
function SupportPage(){
  return <div className="max-w-2xl">
    <PageHead title="Support" subtitle="Contact LNO support for technical issues or production incidents"/>
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-5"><span className="w-12 h-12 rounded-xl bg-gold/15 text-gold grid place-items-center"><Icon name="lifebuoy" className="w-6 h-6"/></span>
        <div><div className="font-semibold text-navy">LNO Support</div><div className="text-sm text-slate-400">Technical issues · account questions · incidents</div></div></div>
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-3"><Icon name="mail" className="w-4 h-4 text-slate-400"/><a href="mailto:support@lno.company" className="text-navy hover:text-gold font-medium">support@lno.company</a></div>
        <div className="flex items-center gap-3"><Icon name="clock" className="w-4 h-4 text-slate-400"/><span className="text-slate-600">Response time: within 4 business hours</span></div>
        <div className="flex items-start gap-3"><Icon name="triangle" className="w-4 h-4 text-amber-500 mt-0.5"/><span className="text-slate-600">For urgent incidents, include <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">[URGENT]</span> in the email subject line for priority handling.</span></div>
      </div>
    </Card>
  </div>;
}

/* ============================================================
   SYSTEM STATUS
   ============================================================ */
const PRICE_SYMBOLS=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT','ATOMUSDT','NEARUSDT'];
// Live public crypto prices (Binance public REST, CORS-enabled, no key). Independent of the account.
function PricesPage(){
  const {user}=useApp();
  const [rows,setRows]=useState(null); const [err,setErr]=useState(false); const [ts,setTs]=useState(null);
  const [order,setOrder]=useState(()=>PREF.get('prices_order',[])); const [drag,setDrag]=useState(null);
  useEffect(()=>{
    if(!hasPerm(user,'view_activity')) return;
    let alive=true;
    const load=async()=>{
      try{
        // Binance USDⓈ-M FUTURES 24h tickers (public, no key). The futures endpoint has no
        // `symbols` batch param → fetch all and filter to our list.
        const r=await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr',{cache:'no-store'});
        if(!r.ok) throw 0; const all=await r.json(); if(!alive) return;
        const want=new Set(PRICE_SYMBOLS); const j=(Array.isArray(all)?all:[]).filter(t=>want.has(t.symbol));
        setRows(j.map(t=>({symbol:t.symbol,base:baseOf(t.symbol),price:+t.lastPrice,chg:+t.priceChangePercent,vol:+t.quoteVolume,high:+t.highPrice,low:+t.lowPrice})).sort((a,b)=>b.vol-a.vol));
        setErr(false); setTs(Date.now());
      }catch(e){ if(alive){ setErr(true); setRows(p=>p||[]); } }
    };
    load(); const iv=setInterval(load,20000); return ()=>{alive=false;clearInterval(iv);};
  },[]);
  // apply the user's saved drag order; unknown/new symbols fall to the end (by volume)
  const ordered=useMemo(()=>{ if(!rows||!order.length) return rows; const idx=s=>{ const i=order.indexOf(s); return i<0?1e9:i; }; return rows.slice().sort((a,b)=>idx(a.symbol)-idx(b.symbol)||b.vol-a.vol); },[rows,order]);
  if(!hasPerm(user,'view_activity')) return <Denied/>;
  const compact=(n)=>{ const a=Math.abs(n); return a>=1e9?(n/1e9).toFixed(2)+'B':a>=1e6?(n/1e6).toFixed(1)+'M':a>=1e3?(n/1e3).toFixed(0)+'K':String(Math.round(n)); };
  const px=(p)=>fmtPrice(p).replace(' USDT','');
  const onDrop=(targetSym)=>{ const cur=(ordered||[]).map(r=>r.symbol); const from=cur.indexOf(drag); if(from<0||drag===targetSym){ setDrag(null); return; } cur.splice(from,1); const to=cur.indexOf(targetSym); cur.splice(to<0?cur.length:to,0,drag); setOrder(cur); PREF.set('prices_order',cur); setDrag(null); };
  return <div>
    <PageHead title="Prices" subtitle="Live Binance futures prices · drag a card to reorder" actions={<div className="flex items-center gap-3">
      {order.length>0&&<button onClick={()=>{setOrder([]);PREF.set('prices_order',[]);}} className="text-xs text-slate-400 hover:text-navy">Reset order</button>}
      {ts&&<span className="text-xs text-slate-400">Updated {fmtAgo(ts)}</span>}
    </div>}/>
    {rows==null? <Card className="p-10 text-center text-slate-400 text-sm">Loading prices…</Card>
     : err&&!rows.length? <Card className="p-10 text-center text-slate-400 text-sm">Couldn't load prices right now — retrying…</Card>
     : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {ordered.map(t=><div key={t.symbol} draggable
          onDragStart={()=>setDrag(t.symbol)} onDragOver={e=>e.preventDefault()} onDrop={()=>onDrop(t.symbol)} onDragEnd={()=>setDrag(null)}
          className={`cursor-move select-none transition ${drag===t.symbol?'opacity-40':''}`}>
          <Card className={`p-4 h-full ${drag===t.symbol?'ring-2 ring-gold':''}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-9 h-9 rounded-full bg-navy text-white grid place-items-center text-[11px] font-bold shrink-0">{t.base.slice(0,4)}</span>
                <div className="min-w-0 leading-tight"><div className="font-semibold text-navy truncate">{t.base}</div><div className="text-[11px] text-slate-400">/USDT</div></div>
              </div>
              <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${t.chg>=0?'bg-success/10 text-success':'bg-danger/10 text-danger'}`}>{t.chg>=0?'▲':'▼'} {Math.abs(t.chg).toFixed(1)}%</span>
            </div>
            <div className="text-lg font-bold text-navy mt-3 tabular-nums truncate">{fmtPrice(t.price)}</div>
            <div className="flex items-center justify-between gap-1 text-[11px] text-slate-400 mt-2 tabular-nums">
              <span>H {px(t.high)}</span><span>L {px(t.low)}</span><span className="text-slate-500">Vol {compact(t.vol)}</span>
            </div>
          </Card>
        </div>)}
      </div>}
    <p className="text-[11px] text-slate-400 mt-3">Public market data from Binance · refreshes every 20s · independent of your account &amp; positions.</p>
  </div>;
}

function StatusPage(){
  const {user,data,dataStatus,reloadData}=useApp();
  const [snaps,setSnaps]=useState(null); const [alerts,setAlerts]=useState(null); const [openwa,setOpenwa]=useState(undefined); const [dbErr,setDbErr]=useState(null);
  const [exchanges,setExchanges]=useState(null);
  const [wipe,setWipe]=useState(false); const [wiping,setWiping]=useState(false);
  async function doReset(){ setWiping(true); try{ await api('init',{method:'POST',body:{action:'reset'}}); toast.success('Trading data reset — accounts kept'); reloadData&&reloadData(); }catch(e){ toast.error(e.message); } finally{ setWiping(false); setWipe(false); } }
  useEffect(()=>{
    api('snapshots?limit=3').then(r=>setSnaps(r.snapshots||[])).catch(e=>{ setSnaps([]); setDbErr(e.message); });
    api('alerts').then(r=>setAlerts(r.alerts||[])).catch(()=>setAlerts([]));
    if(user.role==='admin'){ api('openwa').then(r=>setOpenwa(r.config)).catch(()=>setOpenwa(null)); api('exchanges').then(r=>setExchanges(r.exchanges||[])).catch(()=>setExchanges([])); }
  },[]);
  if(!hasPerm(user,'view_activity')) return <Denied/>;

  const live=data.live; const connected=live?live.connected:0;
  const syncErr=dataStatus==='partial';
  const lastSnap=snaps&&snaps.length? snaps[snaps.length-1] : null;
  const dbOk=dbErr==null;
  const unacked=(alerts||[]).filter(a=>!a.ackedAt);
  const acked=(alerts||[]).filter(a=>a.ackedAt);
  const mttaMin=acked.length? acked.reduce((s,a)=>s+(new Date(a.ackedAt)-new Date(a.createdAt)),0)/acked.length/60000 : null;
  const ackRate=(alerts&&alerts.length)? acked.length/alerts.length*100 : null;

  const checks=[
    {label:'Exchange sync', state:connected>0?(syncErr?'warn':'ok'):'neutral', sub:connected>0?(syncErr?'Connected · last sync had errors':`${connected} exchange${connected===1?'':'s'} connected`):'No exchange connected'},
    {label:'Database', state:dbOk?'ok':'down', sub:dbOk?(lastSnap?`Last snapshot ${lastSnap.day}`:'Connected'):'Unreachable'},
    {label:'Positions', state:data.openBots.length?'ok':'neutral', sub:`${data.openBots.length} open · ${data.bots.length} tracked`},
    {label:'Alerting', state:alerts==null?'neutral':'ok', sub:alerts==null?'Checking…':`${unacked.length} pending acknowledgement`},
    ...(user.role==='admin'?[{label:'WhatsApp (TextMeBot)', state:openwa==null?'neutral':openwa.enabled?(openwa.hasApiKey?'ok':'warn'):'neutral', sub:openwa===undefined?'Checking…':openwa===null?'—':openwa.enabled?(openwa.hasApiKey?'Enabled & configured':'Enabled · no API key'):'Disabled (optional)'}]:[]),
  ];
  const anyDown=checks.some(c=>c.state==='down'); const anyWarn=checks.some(c=>c.state==='warn');
  const overall=anyDown?['Degraded','bg-danger','text-danger']:anyWarn?['Partial outage','bg-amber-500','text-amber-600']:['All systems operational','bg-success','text-success'];
  const dotCls=(s)=>s==='ok'?'bg-success':s==='warn'?'bg-amber-500':s==='down'?'bg-danger':'bg-slate-300';

  return <div>
    <PageHead title="System Status" subtitle="Health of exchange sync, database, alerting and integrations"/>
    <Card className="p-5 mb-5 flex items-center gap-3">
      <span className={`w-3 h-3 rounded-full ${overall[1]} ${anyDown?'':'pulse-dot'}`}/>
      <span className={`text-lg font-semibold ${overall[2]}`}>{overall[0]}</span>
      <span className="ml-auto"><LiveBadge status={dataStatus}/></span>
    </Card>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
      {checks.map(c=><Card key={c.label} className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-navy">{c.label}</span>
          <span className={`w-2.5 h-2.5 rounded-full ${dotCls(c.state)}`}/>
        </div>
        <div className="text-xs text-slate-500 mt-1.5">{c.sub}</div>
      </Card>)}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <Card className="p-5">
        <SectionTitle right={<span className="text-[11px] text-slate-400">{live&&live.syncedAt?`synced ${fmtAgo(live.syncedAt)}`:'never synced'}</span>}>Exchange Connections</SectionTitle>
        {user.role!=='admin'? <div className="text-sm text-slate-400">{connected>0?`${connected} exchange${connected===1?'':'s'} connected.`:'No exchange connected.'}</div>
        : exchanges==null? <div className="text-sm text-slate-400">Loading…</div>
        : exchanges.length===0? <div className="text-sm text-slate-400">No exchange connections yet — add one under Exchanges.</div>
        : <div className="space-y-2">
          {exchanges.map(e=><div key={e.id} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${e.status==='connected'?'bg-success':e.status==='error'?'bg-danger':'bg-slate-300'}`}/>{e.label||e.name}</span>
            <span className="font-mono text-xs text-slate-400">{e.lastSync?fmtAgo(e.lastSync):'—'}</span>
          </div>)}
        </div>}
      </Card>
      <Card className="p-5">
        <SectionTitle right={<span className="text-[11px] text-slate-400">acknowledgement</span>}>Alert Analytics</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Mean time to ack</div><div className="text-lg font-bold text-navy mt-0.5">{mttaMin==null?'—':fmtDur(mttaMin)}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Ack rate</div><div className="text-lg font-bold text-navy mt-0.5">{ackRate==null?'—':fmtPctPlain(ackRate)}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Total alerts</div><div className="text-lg font-bold text-navy mt-0.5">{alerts==null?'—':alerts.length}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Pending ack</div><div className={`text-lg font-bold mt-0.5 ${unacked.length?'text-danger':'text-navy'}`}>{alerts==null?'—':unacked.length}</div></div>
        </div>
        <div className="text-[11px] text-slate-400 mt-3">{lastSnap?`Last recorded snapshot ${lastSnap.day} · ${fmtAgo(lastSnap.day)}`:'No recorded snapshots yet — the daily cron writes one per day.'}</div>
      </Card>
    </div>
    {user.role==='admin'&&<Card className="p-5 mt-5">
      <SectionTitle>Maintenance</SectionTitle>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="text-sm text-slate-600 max-w-md">Wipe all trading data — bots, funds, exchanges, equity snapshots, reports, alerts, the WhatsApp log and sign-in history. <span className="font-medium text-navy">User accounts and settings are kept.</span> Use this once when going live, to clear test data.</div>
        <Btn variant="danger" onClick={()=>setWipe(true)}><Icon name="trash" className="w-4 h-4"/>Reset data</Btn>
      </div>
    </Card>}
    <Confirm open={wipe} title="Reset all trading data?" message="This permanently deletes bots, funds, exchanges, snapshots, reports, alerts, the WhatsApp log and sign-in history. User accounts and settings are kept. This cannot be undone." confirmLabel={wiping?'Resetting…':'Reset everything'} onCancel={()=>setWipe(false)} onConfirm={doReset}/>
  </div>;
}

/* ============================================================
   ADMIN — REPORT ARCHIVE
   ============================================================ */
function AdminReports(){
  const {user}=useApp();
  const isAdmin=user.role==='admin';
  const [reports,setReports]=useState(null); const [busy,setBusy]=useState(false); const [dl,setDl]=useState(null);
  const load=()=>api('snapshots?reports=list').then(r=>setReports(r.reports||[])).catch(()=>setReports([]));
  useEffect(()=>{ if(hasPerm(user,'view_reports')) load(); },[]);
  if(!hasPerm(user,'view_reports')) return <Denied/>;
  async function generate(){ setBusy(true); try{ await api('snapshots',{method:'POST',body:{action:'generateReport'}}); toast.success('Report generated & archived'); load(); }catch(e){ toast.error(e.message); } finally{ setBusy(false); } }
  async function download(rep){ setDl(rep.id); try{ const r=await api('snapshots?report='+rep.id); downloadBlob(b64ToBlob(r.pdfBase64), r.filename||('lno-report-'+rep.periodLabel+'.pdf')); toast.success('Report downloaded'); }catch(e){ toast.error(e.message); } finally{ setDl(null); } }
  return <div>
    <PageHead title="Reports" subtitle={isAdmin?'Archive of generated portfolio reports — re-download any as PDF':'Download past portfolio reports'}
      actions={isAdmin&&<Btn onClick={generate} disabled={busy}><Icon name="filetext" className="w-4 h-4"/>{busy?'Generating…':'Generate report now'}</Btn>}/>
    {reports==null? <Card className="p-10 text-center text-slate-400 text-sm">Loading…</Card>
    : reports.length===0? <Card className="p-10 text-center text-slate-400 text-sm"><Icon name="filetext" className="w-10 h-10 mx-auto text-slate-200 mb-2"/>{isAdmin?'No reports yet. Generate one now, or wait for the monthly cron (1st of each month).':'No reports available yet.'}</Card>
    : <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
          <th className="px-4 py-2.5 text-left font-medium">Kind</th>
          <th className="px-4 py-2.5 text-left font-medium">Period</th>
          <th className="px-4 py-2.5 text-right font-medium">Equity</th>
          <th className="px-4 py-2.5 text-right font-medium">PnL 30d</th>
          <th className="px-4 py-2.5 text-left font-medium hidden sm:table-cell">Generated</th>
          <th className="px-4 py-2.5"></th>
        </tr></thead>
        <tbody>
          {reports.map(r=><tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
            <td className="px-4 py-2.5 capitalize"><span className="inline-flex items-center gap-1.5"><Icon name="filetext" className="w-4 h-4 text-gold"/>{r.kind}</span></td>
            <td className="px-4 py-2.5 font-mono text-xs">{r.periodLabel}</td>
            <td className="px-4 py-2.5 text-right tnum">{fmtUSD(r.equity)}</td>
            <td className={`px-4 py-2.5 text-right tnum ${clsPnl(r.pnl)}`}>{fmtSigned(r.pnl)}</td>
            <td className="px-4 py-2.5 text-slate-500 hidden sm:table-cell">{fmtDT(r.createdAt)}</td>
            <td className="px-4 py-2.5 text-right"><Btn size="sm" variant="outline" disabled={dl===r.id} onClick={()=>download(r)}><Icon name="download" className="w-4 h-4"/>{dl===r.id?'…':'PDF'}</Btn></td>
          </tr>)}
        </tbody>
      </table></div></Card>}
  </div>;
}


export {
  ActivityPage, RealtimePage, useVirtual, ColumnPicker, PresetMenu, POS_COLS, POS_GETTERS, TradesPage, UserLoginHistory, AdminUsers, PW_RULES, passwordOk, AdminSetPassword, genPassword, AddUserModal, AdminExchanges, ExchangeModal, AdminOpenWA, ColorPicker, FundModal, FundsPage, BotsPage, ProfilePage, SupportPage, PRICE_SYMBOLS, PricesPage, StatusPage, AdminReports
};
