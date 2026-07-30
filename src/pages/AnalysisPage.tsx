import React from 'react'
const { useState, useEffect, useMemo } = React;
import {
  fmtUSD, fmtSigned, fmtNum, fmtPctPlain, fmtSeconds, clsPnl, Icon, Card, SectionTitle, Btn, Select,
  KpiCard, PageHead, Denied, Loader, EmptyState, SortHeader, sortRows, ExportMenu,
  useApp, hasPerm, useAnalysisFilters, AnalysisFilterBar
} from '../ui'

/* ============================================================
   CROSS-DIMENSION ANALYSIS
   ============================================================ */
// Every figure on this page comes from api/_lib/analytics.js — the same module the calendar,
// the playbook and the weekly report read. Nothing is recomputed client-side, so a win rate
// here is the same win rate everywhere by construction rather than by convention.

// Column set for the breakdown table. `v` pulls the raw value (sorting + export), `cell`
// renders it. Kept in one array so the table, the sorter and the CSV export can't drift.
function buildCols(t: any, dim: string){ return [
  {key:'key',       label:t('analysis.bucket'), align:'left',  v:r=>bucketLabel(dim,r.key,t), cell:r=><span className="font-medium text-navy">{bucketLabel(dim,r.key,t)}</span>},
  {key:'trades',    label:t('kpi.trades'),      align:'right', v:r=>r.trades,       cell:r=><span className="tnum text-slate-600">{r.trades}</span>},
  {key:'netPnl',    label:t('kpi.netPnl'),      align:'right', v:r=>r.netPnl,       cell:r=><span className={`font-semibold tnum ${clsPnl(r.netPnl)}`}>{fmtSigned(r.netPnl)}</span>},
  {key:'winRate',   label:t('kpi.winRate'),     align:'right', v:r=>r.winRate??-1,  cell:r=><span className="tnum text-slate-600">{r.winRate==null?'—':fmtPctPlain(r.winRate)}</span>},
  {key:'profitFactor', label:t('kpi.profitFactor'), align:'right', v:r=>r.profitFactor??-1, cell:r=><PF v={r.profitFactor}/>},
  {key:'expectancy',label:t('kpi.expectancy'),  align:'right', v:r=>r.expectancy??0,cell:r=><span className={`tnum ${clsPnl(r.expectancy)}`}>{r.expectancy==null?'—':fmtSigned(r.expectancy)}</span>},
  {key:'maxDrawdown',label:t('kpi.maxDrawdown'),align:'right', v:r=>r.maxDrawdown,  cell:r=><span className="tnum text-danger">{r.maxDrawdown?fmtSigned(r.maxDrawdown):'—'}</span>},
  {key:'fees',      label:t('kpi.fees'),        align:'right', v:r=>r.fees,         cell:r=><span className="tnum text-slate-500">{fmtUSD(r.fees)}</span>},
  {key:'funding',   label:t('kpi.funding'),     align:'right', v:r=>r.funding,      cell:r=><span className={`tnum ${clsPnl(r.funding)}`}>{fmtSigned(r.funding)}</span>},
  {key:'avgDurationS',label:t('kpi.avgDuration'),align:'right',v:r=>r.avgDurationS??0,cell:r=><span className="tnum text-slate-500">{r.avgDurationS==null?'—':fmtSeconds(r.avgDurationS)}</span>},
]; }

// Bucket keys are stable machine values ('mon', 'LONG', '<5m') so they survive sorting,
// filtering and CSV export unchanged. Only the DISPLAY is localised — weekday keys have real
// translations, the rest are already human-readable symbols or bands.
function bucketLabel(dim: string, key: string, t: any){
  if(dim==='dow') return key==='unknown'?key:t('dow.'+key);
  return key;
}

// A profit factor with no losing trade in the set is undefined, not infinite — showing "∞"
// as a number would let a 1-trade bucket outrank every real strategy in a sort.
function PF({v}: any){
  if(v==null) return <span className="text-slate-400" title="no losing trade in this set">n/a</span>;
  return <span className={`tnum font-medium ${v>=1.5?'text-success':v>=1?'text-navy':'text-danger'}`}>{fmtNum(v,2)}</span>;
}

// Signed colour ramp for the comparison matrix: green above zero, red below, intensity
// proportional to the largest absolute value in the grid so one outlier can't wash it out.
function heatStyle(v: number, max: number){
  if(!max||!v) return {};
  const a=Math.min(1,Math.abs(v)/max)*0.8+0.06;
  return {background:(v>0?'rgba(16,185,129,':'rgba(239,68,68,')+a.toFixed(2)+')', color:a>0.5?'#fff':undefined};
}

export default function AnalysisPage(){
  const {api,user,t}=useApp();
  const filters=useAnalysisFilters();
  const [meta,setMeta]=useState<any>(null);
  const [data,setData]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [group,setGroup]=useState(()=>'symbol');
  const [compare,setCompare]=useState('');
  const [sort,setSort]=useState({col:'netPnl',dir:'desc'});
  const allowed=hasPerm(user,'view_trades');

  useEffect(()=>{ if(!allowed) return;
    api('snapshots?analysis=meta').then(setMeta).catch(()=>setMeta(null));
  },[allowed]);

  useEffect(()=>{ if(!allowed) return;
    setLoading(true);
    const q=[`analysis=1`,`group=${group}`,compare?`compare=${compare}`:'',filters.qs].filter(Boolean).join('&');
    api('snapshots?'+q).then(setData).catch(()=>setData(null)).finally(()=>setLoading(false));
  },[allowed,group,compare,filters.qs]);

  const cols=useMemo(()=>buildCols(t,group),[t,group]);
  const rows=useMemo(()=>sortRows(data?.rows||[],sort,Object.fromEntries(cols.map(c=>[c.key,c.v]))),[data,sort,cols]);
  const tot=data?.total;

  if(!allowed) return <Denied/>;

  const dimOpts=(meta?.dimensions||[]).map(d=>({value:d.key,label:t(d.label)}));

  return <div className="fadein">
    <PageHead title={t('analysis.title')} subtitle={t('analysis.subtitle')}
      actions={hasPerm(user,'export_data')&&<ExportMenu filename={`lno_analysis_${group}`} headers={cols.map(c=>c.label)}
        getRows={()=>rows.map(r=>cols.map(c=>c.v(r)))}/>}/>

    <AnalysisFilterBar filters={filters} meta={meta}/>

    <Card className="p-3 mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('analysis.groupBy')}</span>
          <Select value={group} onChange={setGroup} options={dimOpts} className="w-44"/>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('analysis.compare')}</span>
          <Select value={compare} onChange={setCompare} className="w-44"
            options={[{value:'',label:t('analysis.none')},...dimOpts.filter(o=>o.value!==group)]}/>
        </div>
        {meta?.span?.trades>0&&<span className="text-xs text-slate-400 ml-auto">{t('analysis.span',{n:meta.span.trades})}</span>}
      </div>
    </Card>

    {loading&&<div className="py-16"><Loader/></div>}

    {!loading&&tot&&tot.trades===0&&<EmptyState icon="database" title={t('analysis.empty')} hint={t('analysis.emptyHint')}/>}

    {!loading&&tot&&tot.trades>0&&<>
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-4">
        <KpiCard label={t('kpi.netPnl')} value={<span className={clsPnl(tot.netPnl)}>{fmtSigned(tot.netPnl)}</span>} icon="dollar"/>
        <KpiCard label={t('kpi.trades')} value={tot.trades} icon="briefcase"/>
        <KpiCard label={t('kpi.winRate')} value={tot.winRate==null?'—':fmtPctPlain(tot.winRate)} icon="trendup"/>
        <KpiCard label={t('kpi.profitFactor')} value={<PF v={tot.profitFactor}/>} icon="activity"/>
        <KpiCard label={t('kpi.expectancy')} value={<span className={clsPnl(tot.expectancy)}>{tot.expectancy==null?'—':fmtSigned(tot.expectancy)}</span>} icon="layers"/>
        <KpiCard label={t('kpi.maxDrawdown')} value={<span className="text-danger">{fmtSigned(tot.maxDrawdown)}</span>} icon="trendup"/>
      </div>

      <Card className="p-4 mb-4">
        <SectionTitle right={<span className="text-xs text-slate-400">{t('analysis.buckets',{n:rows.length})}</span>}>
          {t('analysis.breakdown',{dim:t(`dim.${group}`)})}
        </SectionTitle>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200">
            {cols.map(c=><SortHeader key={c.key} label={c.label} col={c.key} sort={sort} setSort={setSort} align={c.align}/>)}
          </tr></thead>
          <tbody>
            {rows.map(r=><tr key={r.key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
              {cols.map(c=><td key={c.key} className={`px-3 py-2 text-${c.align}`}>{c.cell(r)}</td>)}
            </tr>)}
            <tr className="bg-slate-50 font-semibold">
              <td className="px-3 py-2 text-navy">{t('analysis.total')}</td>
              {cols.slice(1).map(c=><td key={c.key} className={`px-3 py-2 text-${c.align}`}>{c.cell(tot)}</td>)}
            </tr>
          </tbody>
        </table>
      </Card>

      {data.matrix&&<MatrixCard data={data} t={t} order={(meta?.dimensions||[]).find(d=>d.key===data.compare)?.order}/>}
    </>}

    {meta?.unavailable&&<Card className="p-4 border-slate-200">
      <SectionTitle>{t('analysis.notInstrumented')}</SectionTitle>
      <p className="text-sm text-slate-500 mb-3">{t('analysis.notInstrumentedHint')}</p>
      <div className="grid sm:grid-cols-2 gap-2">
        {Object.entries(meta.unavailable).map(([k,why]: any)=>
          <div key={k} className="flex items-start gap-2 text-sm p-2 rounded-lg bg-slate-50">
            <Icon name="info" className="w-4 h-4 text-slate-400 shrink-0 mt-0.5"/>
            <div><span className="font-medium text-navy">{t('gap.'+k)}</span>
              <span className="block text-xs text-slate-500">{why}</span></div>
          </div>)}
      </div>
    </Card>}
  </div>;
}

// Two-axis view: rows are the primary dimension, columns the comparison one. Cells show net
// PnL only — a full KPI block per cell would be unreadable at this density, and net PnL is
// the figure that tells you where to look next.
function MatrixCard({data,t,order}: any){
  const colKeys=useMemo(()=>{
    const set=new Set<string>();
    for(const r of data.matrix) for(const c of r.cells) set.add(c.key);
    const keys=[...set];
    // An ordinal axis (weekday, hour, duration, leverage) must follow its own sequence —
    // alphabetical order turns a weekly pattern into noise.
    const ord=order||null;
    return ord ? keys.sort((a,b)=>ord.indexOf(a)-ord.indexOf(b)) : keys.sort();
  },[data,order]);
  const max=useMemo(()=>Math.max(0,...data.matrix.flatMap(r=>r.cells.map(c=>Math.abs(c.netPnl)))),[data]);
  return <Card className="p-4 mb-4">
    <SectionTitle right={<span className="text-xs text-slate-400">{t('analysis.matrixHint')}</span>}>
      {t('analysis.matrixTitle',{a:t(`dim.${data.dimension}`),b:t(`dim.${data.compare}`)})}
    </SectionTitle>
    <div className="overflow-x-auto">
      <table className="text-sm">
        <thead><tr>
          <th className="px-3 py-2 text-left font-medium text-slate-500 sticky left-0 bg-white">{t(`dim.${data.dimension}`)}</th>
          {colKeys.map(k=><th key={k} className="px-3 py-2 text-right font-medium text-slate-500 whitespace-nowrap">{bucketLabel(data.compare,k,t)}</th>)}
        </tr></thead>
        <tbody>
          {data.matrix.map(r=>{
            const by=Object.fromEntries(r.cells.map(c=>[c.key,c]));
            return <tr key={r.key} className="border-t border-slate-100">
              <td className="px-3 py-2 font-medium text-navy sticky left-0 bg-white whitespace-nowrap">{bucketLabel(data.dimension,r.key,t)}</td>
              {colKeys.map(k=>{ const c=by[k];
                return <td key={k} className="px-3 py-2 text-right tnum whitespace-nowrap rounded" style={c?heatStyle(c.netPnl,max):undefined}
                  title={c?`${c.trades} ${t('kpi.trades').toLowerCase()}`:''}>
                  {c?fmtSigned(c.netPnl):<span className="text-slate-300">—</span>}
                </td>; })}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </Card>;
}
