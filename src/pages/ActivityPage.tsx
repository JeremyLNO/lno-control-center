import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  fmtUSD, fmtSigned, fmtPct, fmtAgo, clsPnl, fmtDate, api, Icon, Card, SectionTitle, Btn, AreaChart, Donut, Sparkline, FUND_PALETTE, useApp,
  hasPerm, fundOf, sliceByPeriod, RiskPanel, Underwater, PnlCalendar, PositionsHeatmap, MarketTicker, StatusStrip, PageHead, Denied, KpiCard, TrendBadge, EmptyState,
  SideTag, FundTag, OnboardingCard
} from '../ui'
import { MilestonesCard } from './MilestonesPage'

function ActivityPage(){
  // period/custom now live in AppContext (rendered once, globally, in Header) rather than
  // page-local state — see types.ts's AppContextValue for why.
  const {funds,navigate,user,data,dataStatus,refreshTick,refreshMs,period,custom,t}=useApp();
  const [incidents,setIncidents]=useState(null);
  // Same api/alerts?type=api_error incident concept as the Live page's status card — service
  // health only, not portfolio performance breaches. Feeds the System Health KPI below.
  useEffect(()=>{ if(!hasPerm(user,'view_activity'))return; api('alerts?type=api_error').then(r=>setIncidents(r.alerts||[])).catch(()=>setIncidents([])); },[]);
  if(!hasPerm(user,'view_activity')) return <Denied/>;

  const {series,equity,openBots,byFund,bots,live}=data;
  const hasActiveIncident = !!(incidents&&incidents.some((a:any)=>!a.ackedAt));
  const canSeeReports = hasPerm(user,['view_reports_daily','view_reports_weekly','view_reports_monthly']);
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
  const equitySpark = hasHistory? series.slice(-20).map(s=>s.equity) : null;
  const allocFunds = byFund.filter(f=>f.notional>0);       // include Unassigned here — it's real open exposure
  const allocTotal = allocFunds.reduce((s,f)=>s+f.notional,0);

  return <div>
    <PageHead title={t('activity.title')} subtitle={t('activity.subtitle')}
      refresh={{ms:refreshMs,tick:refreshTick}}/>

    <OnboardingCard/>
    {/* The scoreboard, right under onboarding: what the desk just achieved is the one
        thing on this page that isn't a number to interpret. */}
    <MilestonesCard/>
    <MarketTicker/>

    {empty? <EmptyState icon="dollar" title={t('activity.emptyTitle')}
        hint={t('activity.emptyHint')}
        action={user.role==='admin'&&<Btn onClick={()=>navigate('/admin/exchanges')}><Icon name="link" className="w-4 h-4"/>{t('activity.connectExchange')}</Btn>}/>
    : <>
      <StatusStrip dataStatus={dataStatus} connected={live?live.connected:0} syncedAt={live&&live.syncedAt} hasActiveIncident={hasActiveIncident}/>

      {/* Hero: account equity + KPI cards, System Health closing the row */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-5">
        <KpiCard label={t('activity.equity')} value={fmtUSD(equity)} icon="dollar" accent="#C9A24D"
          spark={equitySpark&&<Sparkline data={equitySpark} positive={positive}/>}/>
        <KpiCard label={t('activity.pnlDay')} value={<span className={clsPnl(pnlDay)}>{fmtSigned(pnlDay)}</span>} badge={equity?<TrendBadge pct={pnlDay/equity*100}/>:null}/>
        <KpiCard label={t('activity.openPnl')} value={<span className={clsPnl(openPnl)}>{fmtSigned(openPnl)}</span>}/>
        <KpiCard label={t('activity.exposure')} value={fmtUSD(exposure)} icon="briefcase" accent="#3B82F6"/>
        <KpiCard label={t('activity.openFunds')} value={`${openBots.length} / ${fundsWithExposure.length||funds.length}`} icon="layers" accent="#10B981"/>
        <KpiCard label={t('activity.systemHealth')} icon={hasActiveIncident?'triangle':'check'} accent={hasActiveIncident?'#EF4444':'#10B981'}
          value={incidents===null?'—':hasActiveIncident?<span className="text-danger">{t('live.incidentActive')}</span>:<span className="text-success">{t('activity.healthy')}</span>}
          badge={<button onClick={()=>navigate('/status')} className="text-[11px] text-slate-400 hover:text-gold whitespace-nowrap">{t('activity.viewIncidents')} <Icon name="chevright" className="w-3 h-3 inline"/></button>}/>
      </div>

      {/* Equity curve + bot allocation (per individual open position, not merged by fund) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Card className="p-5 lg:col-span-2">
          <SectionTitle right={hasHistory&&<span className={`text-sm font-semibold ${clsPnl(periodPnl)}`}>{fmtSigned(periodPnl)} <span className="tnum">({fmtPct(periodPnlPct)})</span> {t('activity.thisPeriod')}</span>}>{t('activity.equityCurve')}</SectionTitle>
          {hasHistory? <>
            <AreaChart data={view} positive={positive} resetKey={`${period}|${custom.start||''}`}/>
            <div className="flex justify-between text-[11px] text-slate-400 mt-1"><span>{view.length?fmtDate(view[0].t):''}</span><span>{view.length?fmtDate(view[view.length-1].t):''}</span></div>
          </> : <div className="h-[180px] grid place-items-center text-center text-sm text-slate-400">{t('activity.noHistory')}</div>}
        </Card>
        <Card className="p-5">
          <SectionTitle>{t('activity.botAllocation')}</SectionTitle>
          {openBots.length===0? <div className="h-[180px] grid place-items-center text-center text-sm text-slate-400">{t('activity.noExposure')}</div>
          : <div className="flex flex-col items-center gap-4">
            <Donut size={140} thickness={16}
              segments={openBots.map((b,i)=>({value:Math.abs(b.notional||0),color:FUND_PALETTE[i%FUND_PALETTE.length]}))}
              center={<div><div className="text-base font-bold text-navy tnum">{fmtUSD(exposure)}</div><div className="text-[10px] text-slate-400">{t('activity.exposure')}</div></div>}/>
            <div className="w-full space-y-1.5">
              {openBots.map((b,i)=><div key={b.id} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 min-w-0"><span className="w-2 h-2 rounded-full shrink-0" style={{background:FUND_PALETTE[i%FUND_PALETTE.length]}}/><span className="truncate text-slate-600 font-mono">{b.symbol}</span></span>
                <span className="font-medium text-navy tnum shrink-0">{exposure?(Math.abs(b.notional||0)/exposure*100).toFixed(1):'0.0'}%</span>
              </div>)}
            </div>
          </div>}
        </Card>
      </div>

      {/* PnL calendar + drawdown side by side — the two "shape of recent performance" views */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <Card className="p-5"><SectionTitle right={<span className="text-[11px] text-slate-400">{t('activity.daily')}</span>}>{t('activity.pnlCalendar')}</SectionTitle><PnlCalendar series={view}/></Card>
        <Card className="p-5"><SectionTitle right={<span className="text-[11px] text-slate-400">{t('activity.underwater')}</span>}>{t('activity.drawdown')}</SectionTitle><Underwater series={view}/></Card>
      </div>

      {/* By-bot breakdown + a lightweight pointer to Reports for deeper analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="p-5 pb-3"><SectionTitle>{t('activity.byBot')}</SectionTitle></div>
          {openBots.length===0? <div className="px-5 pb-5 text-sm text-slate-400">{t('activity.noOpenPositions')}</div>
          : <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
              <th className="px-3 py-2.5 text-left font-medium">{t('activity.symbol')}</th><th className="px-3 py-2.5 text-left font-medium">{t('activity.side')}</th>
              <th className="px-3 py-2.5 text-left font-medium">{t('activity.fund')}</th>
              <th className="px-3 py-2.5 text-right font-medium">{t('activity.openPnl')}</th><th className="px-3 py-2.5 text-right font-medium hidden sm:table-cell">{t('activity.notional')}</th>
              <th className="px-3 py-2.5 text-right font-medium hidden md:table-cell">{t('activity.lev')}</th>
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
        <Card className="p-5 flex flex-col items-center justify-center text-center gap-2.5">
          <span className="w-11 h-11 rounded-full bg-gold/15 grid place-items-center"><Icon name="filetext" className="w-5 h-5 text-gold"/></span>
          <div className="text-sm font-semibold text-navy">{t('activity.moreInsights')}</div>
          <p className="text-xs text-slate-500">{t('activity.moreInsightsHint')}</p>
          {canSeeReports&&<Btn variant="outline" size="sm" onClick={()=>navigate('/admin/reports')} className="mt-1">{t('activity.goToReports')}</Btn>}
        </Card>
      </div>

      {/* Closed-positions heatmap — full width, same GitHub-style grid as the PnL calendar
          above, but each cell is a closed position */}
      <Card className="p-5 mb-5"><SectionTitle right={<span className="text-[11px] text-slate-400">{t('activity.realizedPct')}</span>}>{t('activity.positionsHeatmap')}</SectionTitle><PositionsHeatmap bots={bots}/></Card>

      {/* Risk & exposure (only meaningful with history/exposure) */}
      {(hasHistory||openBots.length>0)&&<div className="mb-5"><RiskPanel series={view.length?view:series} openBots={openBots} byFund={byFund}/></div>}

      {/* Fund allocation + by-fund breakdown — moved to the bottom; bot-level detail above is
          the primary view now, fund grouping is the supplementary roll-up */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="p-5 pb-3"><SectionTitle>{t('activity.byFund')}</SectionTitle></div>
          {byFund.length===0? <div className="px-5 pb-5 text-sm text-slate-400">{t('activity.noFunds')}</div>
          : <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
              <th className="px-4 py-2.5 text-left font-medium">{t('activity.fund')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t('activity.openPnl')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t('activity.exposure')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t('activity.positions')}</th>
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
        <Card className="p-5">
          <SectionTitle>{t('activity.fundAllocation')}</SectionTitle>
          {allocFunds.length===0? <div className="h-[180px] grid place-items-center text-center text-sm text-slate-400">{t('activity.noExposure')}</div>
          : <div className="flex flex-col items-center gap-4">
            <Donut size={140} thickness={16}
              segments={allocFunds.map((f,i)=>({value:f.notional,color:f.id!=null?(f.color||FUND_PALETTE[i%FUND_PALETTE.length]):'#94A3B8'}))}
              center={<div><div className="text-base font-bold text-navy tnum">{fmtUSD(allocTotal)}</div><div className="text-[10px] text-slate-400">{t('activity.exposure')}</div></div>}/>
            <div className="w-full space-y-1.5">
              {allocFunds.map((f,i)=><div key={f.id||'unassigned'} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 min-w-0"><span className="w-2 h-2 rounded-full shrink-0" style={{background:f.id!=null?(f.color||FUND_PALETTE[i%FUND_PALETTE.length]):'#94A3B8'}}/><span className="truncate text-slate-600">{f.name}</span></span>
                <span className="font-medium text-navy tnum shrink-0">{(f.notional/allocTotal*100).toFixed(1)}%</span>
              </div>)}
            </div>
          </div>}
        </Card>
      </div>
    </>}
  </div>;
}

export { ActivityPage };
