import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  fmtUSD, fmtSigned, fmtNum, clsPnl, fmtPrice, PREF, toast, Icon, Card, Btn, Badge, StatusPill,
  Select, ExportMenu, useApp, hasPerm, fundOf, PageHead, Denied, SortHeader, sortRows, EmptyState, SideTag
} from '../ui'

/* ============================================================
   TABLE PRODUCTIVITY HELPERS — virtual rows, column picker, presets
   ============================================================ */
// Windowed row virtualization for a fixed-row-height scroll container.
function useVirtual({count,rowH,overscan=10,resetKey}){
  const ref=useRef<any>(null);
  const [scrollTop,setScrollTop]=useState(0);
  const [h,setH]=useState(640);
  useEffect(()=>{ const el=ref.current; if(!el)return; const onScroll=()=>setScrollTop(el.scrollTop); const measure=()=>setH(el.clientHeight||640); measure(); el.addEventListener('scroll',onScroll,{passive:true}); window.addEventListener('resize',measure); return ()=>{ el.removeEventListener('scroll',onScroll); window.removeEventListener('resize',measure); }; },[]);
  useEffect(()=>{ const el=ref.current; if(el) el.scrollTop=0; setScrollTop(0); },[resetKey]);
  const start=Math.max(0,Math.floor(scrollTop/rowH)-overscan);
  const end=Math.min(count,Math.ceil((scrollTop+h)/rowH)+overscan);
  return {ref,start,end,padTop:start*rowH,padBottom:Math.max(0,(count-end)*rowH)};
}
// Show/hide columns; order always follows the canonical `columns` array.
function ColumnPicker({columns,visible,onChange}: any){
  const [open,setOpen]=useState(false); const ref=useRef<any>(null);
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
function PresetMenu({storeKey,current,onApply}: any){
  const [presets,setPresets]=useState(()=>PREF.get(storeKey,[]));
  const [open,setOpen]=useState(false); const [name,setName]=useState(''); const ref=useRef<any>(null);
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

export { TradesPage };
