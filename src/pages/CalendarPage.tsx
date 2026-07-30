import React from 'react'
const { useState, useEffect, useMemo } = React;
import {
  fmtSigned, fmtNum, fmtPctPlain, clsPnl, Icon, Card, SectionTitle, Select, KpiCard, PageHead,
  Denied, Loader, EmptyState, useApp, hasPerm, useAnalysisFilters, AnalysisFilterBar
} from '../ui'

/* ============================================================
   PnL CALENDAR + HEATMAPS
   ============================================================ */
// Reads the same trade set, the same filters and the same KPI definitions as the Analysis
// page (api/_lib/analytics.js) — this is a different LAYOUT of one dataset, not a second
// pipeline that could disagree with the first.
//
// The calendar answers "when did we make and lose money"; the heatmaps answer "is that a
// pattern or a coincidence". Both matter: a bad Tuesday is noise, a bad Tuesday every week is
// a finding.

const GRANULARITIES=['day','week','month','year'];
const DOW_ORDER=['mon','tue','wed','thu','fri','sat','sun'];

// Diverging green/red ramp shared by the calendar and every heatmap on the page, scaled to
// the largest absolute value in view so one outlier day cannot flatten everything else.
function heat(v: number, max: number){
  if(v==null||!max) return {background:'#F1F5F9'};
  const a=Math.min(1,Math.abs(v)/max)*0.85+0.08;
  return {background:(v>0?'rgba(16,185,129,':'rgba(239,68,68,')+a.toFixed(2)+')', color:a>0.55?'#fff':'#0F172A'};
}

// One calendar month. Rendered as a real Mon–Sun grid rather than a strip of dots: the
// question "are we losing money on the same weekday" is unanswerable without the columns
// lining up.
function MonthGrid({year,month,byDay,max,t,lang}: any){
  const first=new Date(Date.UTC(year,month,1));
  const daysInMonth=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  const lead=(first.getUTCDay()+6)%7;      // Monday-first offset
  const cells: any[]=[...Array(lead).fill(null)];
  for(let d=1;d<=daysInMonth;d++){
    const key=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push({day:d,key,row:byDay.get(key)||null});
  }
  while(cells.length%7) cells.push(null);
  const monthTotal=cells.reduce((s,c)=>s+(c?.row?.netPnl||0),0);
  const monthTrades=cells.reduce((s,c)=>s+(c?.row?.trades||0),0);
  return <div>
    <div className="flex items-baseline justify-between mb-1.5">
      <span className="text-xs font-semibold text-navy">{new Date(Date.UTC(year,month,1)).toLocaleDateString(lang,{month:'long',year:'numeric',timeZone:'UTC'})}</span>
      {monthTrades>0&&<span className={`text-xs font-medium tnum ${clsPnl(monthTotal)}`}>{fmtSigned(monthTotal)}</span>}
    </div>
    <div className="grid grid-cols-7 gap-1">
      {DOW_ORDER.map(d=><div key={d} className="text-[9px] text-slate-400 text-center uppercase tracking-tight">{t('dow.'+d).slice(0,2)}</div>)}
      {cells.map((c,i)=> c===null
        ? <div key={i}/>
        : <div key={i} className="aspect-square rounded text-[9px] grid place-items-center cursor-default"
            style={c.row?heat(c.row.netPnl,max):{background:'#F8FAFC',color:'#CBD5E1'}}
            title={c.row
              ? `${c.key}\n${t('kpi.netPnl')}: ${fmtSigned(c.row.netPnl)}\n${t('kpi.trades')}: ${c.row.trades}\n${t('kpi.winRate')}: ${c.row.winRate==null?'—':fmtPctPlain(c.row.winRate)}\n${t('kpi.maxDrawdown')}: ${fmtSigned(c.row.maxDrawdown)}`
              : `${c.key} · ${t('calendar.noTrade')}`}>
            {c.day}
          </div>)}
    </div>
  </div>;
}

// Period rows for week/month/year. A grid makes no sense at those granularities — there are
// few enough buckets that the actual numbers fit, and they are what gets read.
function PeriodTable({rows,t}: any){
  const max=Math.max(1,...rows.map(r=>Math.abs(r.netPnl)));
  return <table className="w-full text-sm">
    <thead><tr className="border-b border-slate-200 text-slate-500">
      <th className="px-3 py-2 text-left font-medium">{t('calendar.period')}</th>
      <th className="px-3 py-2 text-right font-medium">{t('kpi.trades')}</th>
      <th className="px-3 py-2 text-right font-medium">{t('kpi.netPnl')}</th>
      <th className="px-3 py-2 text-right font-medium">{t('kpi.winRate')}</th>
      <th className="px-3 py-2 text-right font-medium">{t('kpi.maxDrawdown')}</th>
      <th className="px-3 py-2 text-right font-medium">{t('kpi.profitFactor')}</th>
      <th className="px-3 py-2 w-32"/>
    </tr></thead>
    <tbody>
      {rows.map(r=><tr key={r.key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
        <td className="px-3 py-2 font-medium text-navy">{r.key}</td>
        <td className="px-3 py-2 text-right tnum text-slate-600">{r.trades}</td>
        <td className={`px-3 py-2 text-right tnum font-semibold ${clsPnl(r.netPnl)}`}>{fmtSigned(r.netPnl)}</td>
        <td className="px-3 py-2 text-right tnum text-slate-600">{r.winRate==null?'—':fmtPctPlain(r.winRate)}</td>
        <td className="px-3 py-2 text-right tnum text-danger">{r.maxDrawdown?fmtSigned(r.maxDrawdown):'—'}</td>
        <td className="px-3 py-2 text-right tnum text-slate-600">{r.profitFactor==null?'n/a':fmtNum(r.profitFactor,2)}</td>
        {/* Proportional bar: the shape of the period is readable before any number is. */}
        <td className="px-3 py-2">
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full ${r.netPnl>=0?'bg-success':'bg-danger'}`} style={{width:`${Math.abs(r.netPnl)/max*100}%`}}/>
          </div>
        </td>
      </tr>)}
    </tbody>
  </table>;
}

// Weekday × entry-hour grid. The single most useful heatmap here: strategies inherit the
// rhythm of the sessions they trade in, and that rhythm is invisible in a daily total.
function WhenHeatmap({matrix,t}: any){
  const cells=useMemo(()=>{
    const m=new Map<string,any>();
    let max=0;
    for(const row of matrix||[]) for(const c of row.cells){
      m.set(`${row.key}|${c.key}`,c);
      max=Math.max(max,Math.abs(c.netPnl));
    }
    return {m,max};
  },[matrix]);
  const hours=Array.from({length:24},(_,i)=>String(i).padStart(2,'0')+'h');
  return <div className="overflow-x-auto">
    <table className="text-xs border-separate" style={{borderSpacing:'2px'}}>
      <thead><tr>
        <th className="sticky left-0 bg-white"/>
        {hours.map(h=><th key={h} className="text-[9px] font-normal text-slate-400 w-6">{h.slice(0,2)}</th>)}
      </tr></thead>
      <tbody>
        {DOW_ORDER.map(d=><tr key={d}>
          <td className="pr-2 text-[10px] text-slate-500 sticky left-0 bg-white whitespace-nowrap">{t('dow.'+d).slice(0,3)}</td>
          {hours.map(h=>{ const c=cells.m.get(`${d}|${h}`);
            return <td key={h} className="w-6 h-6 rounded" style={c?heat(c.netPnl,cells.max):{background:'#F8FAFC'}}
              title={c?`${t('dow.'+d)} ${h} · ${fmtSigned(c.netPnl)} · ${c.trades} ${t('kpi.trades').toLowerCase()}`:`${t('dow.'+d)} ${h} · ${t('calendar.noTrade')}`}/>;
          })}
        </tr>)}
      </tbody>
    </table>
  </div>;
}

// Ranked bars for a categorical dimension (asset, bot, leverage band…). Best and worst are
// what a reader looks for, so the list is sorted by contribution, not alphabetically.
function RankBars({rows,t,label}: any){
  const max=Math.max(1,...rows.map(r=>Math.abs(r.netPnl)));
  if(!rows.length) return <p className="text-sm text-slate-400 italic">{t('calendar.noTrade')}</p>;
  return <div>
    <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-2">{label}</div>
    <div className="grid gap-1.5">
      {rows.map(r=><div key={r.key} className="flex items-center gap-2 text-xs">
        <span className="w-24 truncate text-navy font-medium">{r.key}</span>
        <div className="flex-1 h-3 rounded bg-slate-100 overflow-hidden flex">
          <div className={`h-full ${r.netPnl>=0?'bg-success':'bg-danger'}`} style={{width:`${Math.abs(r.netPnl)/max*100}%`}}/>
        </div>
        <span className={`w-24 text-right tnum font-medium ${clsPnl(r.netPnl)}`}>{fmtSigned(r.netPnl)}</span>
        <span className="w-12 text-right tnum text-slate-400">{r.trades}</span>
      </div>)}
    </div>
  </div>;
}

export default function CalendarPage(){
  const {api,user,t,lang}=useApp();
  const filters=useAnalysisFilters();
  const [gran,setGran]=useState('day');
  const [meta,setMeta]=useState<any>(null);
  const [cal,setCal]=useState<any>(null);
  const [when,setWhen]=useState<any>(null);
  const [bySymbol,setBySymbol]=useState<any>(null);
  const [byLeverage,setByLeverage]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const allowed=hasPerm(user,'view_trades');

  useEffect(()=>{ if(allowed) api('snapshots?analysis=meta').then(setMeta).catch(()=>{}); },[allowed,api]);

  useEffect(()=>{ if(!allowed) return;
    setLoading(true);
    const q=filters.qs?'&'+filters.qs:'';
    Promise.all([
      api(`snapshots?analysis=1&calendar=${gran}${q}`),
      api(`snapshots?analysis=1&group=dow&compare=hour${q}`),
      api(`snapshots?analysis=1&group=symbol${q}`),
      api(`snapshots?analysis=1&group=leverage${q}`),
    ]).then(([c,w,s,l])=>{ setCal(c); setWhen(w); setBySymbol(s); setByLeverage(l); })
      .catch(()=>{ setCal(null); })
      .finally(()=>setLoading(false));
  },[allowed,gran,filters.qs,api]);

  // Which months to draw: every month between the first and last day that has a trade, so
  // quiet months still appear as gaps instead of being silently skipped.
  const months=useMemo(()=>{
    if(gran!=='day'||!cal?.rows?.length) return [];
    const keys=cal.rows.map(r=>r.key).sort();
    const [y0,m0]=keys[0].split('-').map(Number);
    const [y1,m1]=keys[keys.length-1].split('-').map(Number);
    const out=[];
    for(let y=y0,m=m0-1; y<y1||(y===y1&&m<=m1-1); m++){ if(m>11){m=0;y++;} out.push([y,m]); if(out.length>36) break; }
    return out;
  },[cal,gran]);
  const byDay=useMemo(()=>new Map((cal?.rows||[]).map(r=>[r.key,r])),[cal]);
  const dayMax=useMemo(()=>Math.max(1,...(cal?.rows||[]).map(r=>Math.abs(r.netPnl))),[cal]);

  if(!allowed) return <Denied/>;
  const tot=cal?.total;

  return <div className="fadein">
    <PageHead title={t('calendar.title')} subtitle={t('calendar.subtitle')}/>
    <AnalysisFilterBar filters={filters} meta={meta}/>

    <Card className="p-3 mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('calendar.granularity')}</span>
        <Select value={gran} onChange={setGran} className="w-44"
          options={GRANULARITIES.map(g=>({value:g,label:t('calendar.gran.'+g)}))}/>
        {tot?.trades>0&&<span className="text-xs text-slate-400 ml-auto">{t('calendar.periods',{n:cal.rows.length})}</span>}
      </div>
    </Card>

    {loading&&<div className="py-16"><Loader/></div>}

    {!loading&&tot&&tot.trades===0&&<EmptyState icon="clock" title={t('analysis.empty')} hint={t('analysis.emptyHint')}/>}

    {!loading&&tot&&tot.trades>0&&<>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard label={t('kpi.netPnl')} value={<span className={clsPnl(tot.netPnl)}>{fmtSigned(tot.netPnl)}</span>} icon="dollar"/>
        <KpiCard label={t('kpi.trades')} value={tot.trades} icon="briefcase"/>
        <KpiCard label={t('calendar.bestPeriod')} value={<span className="text-success">{fmtSigned(Math.max(...cal.rows.map(r=>r.netPnl)))}</span>} icon="trendup"/>
        <KpiCard label={t('calendar.worstPeriod')} value={<span className="text-danger">{fmtSigned(Math.min(...cal.rows.map(r=>r.netPnl)))}</span>} icon="trendup"/>
      </div>

      <Card className="p-4 mb-4">
        <SectionTitle right={<span className="text-xs text-slate-400">{t('calendar.hoverHint')}</span>}>
          {t('calendar.gran.'+gran)}
        </SectionTitle>
        {gran==='day'
          ? <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {months.map(([y,m])=><MonthGrid key={`${y}-${m}`} year={y} month={m} byDay={byDay} max={dayMax} t={t} lang={lang}/>)}
            </div>
          : <PeriodTable rows={[...cal.rows].reverse()} t={t}/>}
      </Card>

      <Card className="p-4 mb-4">
        <SectionTitle right={<span className="text-xs text-slate-400">{t('calendar.netPerCell')}</span>}>{t('calendar.whenTitle')}</SectionTitle>
        <WhenHeatmap matrix={when?.matrix} t={t}/>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4"><RankBars rows={bySymbol?.rows||[]} t={t} label={t('dim.symbol')}/></Card>
        <Card className="p-4"><RankBars rows={byLeverage?.rows||[]} t={t} label={t('dim.leverage')}/></Card>
      </div>
    </>}
  </div>;
}
