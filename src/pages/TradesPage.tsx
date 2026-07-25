import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  fmtUSD, fmtSigned, fmtNum, fmtPctPlain, clsPnl, fmtPrice, fmtAgo, baseOf, PREF, toast, Icon, Card, SectionTitle, Btn, Badge, StatusPill,
  Select, ExportMenu, Donut, KpiCard, FUND_PALETTE, useApp, hasPerm, fundOf, liqInfo, marginUsagePct, dormantInfo, PageHead, Denied, SortHeader, sortRows, EmptyState, SideTag,
  PositionDetailOverlay
} from '../ui'

/* ============================================================
   TABLE PRODUCTIVITY HELPERS — column picker, presets
   ============================================================ */
// Row virtualization was removed with the table's fixed-height scroll container: windowing
// only pays off inside one, and no page here scrolls internally. Paging 50 at a time (the
// same size as every other table in the app) keeps the rendered row count bounded anyway.
const POS_PAGE_SIZE=50;
// Show/hide columns; order always follows the canonical `columns` array.
function ColumnPicker({columns,visible,onChange}: any){
  const {t}=useApp();
  const [open,setOpen]=useState(false); const ref=useRef<any>(null);
  useEffect(()=>{ const h=e=>{ if(ref.current&&!ref.current.contains(e.target))setOpen(false); }; document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h); },[]);
  const toggle=(k)=>{ const set=new Set(visible); set.has(k)?set.delete(k):set.add(k); if(set.size===0)return; onChange(columns.filter(c=>set.has(c.key)).map(c=>c.key)); };
  return <div ref={ref} className="relative">
    <Btn variant="outline" size="sm" onClick={()=>setOpen(o=>!o)}><Icon name="columns" className="w-4 h-4"/>{t('positions.columns')}</Btn>
    {open&&<div className="absolute right-0 mt-1 w-52 bg-white rounded-lg shadow-xl border border-slate-200 p-2 z-40 fadein max-h-72 overflow-y-auto">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 px-1 pb-1">{t('positions.visibleColumns')}</div>
      {columns.map(c=><label key={c.key} className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-slate-50 text-sm cursor-pointer text-navy">
        <input type="checkbox" checked={visible.includes(c.key)} onChange={()=>toggle(c.key)} className="accent-navy w-4 h-4"/>{c.label}
      </label>)}
    </div>}
  </div>;
}
// Saved views: persists named snapshots (filters/sort/columns) to localStorage.
function PresetMenu({storeKey,current,onApply}: any){
  const {t}=useApp();
  const [presets,setPresets]=useState(()=>PREF.get(storeKey,[]));
  const [open,setOpen]=useState(false); const [name,setName]=useState(''); const ref=useRef<any>(null);
  useEffect(()=>{ const h=e=>{ if(ref.current&&!ref.current.contains(e.target))setOpen(false); }; document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h); },[]);
  const persist=(next)=>{ setPresets(next); PREF.set(storeKey,next); };
  const save=()=>{ const n=name.trim(); if(!n)return; persist([...presets.filter(p=>p.name!==n),{name:n,state:current}]); setName(''); toast.success(t('positions.viewSaved',{name:n})); };
  return <div ref={ref} className="relative">
    <Btn variant="outline" size="sm" onClick={()=>setOpen(o=>!o)}><Icon name="save" className="w-4 h-4"/>{t('positions.views')}{presets.length>0&&<span className="text-[10px] text-slate-400">{presets.length}</span>}</Btn>
    {open&&<div className="absolute right-0 mt-1 w-60 bg-white rounded-lg shadow-xl border border-slate-200 p-2 z-40 fadein">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 px-1 pb-1">{t('positions.savedViews')}</div>
      {presets.length===0&&<div className="text-xs text-slate-400 px-1 py-2">{t('positions.noSavedViews')}</div>}
      {presets.map(p=><div key={p.name} className="flex items-center gap-1">
        <button onClick={()=>{onApply(p.state);setOpen(false);}} className="flex-1 text-left px-2 py-1.5 rounded-md hover:bg-slate-50 text-sm text-navy truncate">{p.name}</button>
        <button onClick={()=>persist(presets.filter(x=>x.name!==p.name))} className="text-slate-300 hover:text-danger px-1" title={t('positions.deleteView')}><Icon name="trash" className="w-3.5 h-3.5"/></button>
      </div>)}
      <div className="flex items-center gap-1 mt-2 pt-2 border-t border-slate-100">
        <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')save();}} placeholder={t('positions.saveViewPlaceholder')} className="flex-1 min-w-0 bg-slate-100 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"/>
        <Btn size="sm" onClick={save} disabled={!name.trim()}>{t('common.save')}</Btn>
      </div>
    </div>}
  </div>;
}

/* ============================================================
   POSITIONS (all bots — open + closed; full table, sort/filter/export)
   ============================================================ */
// Columns operate on a "bot" (one exchange/symbol futures position). `csv` returns
// a plain value for export; `cell` renders the table cell. `fund` is attached per row.
function buildPosCols(t: any, onDetail: any){ return [
  {key:'symbol',label:t('activity.symbol'),cell:b=><span className="font-mono text-xs text-navy">{b.symbol}</span>,csv:b=>b.symbol,def:true},
  {key:'exchange',label:t('live.exchange'),cell:b=><span className="text-slate-500 capitalize">{b.exchange}</span>,csv:b=>b.exchange,def:true},
  {key:'fund',label:t('activity.fund'),cell:b=> b.fund? <Badge color={b.fund.color} dot>{b.fund.name}</Badge> : <span className="text-xs text-slate-400">{t('live.unassigned')}</span>,csv:b=>b.fund?.name||'',def:true},
  {key:'side',label:t('activity.side'),cell:b=><SideTag side={b.side}/>,csv:b=>b.side,def:true},
  {key:'qty',label:t('live.qty'),align:'right',cell:b=><span className="tnum text-slate-500">{fmtNum(b.qty,b.qty&&b.qty<1?4:2)}</span>,csv:b=>b.qty,def:true},
  {key:'entry',label:t('live.entry'),align:'right',cell:b=><span className="tnum text-slate-500">{fmtPrice(b.entry)}</span>,csv:b=>b.entry,def:true},
  {key:'mark',label:t('live.mark'),align:'right',cell:b=><span className="tnum text-slate-500">{fmtPrice(b.mark)}</span>,csv:b=>b.mark,def:true},
  {key:'uPnl',label:t('activity.openPnl'),align:'right',cell:b=><span className={`font-medium tnum ${clsPnl(b.unrealizedPnl)}`}>{fmtSigned(b.unrealizedPnl)}</span>,csv:b=>Number((b.unrealizedPnl||0).toFixed(2)),def:true},
  {key:'notional',label:t('activity.notional'),align:'right',cell:b=><span className="tnum text-slate-500">{fmtUSD(Math.abs(b.notional))}</span>,csv:b=>Math.round(Math.abs(b.notional)),def:true},
  {key:'leverage',label:t('activity.lev'),align:'right',cell:b=><span className="tnum text-slate-500">{b.leverage?b.leverage+'×':'—'}</span>,csv:b=>b.leverage,def:false},
  {key:'liqDist',label:t('live.liqDist'),align:'right',cell:b=>{ const {pct,level}=liqInfo(b); return pct==null? <span className="text-slate-300">—</span> : <span className={`tnum font-medium ${level==='danger'?'text-danger':level==='warn'?'text-amber-600':'text-slate-500'}`}>{pct.toFixed(1)}%</span>; },csv:b=>{ const {pct}=liqInfo(b); return pct==null?'':Number(pct.toFixed(1)); },def:true},
  {key:'marginUsage',label:t('positions.marginUse'),align:'right',cell:b=>{ const p=marginUsagePct(b); return p==null? <span className="text-slate-300">—</span> : <span className={`tnum ${p>80?'text-danger':p>50?'text-amber-600':'text-slate-500'}`}>{p.toFixed(0)}%</span>; },csv:b=>{ const p=marginUsagePct(b); return p==null?'':Number(p.toFixed(1)); },def:false},
  {key:'dormant',label:t('positions.lastActivity'),cell:b=>{ const {dormant,hours}=dormantInfo(b); return hours==null? <span className="text-slate-300">—</span> : dormant? <span className="text-amber-600 font-medium flex items-center gap-1"><Icon name="clock" className="w-3.5 h-3.5"/>{t('positions.dormantAgo',{ago:b.lastChanged?fmtAgo(b.lastChanged):''})}</span> : <span className="text-slate-400">{b.lastChanged?fmtAgo(b.lastChanged):'—'}</span>; },csv:b=>{ const {hours}=dormantInfo(b); return hours==null?'':Math.round(hours)+'h'; },def:false},
  {key:'status',label:t('positions.status'),cell:b=><StatusPill status={b.status==='open'?'active':'inactive'}/>,csv:b=>b.status,def:true},
  {key:'detail',label:t('positionDetail.viewDetails'),cell:b=>b.status==='open'&&<Btn size="sm" variant="outline" onClick={()=>onDetail(b)}><Icon name="trendup" className="w-3.5 h-3.5"/>{t('positionDetail.viewDetails')}</Btn>,csv:()=>'',def:true},
]; }
const POS_GETTERS={symbol:r=>r.symbol,exchange:r=>r.exchange,fund:r=>r.fund?.name||'',side:r=>r.side,qty:r=>r.qty,entry:r=>r.entry,mark:r=>r.mark,uPnl:r=>r.unrealizedPnl,notional:r=>Math.abs(r.notional),leverage:r=>r.leverage,liqDist:r=>{const {pct}=liqInfo(r);return pct==null?Infinity:pct;},marginUsage:r=>marginUsagePct(r)??-1,dormant:r=>{const {hours}=dormantInfo(r);return hours??-1;},status:r=>r.status};

function TradesPage(){
  const {user,data,funds,refreshTick,refreshMs,t}=useApp();
  const [f,setF]=useState(()=>PREF.get('pos_filter',{fund:'all',side:'All',status:'open',q:''}));
  const [sort,setSort]=useState(()=>PREF.get('pos_sort',{col:'uPnl',dir:'desc'}));
  const [detailBot,setDetailBot]=useState(null);
  const POS_COLS=useMemo(()=>buildPosCols(t,setDetailBot),[t]);
  const [colKeys,setColKeys]=useState(()=>PREF.get('pos_cols',POS_COLS.filter(c=>c.def).map(c=>c.key)));
  const [offset,setOffset]=useState(0);
  useEffect(()=>{ PREF.set('pos_filter',f); },[f]);
  useEffect(()=>{ PREF.set('pos_sort',sort); },[sort]);
  useEffect(()=>{ PREF.set('pos_cols',colKeys); },[colKeys]);
  // Back to page 1 whenever the result set itself changes, so you're never left on a page
  // that no longer exists after narrowing a filter.
  useEffect(()=>{ setOffset(0); },[f,sort]);
  if(!hasPerm(user,'view_trades')) return <Denied/>;

  const cols=colKeys.map(k=>POS_COLS.find(c=>c.key===k)).filter(Boolean);
  let rows=data.bots.map(b=>({...b,fund:fundOf(funds,b)})).filter(b=>
    (f.fund==='all'|| (f.fund==='unassigned'? !b.fundId : b.fundId===f.fund))&&
    (f.side==='All'||b.side===f.side)&&
    (f.status==='all'||b.status===f.status)&&
    (!f.q|| (b.symbol+' '+b.exchange+' '+(b.fund?.name||'')).toLowerCase().includes(f.q.toLowerCase()))
  );
  rows=sortRows(rows,sort,POS_GETTERS);
  // `rows` stays the FULL filtered set — export must cover everything the filters match,
  // not just the page on screen. Only the rendered slice is paged.
  const pageRows=rows.slice(offset,offset+POS_PAGE_SIZE);
  const from=rows.length===0?0:offset+1, to=Math.min(offset+POS_PAGE_SIZE,rows.length);

  const clear=()=>setF({fund:'all',side:'All',status:'open',q:''});
  const active = f.fund!=='all'||f.side!=='All'||f.status!=='open'||f.q;
  const exportHeaders=cols.map(c=>c.label);
  const getExportRows=()=>rows.map(b=>cols.map(c=>c.csv(b)));
  const fundOpts=[{value:'all',label:t('positions.allFunds')},...funds.map(ff=>({value:ff.id,label:ff.name})),{value:'unassigned',label:t('live.unassigned')}];

  const openNotional=data.openBots.reduce((a,b)=>a+Math.abs(b.notional||0),0);
  const longNotional=data.openBots.filter(b=>b.side==='LONG').reduce((a,b)=>a+Math.abs(b.notional||0),0);
  const shortNotional=openNotional-longNotional;
  const openPnl=data.openBots.reduce((a,b)=>a+(b.unrealizedPnl||0),0);
  const marginUsed=data.openBots.reduce((a,b)=>a+(b.initialMargin||0),0);
  const byAsset=useMemo(()=>{
    const m=new Map();
    data.openBots.forEach(b=>{ const k=baseOf(b.symbol); m.set(k,(m.get(k)||0)+Math.abs(b.notional||0)); });
    return [...m.entries()].map(([symbol,notional])=>({symbol,notional})).sort((a,b)=>b.notional-a.notional);
  },[data.openBots]);
  const [moversTab,setMoversTab]=useState('winners');
  const movers=useMemo(()=>{
    const list=data.openBots.map(b=>({symbol:b.symbol,pnl:b.unrealizedPnl||0,pct:b.notional?(b.unrealizedPnl||0)/Math.abs(b.notional)*100:0}));
    return {winners:list.filter(m=>m.pnl>0).sort((a,b)=>b.pnl-a.pnl).slice(0,5),losers:list.filter(m=>m.pnl<0).sort((a,b)=>a.pnl-b.pnl).slice(0,5)};
  },[data.openBots]);
  // Liquidation buffer summary — reuses liqInfo() as-is (already used per-row in the
  // liqDist column above), just aggregated for a portfolio-level gauge.
  const liqRows=useMemo(()=>data.openBots.map(b=>({symbol:b.symbol,...liqInfo(b)})).filter(r=>r.pct!=null),[data.openBots]);
  const highRiskCount=liqRows.filter(r=>r.level==='danger').length;
  const avgBuffer=liqRows.length? liqRows.reduce((s,r)=>s+r.pct,0)/liqRows.length : null;
  const lowestBuffer=liqRows.length? Math.min(...liqRows.map(r=>r.pct)) : null;
  const liqColor=(pct)=>pct<10?'#EF4444':pct<25?'#F59E0B':'#10B981';

  return <div>
    <PageHead title={t('positions.title')} subtitle={t(data.bots.length===1?'positions.subtitleOne':'positions.subtitle',{shown:rows.length,total:data.bots.length})}
      refresh={{ms:refreshMs,tick:refreshTick}}
      actions={<div className="flex items-center gap-2">
        <PresetMenu storeKey="pos_presets" current={{f,sort,colKeys}} onApply={s=>{ if(s.f)setF(s.f); if(s.sort)setSort(s.sort); if(s.colKeys)setColKeys(s.colKeys); }}/>
        <ColumnPicker columns={POS_COLS} visible={colKeys} onChange={setColKeys}/>
        {hasPerm(user,'export_data')&&<ExportMenu filename="lno_positions" headers={exportHeaders} getRows={getExportRows}/>}
      </div>}/>

    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
      <KpiCard label={t('positions.totalPositions')} value={data.openBots.length} icon="briefcase" accent="#64748B"/>
      <KpiCard label={t('positions.longExposure')} value={openNotional?fmtPctPlain(longNotional/openNotional*100):'—'} icon="trendup" accent="#10B981"/>
      <KpiCard label={t('positions.shortExposure')} value={openNotional?fmtPctPlain(shortNotional/openNotional*100):'—'} icon="trendup" accent="#EF4444"/>
      <KpiCard label={t('activity.openPnl')} value={<span className={clsPnl(openPnl)}>{fmtSigned(openPnl)}</span>}/>
      <KpiCard label={t('positions.marginUse')} value={fmtUSD(marginUsed)} icon="layers" accent="#3B82F6"/>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-4 gap-5 mb-4">
      <div className="lg:col-span-3 space-y-4">
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={f.fund} onChange={v=>setF({...f,fund:v})} className="w-44" options={fundOpts}/>
        <Select value={f.side} onChange={v=>setF({...f,side:v})} className="w-32" options={['All','LONG','SHORT']}/>
        <Select value={f.status} onChange={v=>setF({...f,status:v})} className="w-32" options={[{value:'all',label:t('positions.statusAll')},{value:'open',label:t('positions.statusOpen')},{value:'closed',label:t('positions.statusClosed')}]}/>
        <div className="relative flex-1 min-w-[160px]"><Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={f.q} onChange={e=>setF({...f,q:e.target.value})} placeholder={t('positions.searchPlaceholder')} className="w-full bg-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"/></div>
        {active&&<Btn variant="ghost" size="sm" onClick={clear}><Icon name="x" className="w-3.5 h-3.5"/>{t('positions.clearFilters')}</Btn>}
      </div>
    </Card>
    <Card className="overflow-hidden">
      {/* No inner scroll: the page scrolls, and the row count is bounded by paging. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs"><tr className="bg-white border-b border-slate-200">
            {cols.map(c=><SortHeader key={c.key} label={c.label} col={c.key} sort={sort} setSort={setSort} align={c.align||'left'}/>)}
          </tr></thead>
          <tbody>
            {pageRows.map(b=><tr key={b.id} className={`border-b border-slate-50 hover:bg-slate-50/60 ${b.side==='LONG'?'bg-success/[.03]':b.side==='SHORT'?'bg-danger/[.03]':''}`}>
              {cols.map(c=><td key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.align==='right'?'text-right':''} ${c.cls||''}`}>{c.cell(b)}</td>)}
            </tr>)}
          </tbody>
        </table>
      </div>
      {rows.length===0&&<div className="p-10"><EmptyState icon="briefcase" title={data.bots.length===0?t('positions.noPositionsYet'):t('positions.noPositionsMatch')} hint={data.bots.length===0?t('positions.noPositionsHint'):undefined}/></div>}
      {rows.length>POS_PAGE_SIZE&&<div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
        <span>{t('common.pageRange',{from,to,total:rows.length})}</span>
        <div className="flex items-center gap-2">
          <Btn variant="ghost" size="sm" disabled={offset===0} onClick={()=>setOffset(o=>Math.max(0,o-POS_PAGE_SIZE))}><Icon name="chevleft" className="w-4 h-4"/>{t('common.prev')}</Btn>
          <Btn variant="ghost" size="sm" disabled={offset+POS_PAGE_SIZE>=rows.length} onClick={()=>setOffset(o=>o+POS_PAGE_SIZE)}>{t('common.next')}<Icon name="chevright" className="w-4 h-4"/></Btn>
        </div>
      </div>}
    </Card>
      </div>
      <div className="space-y-4">
      <Card className="p-5">
        <SectionTitle>{t('positions.exposureByAsset')}</SectionTitle>
        {byAsset.length===0? <div className="h-[180px] grid place-items-center text-center text-sm text-slate-400">{t('activity.noExposure')}</div>
        : <div className="flex flex-col items-center gap-4">
          <Donut size={130} thickness={15}
            segments={byAsset.map((a,i)=>({value:a.notional,color:FUND_PALETTE[i%FUND_PALETTE.length]}))}
            center={<div><div className="text-sm font-bold text-navy tnum">{fmtUSD(openNotional)}</div><div className="text-[10px] text-slate-400">{t('activity.exposure')}</div></div>}/>
          <div className="w-full space-y-1.5">
            {byAsset.map((a,i)=><div key={a.symbol} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 min-w-0"><span className="w-2 h-2 rounded-full shrink-0" style={{background:FUND_PALETTE[i%FUND_PALETTE.length]}}/><span className="truncate text-slate-600">{a.symbol}</span></span>
              <span className="font-medium text-navy tnum shrink-0">{(a.notional/openNotional*100).toFixed(1)}%</span>
            </div>)}
          </div>
        </div>}
      </Card>

      <Card className="p-5">
        <SectionTitle right={<div className="flex bg-slate-100 rounded-lg p-0.5 text-xs">
          <button onClick={()=>setMoversTab('winners')} className={`px-2.5 py-1 rounded-md font-medium transition ${moversTab==='winners'?'bg-white text-navy shadow-sm':'text-slate-500'}`}>{t('positions.winners')}</button>
          <button onClick={()=>setMoversTab('losers')} className={`px-2.5 py-1 rounded-md font-medium transition ${moversTab==='losers'?'bg-white text-navy shadow-sm':'text-slate-500'}`}>{t('positions.losers')}</button>
        </div>}>{t('positions.topMovers')}</SectionTitle>
        {(movers[moversTab]||[]).length===0? <div className="text-sm text-slate-400 py-6 text-center">{t('positions.noMovers')}</div>
        : <div className="space-y-2.5">
          {movers[moversTab].map(m=><div key={m.symbol} className="flex items-center justify-between text-sm">
            <span className="font-mono text-xs text-navy">{m.symbol}</span>
            <span className={`font-medium tnum ${clsPnl(m.pnl)}`}>{fmtSigned(m.pnl)} <span className="text-[11px] opacity-70">({fmtPctPlain(Math.abs(m.pct))})</span></span>
          </div>)}
        </div>}
      </Card>

      <Card className="p-5">
        <SectionTitle>{t('positions.liquidationBuffer')}</SectionTitle>
        {liqRows.length===0? <div className="text-sm text-slate-400 py-6 text-center">{t('positions.noLiqData')}</div>
        : <>
          <div className="grid grid-cols-3 gap-2 mb-4 text-center">
            <div><div className="text-[11px] text-slate-400">{t('positions.highRisk')}</div><div className={`text-lg font-bold tnum ${highRiskCount>0?'text-danger':'text-navy'}`}>{highRiskCount}</div></div>
            <div><div className="text-[11px] text-slate-400">{t('positions.avgBuffer')}</div><div className="text-lg font-bold text-navy tnum">{avgBuffer.toFixed(1)}%</div></div>
            <div><div className="text-[11px] text-slate-400">{t('positions.lowestBuffer')}</div><div className="text-lg font-bold tnum" style={{color:liqColor(lowestBuffer)}}>{lowestBuffer.toFixed(1)}%</div></div>
          </div>
          <div className="flex justify-center">
            <Donut size={130} thickness={15} arc={180} startAngle={-180}
              segments={[{value:lowestBuffer,color:liqColor(lowestBuffer)},{value:100-lowestBuffer,color:'#EEF0F3'}]}
              center={<div className="text-base font-bold text-navy mt-4">{lowestBuffer.toFixed(1)}%</div>}/>
          </div>
        </>}
      </Card>
      </div>
    </div>
    <PositionDetailOverlay bot={detailBot} onClose={()=>setDetailBot(null)}/>
  </div>;
}

export { TradesPage };
