import React from 'react'
const { useState, useEffect, useMemo } = React;
import {
  fmtSigned, fmtUSD, fmtNum, fmtPrice, fmtDT, fmtSeconds, clsPnl, Icon, Card, SectionTitle, Btn,
  Badge, KpiCard, PageHead, Denied, Loader, EmptyState, SideTag, useApp, hasPerm, useAnalysisFilters
} from '../ui'

/* ============================================================
   POSITION DETAIL — one round trip, in full
   ============================================================ */
// The single place to audit a trade's whole life cycle. Everything here already existed but
// was scattered across five tables: the entry/exit in `trades`, the executions in `fills`,
// funding and commission in `income_events`, the declared intent in `strategies`, and the
// alerts that fired during it in two more. Answering "what happened on this trade" meant
// joining all of that by hand.
//
// MAE/MFE are the exception — they are not stored anywhere by the exchange and are
// reconstructed here from public klines. A trade that ended +50 after being -400 underwater
// is a different trade from one that went straight to +50, and only MAE tells them apart.

// Candlestick chart of the trade's own window, with the entry and exit marked. Hand-drawn as
// SVG rather than pulled from a chart library: this needs exactly two annotations and a
// fixed window, and the app already draws its charts this way.
function TradeChart({candles,entry,exit,direction,mae,mfe,t}: any){
  if(!candles||candles.length<2) return <div className="h-48 grid place-items-center text-sm text-slate-400">{t('position.noChart')}</div>;
  const W=900,H=200,pad=6;
  const lo=Math.min(...candles.map(c=>c.low), entry??Infinity, exit??Infinity);
  const hi=Math.max(...candles.map(c=>c.high), entry??-Infinity, exit??-Infinity);
  const range=(hi-lo)||1;
  const x=(i)=>pad+(i/(candles.length-1))*(W-2*pad);
  const y=(v)=>pad+(1-(v-lo)/range)*(H-2*pad);
  const cw=Math.max(1.2,Math.min(8,(W-2*pad)/candles.length*0.62));
  const hline=(v,color,dash,label)=> v==null?null:<g key={label}>
    <line x1={pad} x2={W-pad} y1={y(v)} y2={y(v)} stroke={color} strokeWidth="1" strokeDasharray={dash}/>
    <text x={W-pad-2} y={y(v)-3} textAnchor="end" fontSize="9" fill={color}>{label}</text>
  </g>;
  return <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{height:200}} preserveAspectRatio="none">
    {candles.map((c,i)=>{
      const up=c.close>=c.open, col=up?'#10B981':'#EF4444';
      return <g key={i}>
        <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={col} strokeWidth="0.8"/>
        <rect x={x(i)-cw/2} y={Math.min(y(c.open),y(c.close))} width={cw}
          height={Math.max(0.8,Math.abs(y(c.open)-y(c.close)))} fill={col}/>
      </g>;
    })}
    {hline(entry,'#0B1F3A','4 3',t('position.entry'))}
    {hline(exit,'#C9A24D','4 3',t('position.exit'))}
    {/* The excursion lines are the point of showing a chart at all: they make visible how
        far the position ran the wrong way before it resolved. */}
    {hline(mae,'#EF4444','1 3','MAE')}
    {hline(mfe,'#10B981','1 3','MFE')}
  </svg>;
}

function Row({label,value,mono}: any){
  return <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-slate-100 last:border-0">
    <span className="text-xs text-slate-500">{label}</span>
    <span className={`text-sm text-navy ${mono?'tnum':''}`}>{value}</span>
  </div>;
}

export default function PositionPage(){
  const {api,user,t,route,navigate}=useApp();
  const id=route.parts.slice(1).join(':');
  const [d,setD]=useState<any>(null);
  const [err,setErr]=useState<string|null>(null);
  const allowed=hasPerm(user,'view_trades');

  useEffect(()=>{ if(!allowed||!id) return;
    setD(null); setErr(null);
    api('snapshots?analysis=1&trade='+encodeURIComponent(id)).then(setD).catch(e=>setErr(e.message));
  },[allowed,id,api]);

  if(!allowed) return <Denied/>;
  if(err) return <EmptyState icon="database" title={t('position.notFound')} hint={id}
    action={<Btn variant="outline" onClick={()=>navigate('/trades')}>{t('position.backToList')}</Btn>}/>;
  if(!d) return <div className="py-16"><Loader/></div>;

  const feeShare=d.grossPnl>0?(d.commission/d.grossPnl)*100:null;

  return <div className="fadein">
    <PageHead title={`${d.symbol} ${d.direction}`}
      subtitle={`${fmtDT(d.openedAt)} → ${d.closedAt?fmtDT(d.closedAt):t('position.stillOpen')}${d.durationS!=null?` · ${fmtSeconds(d.durationS)}`:''}`}
      actions={<Btn variant="outline" onClick={()=>navigate('/trades')}><Icon name="back" className="w-4 h-4"/>{t('position.backToList')}</Btn>}/>

    <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
      <KpiCard label={t('position.netPnl')} value={<span className={clsPnl(d.netPnl)}>{fmtSigned(d.netPnl)}</span>} icon="dollar"/>
      <KpiCard label={t('position.grossPnl')} value={<span className={clsPnl(d.grossPnl)}>{fmtSigned(d.grossPnl)}</span>}/>
      <KpiCard label={t('kpi.fees')} value={<span className="text-danger">{fmtUSD(d.commission)}</span>}/>
      <KpiCard label={t('kpi.funding')} value={<span className={clsPnl(d.funding)}>{fmtSigned(d.funding)}</span>}/>
      <KpiCard label="MAE" value={<span className="text-danger">{d.mae==null?'—':fmtSigned(d.mae)}</span>}/>
      <KpiCard label="MFE" value={<span className="text-success">{d.mfe==null?'—':fmtSigned(d.mfe)}</span>}/>
    </div>

    <Card className="p-4 mb-4">
      <SectionTitle right={d.candleInterval&&<span className="text-xs text-slate-400">{t('position.candles',{iv:d.candleInterval})}</span>}>
        {t('position.priceDuring')}
      </SectionTitle>
      {d.priceError
        ? <div className="text-sm text-slate-400 italic py-6 text-center">{t('position.chartUnavailable')}</div>
        : <TradeChart candles={d.candles} entry={d.entryPrice} exit={d.exitPrice} direction={d.direction}
            mae={d.maePrice} mfe={d.mfePrice} t={t}/>}
    </Card>

    <div className="grid lg:grid-cols-2 gap-4 mb-4">
      <Card className="p-4">
        <SectionTitle>{t('position.execution')}</SectionTitle>
        <Row label={t('activity.side')} value={<SideTag side={d.direction}/>}/>
        <Row label={t('live.qty')} value={fmtNum(d.qty,d.qty<1?6:2)} mono/>
        <Row label={t('position.avgEntry')} value={fmtPrice(d.entryPrice)} mono/>
        <Row label={t('position.avgExit')} value={d.exitPrice==null?'—':fmtPrice(d.exitPrice)} mono/>
        <Row label={t('position.notional')} value={d.notional==null?'—':fmtUSD(d.notional)} mono/>
        <Row label={t('dim.leverage')} value={d.leverage?`${fmtNum(d.leverage,0)}x`:'—'} mono/>
        <Row label={t('position.fillCount')} value={d.fillCount} mono/>
        <Row label={t('position.feeShare')} value={feeShare==null?'—':`${fmtNum(feeShare,1)}%`} mono/>
      </Card>

      <Card className="p-4">
        <SectionTitle>{t('position.intent')}</SectionTitle>
        {d.strategy
          ? <>
              <Row label={t('playbook.name')} value={<button className="text-navy underline decoration-slate-300 hover:decoration-navy" onClick={()=>navigate('/playbook')}>{d.strategy.name}</button>}/>
              <Row label={t('playbook.version')} value={d.version?<Badge color="#C9A24D" dot>{d.version.label}</Badge>:<span className="text-slate-400">{t('position.unversioned')}</span>}/>
              {d.version?.changes&&<Row label={t('playbook.changes')} value={<span className="text-xs text-slate-600">{d.version.changes}</span>}/>}
              <div className="mt-3 grid gap-2">
                <div><div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">{t('playbook.entryRules')}</div>
                  <p className="text-sm text-navy whitespace-pre-wrap">{d.strategy.entryRules||<span className="text-slate-400 italic">{t('playbook.undocumented')}</span>}</p></div>
                <div><div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">{t('playbook.exitRules')}</div>
                  <p className="text-sm text-navy whitespace-pre-wrap">{d.strategy.exitRules||<span className="text-slate-400 italic">{t('playbook.undocumented')}</span>}</p></div>
              </div>
            </>
          // A trade with no declared strategy cannot be judged against anything — say so
          // rather than leaving the panel blank.
          : <div className="text-sm text-slate-400 italic py-4">{t('position.noStrategy')}</div>}
      </Card>
    </div>

    <Card className="p-4 mb-4">
      <SectionTitle right={<span className="text-xs text-slate-400">{t('position.fillsHint')}</span>}>{t('position.fills')}</SectionTitle>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-200 text-slate-500">
          <th className="px-3 py-2 text-left font-medium">{t('position.time')}</th>
          <th className="px-3 py-2 text-left font-medium">{t('activity.side')}</th>
          <th className="px-3 py-2 text-right font-medium">{t('live.qty')}</th>
          <th className="px-3 py-2 text-right font-medium">{t('live.entry')}</th>
          <th className="px-3 py-2 text-right font-medium">{t('position.realized')}</th>
          <th className="px-3 py-2 text-right font-medium">{t('kpi.fees')}</th>
        </tr></thead>
        <tbody>
          {d.fills.map(f=><tr key={f.tradeId} className="border-b border-slate-100 last:border-0">
            <td className="px-3 py-1.5 text-slate-500 text-xs">{fmtDT(f.occurredAt)}</td>
            <td className="px-3 py-1.5"><span className={f.side==='BUY'?'text-success font-medium':'text-danger font-medium'}>{f.side}</span></td>
            <td className="px-3 py-1.5 text-right tnum text-slate-600">{fmtNum(f.qty,f.qty<1?6:2)}</td>
            <td className="px-3 py-1.5 text-right tnum text-slate-600">{fmtPrice(f.price)}</td>
            <td className={`px-3 py-1.5 text-right tnum ${clsPnl(f.realizedPnl)}`}>{f.realizedPnl?fmtSigned(f.realizedPnl):'—'}</td>
            <td className="px-3 py-1.5 text-right tnum text-slate-500">{fmtNum(f.commission,4)}</td>
          </tr>)}
        </tbody>
      </table>
      {d.income.length>0&&<div className="mt-4 pt-3 border-t border-slate-100">
        <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1.5">{t('position.incomeEvents')}</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
          {d.income.map((i,n)=><div key={n} className="flex justify-between text-xs">
            <span className="text-slate-500">{i.type} · {fmtDT(i.occurredAt)}</span>
            <span className={`tnum ${clsPnl(i.amount)}`}>{fmtSigned(i.amount)}</span>
          </div>)}
        </div>
      </div>}
    </Card>

    {(d.anomalies.length>0||d.incidents.length>0)&&<Card className="p-4 mb-4">
      <SectionTitle right={<span className="text-xs text-slate-400">{t('position.duringHint')}</span>}>{t('position.context')}</SectionTitle>
      <div className="grid gap-1.5">
        {d.anomalies.map((a,i)=><div key={'a'+i} className="flex items-start gap-2 text-sm">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${a.severity==='critical'?'bg-danger/10 text-danger':'bg-warn/10 text-amber-600'}`}>{t('anomaly.sev.'+a.severity)}</span>
          <span className="text-navy">{a.summary}</span>
        </div>)}
        {d.incidents.map((i,n)=><div key={'i'+n} className="flex items-start gap-2 text-sm">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500">{i.type}</span>
          <span className="text-navy">{i.summary}</span>
          {i.resolved&&<span className="text-[10px] text-success">{t('anomaly.resolved')}</span>}
        </div>)}
      </div>
    </Card>}

    <Card className="p-4">
      <SectionTitle>{t('analysis.notInstrumented')}</SectionTitle>
      <p className="text-sm text-slate-500 mb-3">{t('position.unavailableHint')}</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {Object.entries(d.unavailable).map(([k,why]: any)=>
          <div key={k} className="flex items-start gap-2 text-sm p-2 rounded-lg bg-slate-50">
            <Icon name="info" className="w-4 h-4 text-slate-400 shrink-0 mt-0.5"/>
            <div><span className="font-medium text-navy">{t('position.gap.'+k)}</span>
              <span className="block text-xs text-slate-500">{why}</span></div>
          </div>)}
      </div>
    </Card>
  </div>;
}
