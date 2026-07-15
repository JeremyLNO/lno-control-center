import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  fmtUSD, fmtSigned, fmtNum, clsPnl, fmtPrice, fmtAgo, api, Icon, Card, SectionTitle, Badge, Select, CandleChart, useApp,
  hasPerm, fundOf, liqInfo, dormantInfo, LiveBadge, MarketTicker, PageHead, Denied, KpiCard, SortHeader, sortRows, EmptyState, SideTag, FundTag
} from '../ui'

const CHART_INTERVALS=['1m','5m','15m','1h','4h','1d'];
// Live BTC/ETH/... candlestick chart — public Binance futures klines, same client-side
// architecture as PricesPage's ticker: REST for the initial 200-bar history (a kline WS
// stream only ever pushes the currently-forming bar, never backfill), then a live kline
// WS stream updates the in-progress bar tick-by-tick. The 8s watchdog is armed once, tied
// to the whole mount (not reset on every reconnect) — see PricesPage.tsx for why that
// matters when a connection is blocked before it ever opens.
function LiveChart({symbol,interval}: any){
  const {t}=useApp();
  const [candles,setCandles]=useState(null);
  const [err,setErr]=useState(false);
  useEffect(()=>{
    let stopped=false, ws: WebSocket|null=null, reconnectTimer: any=null, reconnectDelay=2000;
    let restIv: any=null, watchdog: any=null, gotFirstMessage=false;
    setCandles(null); setErr(false);

    const loadRest=async()=>{
      try{
        const r=await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=200`,{cache:'no-store'});
        if(!r.ok) throw 0; const raw=await r.json(); if(stopped) return;
        setCandles((Array.isArray(raw)?raw:[]).map(k=>({t:k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4]})));
        setErr(false);
      }catch(e){ if(!stopped) setErr(true); }
    };
    const startRestFallback=()=>{ if(restIv) return; loadRest(); restIv=setInterval(loadRest,15000); };
    watchdog=setTimeout(()=>{ if(!gotFirstMessage) startRestFallback(); },8000);

    function connect(){
      if(stopped) return;
      loadRest(); // klines WS only ever streams the in-progress bar — always fetch history via REST
      ws=new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${interval}`);
      ws.onopen=()=>{ reconnectDelay=2000; };
      ws.onmessage=(ev)=>{
        try{
          const msg=JSON.parse(ev.data); const k=msg&&msg.k; if(!k) return;
          if(!gotFirstMessage){ gotFirstMessage=true; clearTimeout(watchdog); if(restIv){ clearInterval(restIv); restIv=null; } }
          const bar={t:k.t,o:+k.o,h:+k.h,l:+k.l,c:+k.c};
          setCandles(prev=>{ if(!prev||!prev.length) return prev; const last=prev[prev.length-1]; return last&&last.t===bar.t? [...prev.slice(0,-1),bar] : [...prev,bar]; });
          setErr(false);
        }catch(e){ /* a malformed tick shouldn't drop the whole stream */ }
      };
      ws.onclose=()=>{ if(stopped)return; reconnectTimer=setTimeout(connect,reconnectDelay); reconnectDelay=Math.min(reconnectDelay*2,30000); };
      ws.onerror=()=>{ try{ ws&&ws.close(); }catch(e){} };
    }
    connect();
    return ()=>{ stopped=true; if(ws){ try{ ws.close(); }catch(e){} } if(reconnectTimer) clearTimeout(reconnectTimer); if(restIv) clearInterval(restIv); if(watchdog) clearTimeout(watchdog); };
  },[symbol,interval]);

  if(candles==null) return <div className="h-[320px] grid place-items-center text-sm text-slate-400">{t('common.loading')}</div>;
  if(err&&!candles.length) return <div className="h-[320px] grid place-items-center text-sm text-slate-400">{t('prices.couldNotLoad')}</div>;
  const last=candles[candles.length-1], first=candles[0];
  const chgPct=first&&first.o? (last.c-first.o)/first.o*100 : 0;
  return <>
    <div className="flex items-baseline gap-2 mb-2">
      <span className="text-lg font-bold text-navy tnum">{fmtPrice(last.c)}</span>
      <span className={`text-sm font-medium ${chgPct>=0?'text-success':'text-danger'}`}>{chgPct>=0?'▲':'▼'} {Math.abs(chgPct).toFixed(2)}%</span>
    </div>
    <CandleChart data={candles} height={320}/>
  </>;
}

/* ============================================================
   REAL-TIME OPERATIONS
   ============================================================ */
function RealtimePage(){
  const {funds,user,data,dataStatus,refreshTick,refreshMs,t}=useApp();
  const [fund,setFund]=useState('all');
  const [sort,setSort]=useState({col:'uPnl',dir:'desc'});
  const [incidents,setIncidents]=useState(null);
  const [chartSymbol,setChartSymbol]=useState('BTCUSDT');
  const [chartInterval,setChartInterval]=useState('1h');
  const [exchanges,setExchanges]=useState(null);
  useEffect(()=>{ if(!hasPerm(user,'view_realtime'))return; api('alerts').then(r=>setIncidents((r.alerts||[]).slice().sort((a,b)=>+new Date(b.createdAt)-+new Date(a.createdAt)).slice(0,6))).catch(()=>setIncidents([])); },[]);
  // Exchange Connectivity latency — same admin-gated 30s poll pattern as StatusPage's
  // "Exchange Connections" card (the /api/exchanges list itself is admin-only).
  useEffect(()=>{
    if(user.role!=='admin') return;
    const load=()=>api('exchanges').then(r=>setExchanges(r.exchanges||[])).catch(()=>{});
    load(); const iv=setInterval(load,30000);
    return ()=>clearInterval(iv);
  },[user.role]);
  // Default the chart to whichever symbol is actually open, so it's not always showing an
  // unrelated market on first load — but only once, per mount (don't yank the chart out
  // from under the user if their positions change while they're looking at something else).
  useEffect(()=>{ if(data.openBots.length) setChartSymbol(s=>s==='BTCUSDT'&&data.openBots[0].symbol!=='BTCUSDT'?data.openBots[0].symbol:s); },[]);
  if(!hasPerm(user,'view_realtime')) return <Denied/>;

  const chartSymbolOpts=[...new Set(['BTCUSDT','ETHUSDT','SOLUSDT',...data.bots.map(b=>b.symbol)])].map(s=>({value:s,label:s}));

  const selFund=fund!=='all'?(fund==='unassigned'?'unassigned':funds.find(f=>f.id===fund)):null;
  let open=data.openBots;
  if(fund==='unassigned') open=open.filter(b=>!b.fundId);
  else if(selFund) open=open.filter(b=>b.fundId===fund);

  const livePnl=open.reduce((a,b)=>a+(b.unrealizedPnl||0),0);
  const exposure=open.reduce((a,b)=>a+Math.abs(b.notional||0),0);

  let rows=open.map(b=>({...b,fund:fundOf(funds,b)}));
  rows=sortRows(rows,sort,{symbol:r=>r.symbol,side:r=>r.side,exchange:r=>r.exchange,fund:r=>r.fund?.name||'',qty:r=>r.qty,entry:r=>r.entry,mark:r=>r.mark,uPnl:r=>r.unrealizedPnl,notional:r=>Math.abs(r.notional),leverage:r=>r.leverage});

  const fundOpts=[{value:'all',label:t('live.allFunds')},...funds.map(f=>({value:f.id,label:f.name})),{value:'unassigned',label:t('live.unassigned')}];
  return <div>
    <PageHead title={t('live.title')} subtitle={t('live.subtitle')}
      refresh={{ms:refreshMs,tick:refreshTick}}
      actions={<div className="flex items-center gap-3">
        <Select value={fund} onChange={setFund} className="w-40" options={fundOpts}/>
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">{data.live&&data.live.syncedAt?t('live.syncedAgo',{ago:fmtAgo(data.live.syncedAt)}):t('live.notSynced')}</span>
      </div>}/>

    <MarketTicker/>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      <KpiCard label={t('activity.equity')} value={fmtUSD(data.equity)} icon="dollar" accent="#C9A24D"/>
      <KpiCard label={t('activity.openPnl')} value={<span className={clsPnl(livePnl)}>{fmtSigned(livePnl)}</span>}/>
      <KpiCard label={t('live.openPositions')} value={open.length} icon="briefcase" accent="#3B82F6"/>
      <KpiCard label={t('activity.exposure')} value={fmtUSD(exposure)} icon="layers" accent="#10B981"/>
    </div>

    <Card className="p-5 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <Select value={chartSymbol} onChange={setChartSymbol} className="w-40" options={chartSymbolOpts}/>
        <div className="flex bg-slate-100 rounded-lg p-0.5 text-xs">
          {CHART_INTERVALS.map(iv=><button key={iv} onClick={()=>setChartInterval(iv)}
            className={`px-2.5 py-1 rounded-md font-medium transition ${chartInterval===iv?'bg-white text-navy shadow-sm':'text-slate-500'}`}>{iv.toUpperCase()}</button>)}
        </div>
      </div>
      <LiveChart symbol={chartSymbol} interval={chartInterval}/>
    </Card>

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
        </div>; })}
      </div>
      </>}
    </Card>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
      <Card className="p-5">
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
      </Card>
      <Card className="p-5">
        <SectionTitle right={<span className="text-[11px] text-slate-400">{t('live.latestAlerts')}</span>}>{t('live.recentIncidents')}</SectionTitle>
        {incidents===null? <div className="text-sm text-slate-400">{t('common.loading')}</div>
         : incidents.length===0? <div className="text-sm text-slate-400 py-2 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-success"/>{t('live.noIncidents')}</div>
         : <div className="space-y-2.5">
            {incidents.map(a=><div key={a.id} className="flex items-start gap-2.5 text-sm">
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${a.ackedAt?'bg-success':'bg-danger'}`}/>
              <div className="flex-1 min-w-0"><div className="text-navy">{a.summary}</div>
                <div className="text-[11px] text-slate-400">{fmtAgo(a.createdAt)} · {a.ackedAt?t('live.acknowledged'):t('live.pending')}</div></div>
            </div>)}
          </div>}
      </Card>
    </div>

    {user.role==='admin'&&<Card className="p-5 mt-5">
      <SectionTitle>{t('live.exchangeConnectivity')}</SectionTitle>
      {exchanges==null? <div className="text-sm text-slate-400">{t('common.loading')}</div>
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
  </div>;
}

export { RealtimePage };
