import React from 'react'
const { useState, useEffect } = React;
import {
  api, toast, Icon, Card, SectionTitle, Btn, Select, Field, Input, useApp, PageHead, Denied, Loader,
  Confirm, hasPerm, fmtUSD, fmtDT
} from '../ui'

/* ============================================================
   MILESTONES — the desk's scoreboard
   ============================================================ */
// Two scopes, and the page never lets them blur: a MONTHLY milestone is measured within the
// current month and comes back every month; a GLOBAL one is measured over all history and is
// reached exactly once, ever. Everything else — progress bars, dates, the history — follows
// from that distinction.
//
// Reading needs view_milestones. Editing is admin-only, and the page simply doesn't render
// the controls otherwise (the server enforces it regardless).

const SCOPES = ['monthly', 'global'];
const METRICS = ['equity_gain', 'equity_pct', 'equity_level', 'position_pct'];

export default function MilestonesPage(){
  const {user,t}=useApp();
  const [data,setData]=useState<any>(null);
  const [tab,setTab]=useState('monthly');
  const [edit,setEdit]=useState<any>(null);   // milestone being edited, or {} for a new one
  const [del,setDel]=useState<any>(null);
  const [busy,setBusy]=useState(false);

  const load=()=>api('alerts?milestones=1').then(setData).catch(e=>toast.error(e.message));
  useEffect(()=>{ if(hasPerm(user,'view_milestones')) load(); },[]);

  if(!hasPerm(user,'view_milestones')) return <Denied/>;
  if(!data) return <Loader/>;

  const canManage=data.canManage;
  const items=data.milestones.filter((m: any)=>m.scope===tab);
  const reached=items.filter((m: any)=>m.achievedAt).length;

  async function save(){
    setBusy(true);
    try{
      const action=edit.id?'milestoneUpdate':'milestoneCreate';
      const r=await api('alerts',{method:'POST',body:{action,id:edit.id,scope:edit.scope,metric:edit.metric,threshold:Number(edit.threshold),active:edit.active}});
      setData((d: any)=>({...d,milestones:r.milestones})); setEdit(null);
    }catch(e: any){ toast.error(e.message); } finally{ setBusy(false); }
  }
  async function doDelete(){
    setBusy(true);
    try{
      const r=await api('alerts',{method:'POST',body:{action:'milestoneDelete',id:del.id}});
      setData((d: any)=>({...d,milestones:r.milestones})); setDel(null);
    }catch(e: any){ toast.error(e.message); } finally{ setBusy(false); }
  }
  async function evaluate(){
    setBusy(true);
    try{ const r=await api('alerts',{method:'POST',body:{action:'milestoneEvaluate'}});
      setData((d: any)=>({...d,milestones:r.milestones}));
      toast.success(r.fresh?t('ms.evaluatedNew',{n:r.fresh}):t('ms.evaluatedNone'));
    }catch(e: any){ toast.error(e.message); } finally{ setBusy(false); }
  }

  return <div className="fadein">
    <PageHead title={t('ms.title')} subtitle={t('ms.subtitle')}
      actions={canManage&&<div className="flex gap-2">
        <Btn variant="outline" onClick={evaluate} disabled={busy}>{t('ms.evaluate')}</Btn>
        <Btn onClick={()=>setEdit({scope:tab,metric:'equity_gain',threshold:'',active:true})}>{t('ms.add')}</Btn>
      </div>}/>

    <div className="flex gap-2 mb-4">
      {SCOPES.map(s=><button key={s} onClick={()=>setTab(s)}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${tab===s?'bg-navy text-white':'bg-white text-slate-500 border border-slate-200 hover:text-navy'}`}>
        {t('ms.scope.'+s)}
      </button>)}
      <div className="flex-1"/>
      <div className="text-sm text-slate-500 self-center">{t('ms.reachedCount',{n:reached,total:items.length})}</div>
    </div>

    {/* The distinction, said once, where it matters — not buried in a tooltip. */}
    <Card className="p-3 mb-4 text-sm text-slate-500 flex items-start gap-2">
      <Icon name="info" className="w-4 h-4 shrink-0 mt-0.5 text-slate-400"/>
      <span>{t(tab==='monthly'?'ms.monthlyHint':'ms.globalHint')}</span>
    </Card>

    <Card className="p-0 overflow-hidden">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-200 text-slate-500 bg-slate-50/60">
          <th className="px-4 py-2.5 text-left font-medium">{t('ms.milestone')}</th>
          <th className="px-4 py-2.5 text-left font-medium">{t('ms.progress')}</th>
          <th className="px-4 py-2.5 text-left font-medium">{t('ms.reachedOn')}</th>
          {canManage&&<th className="px-4 py-2.5"/>}
        </tr></thead>
        <tbody>
          {items.map((m: any)=>{
            const cur=data.measured?.[m.scope]?.[m.metric] ?? 0;
            const pct=m.threshold>0?Math.min(100,Math.max(0,(cur/m.threshold)*100)):0;
            return <tr key={m.id} className={`border-b border-slate-100 last:border-0 ${m.achievedAt?'bg-success/[.04]':''}`}>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  {m.achievedAt
                    ? <span className="w-5 h-5 rounded-full bg-success/15 text-success grid place-items-center shrink-0"><Icon name="check" className="w-3.5 h-3.5"/></span>
                    : <span className="w-5 h-5 rounded-full border border-slate-200 shrink-0"/>}
                  <span className={m.achievedAt?'text-navy font-medium':'text-navy'}>{label(m,t)}</span>
                  {!m.active&&<span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{t('ms.inactive')}</span>}
                </div>
              </td>
              <td className="px-4 py-2.5 w-64">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full rounded-full ${m.achievedAt?'bg-success':'bg-gold'}`} style={{width:pct+'%'}}/>
                  </div>
                  <span className="text-xs text-slate-400 tabular-nums w-12 text-right">{Math.round(pct)}%</span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{value(m.metric,cur,t)}</div>
              </td>
              <td className="px-4 py-2.5 text-slate-500">
                {m.achievedAt? <span className="text-navy">{fmtDT(m.achievedAt)}</span> : <span className="text-slate-300">—</span>}
              </td>
              {canManage&&<td className="px-4 py-2.5 text-right whitespace-nowrap">
                <button onClick={()=>setEdit({...m,threshold:String(m.threshold)})} className="text-slate-400 hover:text-navy p-1"><Icon name="pencil" className="w-4 h-4"/></button>
                <button onClick={()=>setDel(m)} className="text-slate-400 hover:text-danger p-1"><Icon name="trash" className="w-4 h-4"/></button>
              </td>}
            </tr>;
          })}
          {!items.length&&<tr><td colSpan={canManage?4:3} className="px-4 py-8 text-center text-slate-400">{t('ms.empty')}</td></tr>}
        </tbody>
      </table>
    </Card>

    {/* A monthly milestone reached in March disappears from the table in April. The history
        is where it survives — otherwise the record would only ever show the current month. */}
    {!!data.history?.length&&<Card className="p-4 mt-4">
      <SectionTitle>{t('ms.history')}</SectionTitle>
      <div className="space-y-1.5">
        {data.history.map((h: any,i: number)=><div key={i} className="flex items-center gap-3 text-sm">
          <Icon name="check" className="w-4 h-4 text-success shrink-0"/>
          <span className="text-navy">{label(h,t)}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{h.period==='global'?t('ms.scope.global'):h.period}</span>
          <div className="flex-1"/>
          <span className="text-slate-400 text-xs">{fmtDT(h.achievedAt)}</span>
        </div>)}
      </div>
    </Card>}

    {edit&&<EditModal value={edit} onChange={setEdit} onSave={save} onClose={()=>setEdit(null)} busy={busy} t={t}/>}
    <Confirm open={!!del} title={t('ms.deleteTitle')} message={del?t('ms.deleteBody',{label:label(del,t)}):''}
      confirmLabel={t('common.delete')} onConfirm={doDelete} onCancel={()=>setDel(null)}/>
  </div>;
}

// One label per (metric, threshold), localized. The server keeps its own English version for
// the audit trail and the emails; this is the display, and neither invents a rule the other
// doesn't have.
function label(m: any,t: any){
  const n=Number(m.threshold);
  const num=n.toLocaleString('en-US').replace(/,/g,' ');
  switch(m.metric){
    case 'equity_gain':  return t('ms.label.gain',{v:num});
    case 'equity_pct':   return t('ms.label.pct',{v:n});
    case 'equity_level': return t('ms.label.level',{v:num});
    case 'position_pct': return t('ms.label.position',{v:n});
    default:             return m.metric+' '+num;
  }
}
function value(metric: string,v: number,t: any){
  const r=Math.round(v*10)/10;
  return metric.endsWith('_pct')? t('ms.current',{v:r+'%'}) : t('ms.current',{v:fmtUSD(v)});
}

function EditModal({value,onChange,onSave,onClose,busy,t}: any){
  const set=(p: any)=>onChange({...value,...p});
  return <div className="fixed inset-0 z-50 grid place-items-center bg-navy/40 p-4" onClick={onClose}>
    <Card className="p-5 w-full max-w-md" onClick={(e: any)=>e.stopPropagation()}>
      <SectionTitle>{value.id?t('ms.editTitle'):t('ms.addTitle')}</SectionTitle>
      <div className="space-y-3 mt-2">
        <Field label={t('ms.scopeLabel')} hint={t(value.scope==='monthly'?'ms.monthlyHint':'ms.globalHint')}>
          <Select value={value.scope} onChange={(e: any)=>set({scope:e.target.value})}
            options={SCOPES.map(s=>({value:s,label:t('ms.scope.'+s)}))}/>
        </Field>
        <Field label={t('ms.metric')}>
          <Select value={value.metric} onChange={(e: any)=>set({metric:e.target.value})}
            options={METRICS.map(m=>({value:m,label:t('ms.metric.'+m)}))}/>
        </Field>
        <Field label={t('ms.threshold')} hint={value.metric?.endsWith('_pct')?'%':'USDT'}>
          <Input type="number" value={value.threshold} onChange={(e: any)=>set({threshold:e.target.value})} autoFocus/>
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Btn variant="outline" onClick={onClose}>{t('common.cancel')}</Btn>
        <Btn onClick={onSave} disabled={busy||!String(value.threshold).trim()}>{busy?t('common.saving'):t('common.save')}</Btn>
      </div>
    </Card>
  </div>;
}

/* ============================================================
   DASHBOARD CARD
   ============================================================ */
// What the dashboard shows: what was just reached, and what is closest to being reached.
// Nothing else earns the space — a full scoreboard belongs on the Milestones page.
export function MilestonesCard(){
  const {user,navigate,t}=useApp();
  const [data,setData]=useState<any>(null);
  useEffect(()=>{ if(hasPerm(user,'view_milestones')) api('alerts?milestones=1').then(setData).catch(()=>{}); },[]);
  if(!hasPerm(user,'view_milestones')||!data) return null;

  const done=data.milestones.filter((m: any)=>m.achievedAt)
    .sort((a: any,b: any)=>new Date(b.achievedAt).getTime()-new Date(a.achievedAt).getTime());
  const latest=done[0];
  // "Closest" = highest completion ratio among the unreached, which is the one worth chasing.
  const next=data.milestones.filter((m: any)=>!m.achievedAt&&m.active)
    .map((m: any)=>({m,pct:m.threshold>0?((data.measured?.[m.scope]?.[m.metric]??0)/m.threshold)*100:0}))
    .sort((a: any,b: any)=>b.pct-a.pct)[0];
  if(!latest&&!next) return null;

  return <Card className="p-4">
    <SectionTitle right={<button onClick={()=>navigate('/milestones')} className="text-xs text-gold hover:underline">{t('ms.seeAll')} →</button>}>
      {t('ms.title')}
    </SectionTitle>
    {latest&&<div className="flex items-center gap-3 p-3 rounded-xl bg-gold/[.07] border border-gold/25">
      <span className="text-2xl leading-none">🏆</span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-navy truncate">{label(latest,t)}</div>
        <div className="text-xs text-slate-500">{t('ms.reachedOnShort',{date:fmtDT(latest.achievedAt)})}</div>
      </div>
    </div>}
    {next&&<div className={latest?'mt-3':''}>
      <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
        <span>{t('ms.next')}</span><span className="tabular-nums">{Math.round(next.pct)}%</span>
      </div>
      <div className="text-sm text-navy mb-1.5">{label(next.m,t)}</div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full bg-gold" style={{width:Math.min(100,next.pct)+'%'}}/>
      </div>
    </div>}
  </Card>;
}
