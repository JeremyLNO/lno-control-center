import React from 'react'
const { useState, useEffect } = React;
import { fmtDT, api, Icon, Card, Btn, Select, Input, useApp, hasPerm, PageHead, Denied, Loader } from '../ui'

/* ============================================================
   AUDIT LOG — read-only trail of sensitive changes (view_audit).
   The backend already recorded these (api/_lib/audit.js); this page is the first
   thing that actually surfaces them. Paged 50-at-a-time, filters applied server-side
   so paging stays correct while a filter is active.
   ============================================================ */
const PAGE_SIZE = 50;
function AuditPage(){
  const {user,t}=useApp();
  const [page,setPage]=useState(null); const [offset,setOffset]=useState(0);
  const [actions,setActions]=useState<string[]>([]);
  const [actionF,setActionF]=useState('all'); const [q,setQ]=useState(''); const [dateF,setDateF]=useState('');
  const canView=hasPerm(user,'view_audit');
  useEffect(()=>{ setOffset(0); },[actionF,q,dateF]);
  useEffect(()=>{
    if(!canView) return;
    const qs=new URLSearchParams({audit:'1',limit:String(PAGE_SIZE),offset:String(offset)});
    if(actionF!=='all') qs.set('action',actionF);
    if(q.trim()) qs.set('q',q.trim());
    if(dateF) qs.set('date',dateF);
    setPage(null);
    api('users?'+qs.toString()).then(r=>{ setPage(r); if(r.actions&&r.actions.length) setActions(r.actions); })
      .catch(()=>setPage({audit:[],total:0}));
  },[actionF,q,dateF,offset]);
  if(!canView) return <Denied/>;

  const rows=page?page.audit:[]; const total=page?page.total:0;
  const from=total===0?0:offset+1; const to=Math.min(offset+PAGE_SIZE,total);
  // detail is a free-form JSON blob per action — render it compactly rather than pretending
  // every action has the same shape. Nested objects (rules.update's whole permission map)
  // would otherwise swamp the row, so summarize those by key count and keep the full text
  // in a tooltip.
  const valueOf=(v)=>{
    if(Array.isArray(v)) return v.length>4? `${v.slice(0,4).join(', ')} +${v.length-4}` : v.join(', ');
    if(v&&typeof v==='object') return `{${Object.keys(v).join(', ')}}`;
    return String(v);
  };
  const detailOf=(d)=>{ if(!d||typeof d!=='object') return ''; return Object.entries(d).map(([k,v])=>`${k}: ${valueOf(v)}`).join(' · '); };
  const fullDetailOf=(d)=>{ try{ return d&&typeof d==='object'? JSON.stringify(d,null,1) : ''; }catch(e){ return ''; } };

  return <div>
    <PageHead title={t('audit.title')} subtitle={t('audit.subtitle')}/>
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Input value={q} onChange={e=>setQ(e.target.value)} placeholder={t('audit.filterPlaceholder')} className="w-64"/>
        <Select value={actionF} onChange={setActionF} className="w-48" options={[{value:'all',label:t('audit.allActions')},...actions.map(a=>({value:a,label:a}))]}/>
        <Input type="date" value={dateF} onChange={e=>setDateF(e.target.value)} className="w-40"/>
        {(dateF||q||actionF!=='all')&&<button onClick={()=>{setDateF('');setQ('');setActionF('all');}} className="text-xs text-slate-400 hover:text-navy">{t('common.clear')}</button>}
      </div>
      {page===null? <Loader/>
      : rows.length===0? <div className="text-sm text-slate-400 py-6 text-center">{total===0&&!q&&!dateF&&actionF==='all'?t('audit.noEntries'):t('audit.noMatch')}</div>
      : <>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500 text-left">
            <th className="px-3 py-2 font-medium whitespace-nowrap">{t('audit.when')}</th>
            <th className="px-3 py-2 font-medium">{t('audit.actor')}</th>
            <th className="px-3 py-2 font-medium">{t('audit.action')}</th>
            <th className="px-3 py-2 font-medium">{t('audit.target')}</th>
            <th className="px-3 py-2 font-medium">{t('audit.details')}</th>
            <th className="px-3 py-2 font-medium">IP</th>
          </tr></thead>
          <tbody>{rows.map(e=><tr key={e.id} className="border-b border-slate-50 align-top">
            <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{fmtDT(e.createdAt)}</td>
            <td className="px-3 py-2 text-navy truncate max-w-[180px]" title={e.actorEmail||''}>{e.actorEmail||<span className="text-slate-400">—</span>}</td>
            <td className="px-3 py-2"><span className="text-[11px] font-medium bg-slate-100 text-navy px-1.5 py-0.5 rounded font-mono">{e.action}</span></td>
            <td className="px-3 py-2 text-slate-600 truncate max-w-[180px]" title={e.target||''}>{e.target||<span className="text-slate-400">—</span>}</td>
            <td className="px-3 py-2 text-xs text-slate-500 break-words max-w-sm" title={fullDetailOf(e.detail)}>{detailOf(e.detail)}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-400 whitespace-nowrap">{e.ip||'—'}</td>
          </tr>)}</tbody>
        </table></div>
        <div className="flex items-center justify-between gap-3 mt-3 text-xs text-slate-500">
          <span>{t('common.pageRange',{from,to,total})}</span>
          <div className="flex items-center gap-2">
            <Btn variant="ghost" size="sm" disabled={offset===0} onClick={()=>setOffset(o=>Math.max(0,o-PAGE_SIZE))}><Icon name="chevleft" className="w-4 h-4"/>{t('common.prev')}</Btn>
            <Btn variant="ghost" size="sm" disabled={offset+PAGE_SIZE>=total} onClick={()=>setOffset(o=>o+PAGE_SIZE)}>{t('common.next')}<Icon name="chevright" className="w-4 h-4"/></Btn>
          </div>
        </div>
      </>}
    </Card>
  </div>;
}

export { AuditPage };
