import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  fmtUSD, fmtSigned, fmtPct, clsPnl, fmtDate, PREF, Icon, Card, SectionTitle, Btn, AreaChart, useApp,
  hasPerm, fundOf, sliceByPeriod, RiskPanel, Underwater, PnlCalendar, MarketTicker, PageHead, Denied, KpiCard, TrendBadge, EmptyState,
  SideTag, FundTag, PeriodControls, OnboardingCard
} from '../ui'

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

export { ActivityPage };
