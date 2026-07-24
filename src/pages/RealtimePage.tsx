import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  fmtUSD, fmtSigned, fmtNum, fmtPctPlain, clsPnl, fmtPrice, fmtAgo, fmtTime, fmtDT, api, Icon, Card, SectionTitle, Badge, Select, Donut, useApp,
  hasPerm, fundOf, liqInfo, dormantInfo, LiveBadge, StatusStrip, MarketTicker, PageHead, Denied, KpiCard, SortHeader, sortRows, EmptyState, SideTag, FundTag, Loader,
  Btn, PositionDetailOverlay
} from '../ui'

/* ============================================================
   REAL-TIME OPERATIONS
   ============================================================ */
function RealtimePage(){
  const {funds,user,data,dataStatus,refreshTick,refreshMs,navigate,t}=useApp();
  const [fund,setFund]=useState('all');
  const [sort,setSort]=useState({col:'uPnl',dir:'desc'});
  const [incidents,setIncidents]=useState(null);
  const [exchanges,setExchanges]=useState(null);
  const [fills,setFills]=useState(null);
  const [detailBot,setDetailBot]=useState(null);
  const serviceHealthRef=useRef<any>(null);
  // "Incident" here means service health (exchange API / data feed) — NOT a portfolio
  // performance threshold crossed (drawdown, daily PnL), which is a different alert type
  // ('breach', see api/_lib/sync.js) shown elsewhere (System Status' full alert history).
  useEffect(()=>{ if(!hasPerm(user,'view_realtime'))return; api('alerts?type=api_error').then(r=>setIncidents((r.alerts||[]).slice().sort((a,b)=>+new Date(b.createdAt)-+new Date(a.createdAt)).slice(0,6))).catch(()=>setIncidents([])); },[]);
  // Recent Fills / Trade Stream / Order Flow — real account executions (not a public market
  // trade tape), synced incrementally per symbol alongside positions (see api/_lib/sync.js).
  // A plain 30s poll is enough — fills only change as often as the underlying sync does.
  useEffect(()=>{
    if(!hasPerm(user,'view_realtime')) return;
    const load=()=>api('bots?fills=1').then(r=>setFills(r.fills||[])).catch(()=>setFills([]));
    load(); const iv=setInterval(load,30000);
    return ()=>clearInterval(iv);
  },[]);
  // Exchange Connectivity latency — same admin-gated 30s poll pattern as StatusPage's
  // "Exchange Connections" card (the /api/exchanges list itself is admin-only).
  useEffect(()=>{
    if(user.role!=='admin') return;
    const load=()=>api('exchanges').then(r=>setExchanges(r.exchanges||[])).catch(()=>{});
    load(); const iv=setInterval(load,30000);
    return ()=>clearInterval(iv);
  },[user.role]);
  if(!hasPerm(user,'view_realtime')) return <Denied/>;

  const hasActiveIncident=!!(incidents&&incidents.some(a=>!a.ackedAt));
  const selFund=fund!=='all'?(fund==='unassigned'?'unassigned':funds.find(f=>f.id===fund)):null;
  let open=data.openBots;
  if(fund==='unassigned') open=open.filter(b=>!b.fundId);
  else if(selFund) open=open.filter(b=>b.fundId===fund);

  const livePnl=open.reduce((a,b)=>a+(b.unrealizedPnl||0),0);
  const exposure=open.reduce((a,b)=>a+Math.abs(b.notional||0),0);

  let rows=open.map(b=>({...b,fund:fundOf(funds,b)}));
  rows=sortRows(rows,sort,{symbol:r=>r.symbol,side:r=>r.side,exchange:r=>r.exchange,fund:r=>r.fund?.name||'',qty:r=>r.qty,entry:r=>r.entry,mark:r=>r.mark,uPnl:r=>r.unrealizedPnl,notional:r=>Math.abs(r.notional),leverage:r=>r.leverage});

  const fundOpts=[{value:'all',label:t('live.allFunds')},...funds.map(f=>({value:f.id,label:f.name})),{value:'unassigned',label:t('live.unassigned')}];

  // Live Event Stream: the account's real fills and service-health incidents, merged into one
  // chronological feed instead of two redundant panels showing the same fills data twice
  // (previously "Recent Fills" + "Trade Stream" side by side). No new data — same fills[] and
  // incidents[] already fetched above, just presented as a single unified timeline.
  const events=useMemo(()=>{
    const fillEvents=(fills||[]).map((f,i)=>({key:'f'+i,t:f.occurredAt,kind:'fill',side:f.side,symbol:f.symbol,detail:`${fmtNum(f.qty,f.qty<1?4:2)} @ ${fmtPrice(f.price)}`,amount:f.realizedPnl}));
    const incidentEvents=(incidents||[]).map(a=>({key:'a'+a.id,t:a.createdAt,kind:'incident',acked:!!a.ackedAt,symbol:null,detail:a.summary,amount:null}));
    return [...fillEvents,...incidentEvents].sort((a,b)=>+new Date(b.t)-+new Date(a.t)).slice(0,50);
  },[fills,incidents]);
  const eventMeta=(e)=>{
    if(e.kind==='incident') return {icon:e.acked?'check':'triangle', color:e.acked?'text-slate-400':'text-danger', label:t('live.eventIncident')};
    return {icon:e.side==='BUY'?'trendup':'trendup', color:e.side==='BUY'?'text-success':'text-danger', label:t('live.eventFill')};
  };
  return <div>
    <PageHead title={t('live.title')} subtitle={t('live.subtitle')}
      refresh={{ms:refreshMs,tick:refreshTick}}
      actions={<div className="flex items-center gap-3">
        <Select value={fund} onChange={setFund} className="w-40" options={fundOpts}/>
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">{data.live&&data.live.syncedAt?t('live.syncedAgo',{ago:fmtAgo(data.live.syncedAt)}):t('live.notSynced')}</span>
      </div>}/>

    <StatusStrip dataStatus={dataStatus} connected={data.live?data.live.connected:0} syncedAt={data.live&&data.live.syncedAt} hasActiveIncident={hasActiveIncident}/>

    <MarketTicker/>

    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
      <KpiCard label={t('activity.equity')} value={fmtUSD(data.equity)} icon="dollar" accent="#C9A24D"/>
      <button onClick={()=>navigate('/trades')} className="text-left"><KpiCard label={t('live.openPositions')} value={open.length} icon="briefcase" accent="#3B82F6"/></button>
      <KpiCard label={t('activity.openPnl')} value={<span className={clsPnl(livePnl)}>{fmtSigned(livePnl)}</span>}/>
      <KpiCard label={t('activity.exposure')} value={fmtUSD(exposure)} icon="layers" accent="#10B981"/>
      <button onClick={()=>serviceHealthRef.current?.scrollIntoView({behavior:'smooth',block:'center'})} className="text-left">
        <KpiCard label={t('live.incidentStatus')}
          value={incidents===null? '—' : hasActiveIncident? <span className="text-danger">{t('live.incidentActive')}</span> : <span className="text-success">{t('live.incidentNone')}</span>}
          icon={hasActiveIncident?'triangle':'check'} accent={hasActiveIncident?'#EF4444':'#10B981'}
          className={hasActiveIncident?'ring-2 ring-danger animate-pulse':undefined}/>
      </button>
    </div>

    {/* Live Event Stream: fills + incidents merged into one chronological feed (replaces the
        old side-by-side "Recent Fills"/"Trade Stream" panels, which showed the same fills data
        twice) + a right-hand rail of Critical Alerts / Order Flow / Service Health / Exchange
        Connectivity — all existing content, just grouped by "things that need a quick glance". */}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
      <Card className="p-5 lg:col-span-2">
        <SectionTitle right={fills&&fills.length>0&&<span className="flex items-center gap-1.5 text-xs text-success"><span className="w-1.5 h-1.5 rounded-full bg-success pulse-dot"/>{t('live.streaming')}</span>}>{t('live.eventStream')}</SectionTitle>
        <p className="text-xs text-slate-400 -mt-2 mb-3">{t('live.eventStreamHint')}</p>
        {fills==null||incidents==null? <div className="text-sm text-slate-400 py-4 text-center"><Loader/></div>
        : events.length===0? <div className="text-sm text-slate-400 py-4 text-center">{t('live.noFills')}</div>
        : <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500 text-left">
            <th className="px-3 py-2 font-medium">{t('live.time')}</th>
            <th className="px-3 py-2 font-medium">{t('sysstatus.alertTypeCol')}</th>
            <th className="px-3 py-2 font-medium">{t('activity.symbol')}</th>
            <th className="px-3 py-2 font-medium">{t('sysstatus.summary')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('live.amount')}</th>
          </tr></thead>
          <tbody className="max-h-96">
            {events.map(e=>{ const m=eventMeta(e); return <tr key={e.key} className="border-b border-slate-50 hover:bg-slate-50/60">
              <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap tnum">{fmtTime(e.t)}</td>
              <td className="px-3 py-2"><span className={`flex items-center gap-1.5 text-xs font-medium ${m.color}`}><Icon name={m.icon} className="w-3.5 h-3.5"/>{m.label}</span></td>
              <td className="px-3 py-2 font-mono text-xs text-navy">{e.symbol||'—'}</td>
              <td className="px-3 py-2 text-slate-600 max-w-xs truncate" title={e.detail}>{e.detail}</td>
              <td className={`px-3 py-2 text-right tnum text-xs ${e.amount==null?'text-slate-300':clsPnl(e.amount)}`}>{e.amount==null?'—':fmtSigned(e.amount)}</td>
            </tr>; })}
          </tbody>
        </table></div>}
        {events.length>0&&<div className="text-[11px] text-slate-400 mt-2">{t('live.showingLatest',{n:events.length})}</div>}
      </Card>

      <div className="space-y-5">
        <Card className="p-5">
          <SectionTitle right={<span className="text-[11px] text-slate-400">{t('live.latestAlerts')}</span>}>{t('live.criticalAlerts')}</SectionTitle>
          {incidents===null? <div className="text-sm text-slate-400"><Loader/></div>
           : incidents.length===0? <div className="text-sm text-slate-400 py-2 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-success"/>{t('live.noIncidents')}</div>
           : <div className="space-y-2.5">
              {incidents.map(a=><div key={a.id} className={`flex items-start gap-2.5 text-sm pl-2.5 border-l-2 ${a.ackedAt?'border-slate-200':'border-danger'}`}>
                <div className="flex-1 min-w-0"><div className="text-navy">{a.summary}</div>
                  <div className="text-[11px] text-slate-400">{fmtAgo(a.createdAt)} · {a.ackedAt?t('live.acknowledged'):t('live.pending')}</div></div>
              </div>)}
            </div>}
        </Card>

        <Card className="p-5">
          <SectionTitle>{t('live.orderFlow')}</SectionTitle>
          {(()=>{
            if(fills==null) return <div className="text-sm text-slate-400 py-4 text-center"><Loader/></div>;
            const buyQty=fills.filter(f=>f.side==='BUY').reduce((s,f)=>s+f.qty,0);
            const sellQty=fills.filter(f=>f.side==='SELL').reduce((s,f)=>s+f.qty,0);
            const total=buyQty+sellQty;
            if(!total) return <div className="text-sm text-slate-400 py-4 text-center">{t('live.noFills')}</div>;
            return <div className="flex flex-col items-center gap-4">
              <Donut size={110} thickness={13} segments={[{value:buyQty,color:'#10B981'},{value:sellQty,color:'#EF4444'}]}
                center={<div><div className="text-[10px] text-slate-400">{t('live.netFlow')}</div><div className={`text-xs font-bold ${buyQty>=sellQty?'text-success':'text-danger'}`}>{fmtNum(buyQty-sellQty,2)}</div></div>}/>
              <div className="w-full flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-success"/>{t('live.buys')} {fmtPctPlain(buyQty/total*100)}</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-danger"/>{t('live.sells')} {fmtPctPlain(sellQty/total*100)}</span>
              </div>
            </div>;
          })()}
        </Card>

        <div ref={serviceHealthRef}><Card className="p-5">
          <SectionTitle right={<LiveBadge status={dataStatus}/>}>{t('live.serviceHealth')}</SectionTitle>
          <div className="space-y-2.5">
            {[
              [t('live.exchangeSync'), data.live&&data.live.connected>0?'ok':'neutral', data.live&&data.live.connected>0?t('live.connectedCount',{n:data.live.connected}):t('live.noExchangeConnected')],
              [t('live.marketDataFeed'), dataStatus==='live'?'ok':dataStatus==='partial'?'warn':'neutral', dataStatus==='live'?t('live.streaming'):dataStatus==='partial'?t('live.degraded'):t('live.idle')],
              [t('live.openPositions'), data.openBots.length?'ok':'neutral', t('live.openTracked',{open:data.openBots.length,tracked:data.bots.length})],
              [t('live.lastSync'), data.live&&data.live.syncedAt?'ok':'neutral', data.live&&data.live.syncedAt?fmtAgo(data.live.syncedAt):t('live.never')],
            ].map(([label,state,sub])=><div key={label} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-navy"><span className={`w-2 h-2 rounded-full ${state==='ok'?'bg-success':state==='warn'?'bg-amber-500':'bg-slate-300'}`}/>{label}</span>
              <span className="text-xs text-slate-400">{sub}</span>
            </div>)}
          </div>
        </Card></div>

        {user.role==='admin'&&<Card className="p-5">
          <SectionTitle>{t('live.exchangeConnectivity')}</SectionTitle>
          {exchanges==null? <div className="text-sm text-slate-400"><Loader/></div>
          : exchanges.length===0? <div className="text-sm text-slate-400">{t('sysstatus.noExchangeConnectionsYet')}</div>
          : <div className="space-y-2.5">
            {exchanges.map(e=><div key={e.id} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-navy"><span className={`w-2 h-2 rounded-full ${e.status==='connected'?'bg-success':e.status==='error'?'bg-danger':'bg-slate-300'}`}/>{e.label||e.name}</span>
              <span className="flex items-center gap-3 text-xs text-slate-400">
                {e.status==='connected'?<span className={`font-mono ${e.latencyMs>1000?'text-amber-600':'text-slate-500'}`}>{e.latencyMs!=null?e.latencyMs+'ms':'—'}</span>:<span className="capitalize">{e.status}</span>}
              </span>
            </div>)}
          </div>}
        </Card>}
      </div>
    </div>

    <Card className="overflow-hidden">
      <div className="p-5 pb-0"><SectionTitle right={data.live&&data.live.connected>0&&<span className="flex items-center gap-1.5 text-xs text-success"><span className="w-1.5 h-1.5 rounded-full bg-success pulse-dot"/>{t('live.connectedCount',{n:data.live.connected})}</span>}>{t('live.openPositions')}</SectionTitle></div>
      {rows.length===0? <div className="p-8"><EmptyState icon="briefcase" title={t('live.noOpenPositionsTitle')} hint={data.live&&data.live.connected? t('live.noOpenPositionsHintConnected') : t('live.noOpenPositionsHintDisconnected')}/></div>
      : <>
      {/* desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
            <SortHeader label={t('activity.symbol')} col="symbol" sort={sort} setSort={setSort}/>
            <SortHeader label={t('activity.side')} col="side" sort={sort} setSort={setSort}/>
            <SortHeader label={t('live.qty')} col="qty" sort={sort} setSort={setSort} align="right"/>
            <SortHeader label={t('live.entry')} col="entry" sort={sort} setSort={setSort} align="right"/>
            <SortHeader label={t('live.mark')} col="mark" sort={sort} setSort={setSort} align="right"/>
            <SortHeader label={t('activity.openPnl')} col="uPnl" sort={sort} setSort={setSort} align="right"/>
            <SortHeader label={t('activity.notional')} col="notional" sort={sort} setSort={setSort} align="right"/>
            <SortHeader label={t('activity.lev')} col="leverage" sort={sort} setSort={setSort} align="right"/>
            <th className="px-3 py-2.5 text-right font-medium">{t('live.liqDist')}</th>
            <SortHeader label={t('activity.fund')} col="fund" sort={sort} setSort={setSort}/>
            <th className="px-3 py-2.5 text-left font-medium">{t('live.exchange')}</th>
            <th className="px-3 py-2.5"></th>
          </tr></thead>
          <tbody>
            {rows.map(r=>{ const {pct,level}=liqInfo(r); const {dormant}=dormantInfo(r); return <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
              <td className="px-3 py-2.5 font-mono text-xs text-navy">{r.symbol}{dormant&&<Icon name="clock" className="w-3.5 h-3.5 text-amber-500 inline-block ml-1.5 -mt-0.5" data-tip={t('live.dormantTooltip')}/>}</td>
              <td className="px-3 py-2.5"><SideTag side={r.side}/></td>
              <td className="px-3 py-2.5 text-right tnum text-slate-500">{fmtNum(r.qty,r.qty<1?4:2)}</td>
              <td className="px-3 py-2.5 text-right tnum text-slate-500">{fmtPrice(r.entry)}</td>
              <td className="px-3 py-2.5 text-right tnum text-slate-500">{fmtPrice(r.mark)}</td>
              <td className={`px-3 py-2.5 text-right font-medium tnum ${clsPnl(r.unrealizedPnl)}`}>{fmtSigned(r.unrealizedPnl)}</td>
              <td className="px-3 py-2.5 text-right tnum text-slate-500">{fmtUSD(Math.abs(r.notional))}</td>
              <td className="px-3 py-2.5 text-right tnum text-slate-500">{r.leverage?r.leverage+'×':'—'}</td>
              <td className={`px-3 py-2.5 text-right tnum font-medium ${pct==null?'text-slate-300':level==='danger'?'text-danger':level==='warn'?'text-amber-600':'text-slate-500'}`}>{pct==null?'—':pct.toFixed(1)+'%'}</td>
              <td className="px-3 py-2.5">{r.fund? <Badge color={r.fund.color} dot onClick={()=>setFund(r.fund.id)}>{r.fund.name}</Badge> : <span className="text-xs text-slate-400">{t('live.unassigned')}</span>}</td>
              <td className="px-3 py-2.5 text-slate-500 capitalize">{r.exchange}</td>
              <td className="px-3 py-2.5"><Btn size="sm" variant="outline" onClick={()=>setDetailBot(r)}><Icon name="trendup" className="w-3.5 h-3.5"/>{t('positionDetail.viewDetails')}</Btn></td>
            </tr>; })}
          </tbody>
        </table>
      </div>
      {/* mobile cards */}
      <div className="md:hidden p-3 space-y-2">
        {rows.map(r=>{ const {pct,level}=liqInfo(r); const {dormant}=dormantInfo(r); return <div key={r.id} className="border border-slate-100 rounded-lg p-3">
          <div className="flex items-center justify-between"><div className="font-mono text-sm text-navy">{r.symbol} <SideTag side={r.side}/>{dormant&&<Icon name="clock" className="w-3.5 h-3.5 text-amber-500 inline-block ml-1"/>}</div><span className={`font-medium tnum ${clsPnl(r.unrealizedPnl)}`}>{fmtSigned(r.unrealizedPnl)}</span></div>
          <div className="flex items-center justify-between mt-2 text-xs text-slate-500"><FundTag fund={r.fund}/><span className="tnum">{fmtUSD(Math.abs(r.notional))} · {r.leverage?r.leverage+'×':'—'}</span></div>
          {pct!=null&&<div className={`mt-1.5 text-xs font-medium ${level==='danger'?'text-danger':level==='warn'?'text-amber-600':'text-slate-400'}`}>{t('live.liqDistanceMobile',{pct:pct.toFixed(1)})}</div>}
          {dormant&&<div className="mt-1 text-xs font-medium text-amber-600">{t('live.dormantTooltip')}</div>}
          <Btn size="sm" variant="outline" className="mt-2 w-full" onClick={()=>setDetailBot(r)}><Icon name="trendup" className="w-3.5 h-3.5"/>{t('positionDetail.viewDetails')}</Btn>
        </div>; })}
      </div>
      </>}
    </Card>

    <PositionDetailOverlay bot={detailBot} onClose={()=>setDetailBot(null)}/>
  </div>;
}

export { RealtimePage };
