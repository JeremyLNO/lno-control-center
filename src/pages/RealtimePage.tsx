import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  fmtUSD, fmtSigned, fmtNum, clsPnl, fmtPrice, fmtAgo, api, Card, SectionTitle, Badge, Select, useApp,
  hasPerm, fundOf, LiveBadge, MarketTicker, PageHead, Denied, KpiCard, SortHeader, sortRows, EmptyState, SideTag, FundTag
} from '../ui'

/* ============================================================
   REAL-TIME OPERATIONS
   ============================================================ */
function RealtimePage(){
  const {funds,user,data,dataStatus}=useApp();
  const [fund,setFund]=useState('all');
  const [sort,setSort]=useState({col:'uPnl',dir:'desc'});
  const [incidents,setIncidents]=useState(null);
  useEffect(()=>{ if(!hasPerm(user,'view_realtime'))return; api('alerts').then(r=>setIncidents((r.alerts||[]).slice().sort((a,b)=>+new Date(b.createdAt)-+new Date(a.createdAt)).slice(0,6))).catch(()=>setIncidents([])); },[]);
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

export { RealtimePage };
