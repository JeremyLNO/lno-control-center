import React from 'react'
const { useState, useEffect, useCallback } = React;
import {
  fmtDT, fmtAgo, Icon, Card, SectionTitle, Btn, Select, KpiCard, PageHead, Denied, Loader,
  EmptyState, useApp, hasPerm, toast
} from '../ui'

/* ============================================================
   ANOMALY DETECTION
   ============================================================ */
// An alert says a threshold was crossed. An anomaly says a bot is BEHAVING differently than
// it used to — the kind of thing that otherwise only gets noticed weeks later, in a monthly
// review, after the money is gone.
//
// Every finding shows its evidence. A detector whose reasoning can't be checked gets ignored
// after the first false positive, so the numbers that triggered it are part of the finding
// rather than something to go and look up.

const SEV=[
  {key:'critical', cls:'bg-danger/10 text-danger border-danger/20', dot:'bg-danger'},
  {key:'warning',  cls:'bg-warn/10 text-amber-600 border-amber-200', dot:'bg-amber-500'},
  {key:'info',     cls:'bg-slate-100 text-slate-600 border-slate-200', dot:'bg-slate-400'},
];
const sevOf=(s)=>SEV.find(x=>x.key===s)||SEV[2];

// Scope is stored machine-readable ("bot:binance:BTCUSDT", "strategy:atalante", "portfolio")
// so detectors can dedupe on it. Only the display is humanised.
function scopeLabel(scope: string, t: any){
  const [kind,...rest]=String(scope).split(':');
  const tail=rest.join(':');
  if(kind==='portfolio') return t('anomaly.scope.portfolio');
  if(kind==='bot') return tail;
  if(kind==='strategy') return t('anomaly.scope.strategy',{name:tail});
  if(kind==='exchange') return t('anomaly.scope.exchange',{name:tail});
  return scope;
}

// The server stores each finding's sentence in English — it is the fallback, and what a
// future email or WhatsApp digest would send. The UI rebuilds it in the reader's language
// from the finding's code, variant and evidence, so an anomaly reads like the rest of the
// app. `variant` distinguishes wordings that differ in meaning, not just in numbers
// ("stopped trading" vs "trading twice as often"), so each gets its own translated sentence
// rather than a template with a word swapped in.
//
// translate() returns the key itself when a key is missing, which is how we detect a
// detector that has shipped without translations and fall back to the server's own text
// instead of printing a raw i18n key at the user.
function describe(a: any, t: any){
  const ev=a.evidence||{};
  const variant=ev.variant||'default';
  const pick=(kind: string, fallback: string)=>{
    const key=`anomaly.${kind}.${a.code}.${variant}`;
    const s=t(key,ev);
    return s===key ? fallback : s;
  };
  return {summary:pick('sum',a.summary), cause:pick('cause',a.cause)};
}

// `variant` is a rendering discriminator, not a measurement — showing it in the evidence
// grid would just be noise next to the numbers it selected a sentence for.
const HIDDEN_EVIDENCE=new Set(['variant']);

// Evidence values arrive as whatever the detector measured — numbers, strings, or a small
// list of missed targets. Rendered generically so adding a detector needs no UI change.
function EvidenceValue({k,v,t}: any){
  // The one structured case: expected-vs-actual pairs, which read as a sentence rather than
  // as a key=value blob.
  if(Array.isArray(v)) return <span className="text-navy text-right">{v.map((x,i)=>
    <span key={i} className="block">{x&&typeof x==='object'&&'metric' in x
      ? <>{t('playbook.'+x.metric)} <span className="tnum">{x.actual}</span> / <span className="tnum text-slate-500">{x.target}</span></>
      : String(x)}</span>)}</span>;
  if(typeof v==='number') return <span className="tnum text-navy">{v.toLocaleString('en-US')}</span>;
  return <span className="text-navy">{String(v)}</span>;
}

function AnomalyCard({a,t,canAck,onAck}: any){
  const s=sevOf(a.severity);
  const ev=Object.entries(a.evidence||{}).filter(([k])=>!HIDDEN_EVIDENCE.has(k));
  const {summary,cause}=describe(a,t);
  return <Card className={`p-4 border-l-4 ${a.resolvedAt?'opacity-60':''}`} style={{borderLeftColor:a.severity==='critical'?'#EF4444':a.severity==='warning'?'#F59E0B':'#94A3B8'}}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${s.cls}`}>{t('anomaly.sev.'+a.severity)}</span>
          <span className="text-[11px] font-mono text-slate-400">{t('anomaly.code.'+a.code)}</span>
          <span className="text-[11px] text-slate-400">·</span>
          <span className="text-xs font-medium text-navy">{scopeLabel(a.scope,t)}</span>
          {a.resolvedAt&&<span className="px-2 py-0.5 rounded-full text-[11px] bg-success/10 text-success">{t('anomaly.resolved')}</span>}
          {a.ackedAt&&!a.resolvedAt&&<span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-500">{t('anomaly.acked',{by:a.ackedBy})}</span>}
        </div>
        <div className="text-sm font-semibold text-navy mt-1.5">{summary}</div>
        <p className="text-sm text-slate-600 mt-1 max-w-3xl">{cause}</p>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[11px] text-slate-400">{t('anomaly.detected')} {fmtAgo(a.detectedAt)}</div>
        <div className="text-[11px] text-slate-400">{fmtDT(a.detectedAt)}</div>
        {canAck&&!a.ackedAt&&!a.resolvedAt&&
          <Btn variant="outline" size="sm" className="mt-2" onClick={()=>onAck(a.id)}><Icon name="check" className="w-3.5 h-3.5"/>{t('anomaly.ack')}</Btn>}
      </div>
    </div>
    {ev.length>0&&<div className="mt-3 pt-3 border-t border-slate-100">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1.5">{t('anomaly.evidence')}</div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
        {ev.map(([k,v]: any)=><div key={k} className="flex justify-between gap-3 text-xs">
          <span className="text-slate-500 shrink-0">{k}</span><EvidenceValue k={k} v={v} t={t}/>
        </div>)}
      </div>
    </div>}
  </Card>;
}

export default function AnomaliesPage(){
  const {api,user,t}=useApp();
  const [data,setData]=useState<any>(null);
  const [status,setStatus]=useState('open');
  const [severity,setSeverity]=useState('');
  const [busy,setBusy]=useState(false);
  const allowed=hasPerm(user,'view_trades');
  const isAdmin=user?.role==='admin';

  const load=useCallback(()=>{
    const q=['anomalies=1',`status=${status}`,severity?`severity=${severity}`:''].filter(Boolean).join('&');
    api('alerts?'+q).then(setData).catch(()=>setData({entries:[],total:0}));
  },[api,status,severity]);
  useEffect(()=>{ if(allowed) load(); },[allowed,load]);

  const runNow=async()=>{
    setBusy(true);
    try{ const r=await api('alerts',{method:'POST',body:{action:'detectAnomalies'}});
      toast.success(t('anomaly.ranNow',{n:r.created,r:r.resolved})); load(); }
    catch(e: any){ toast.error(e.message); }
    finally{ setBusy(false); }
  };
  const ack=async(id)=>{
    try{ await api('alerts',{method:'POST',body:{action:'ackAnomaly',id}}); load(); }
    catch(e: any){ toast.error(e.message); }
  };

  if(!allowed) return <Denied/>;
  if(!data) return <div className="py-16"><Loader/></div>;

  const entries=data.entries||[];
  const crit=entries.filter(a=>a.severity==='critical'&&!a.resolvedAt).length;
  const warn=entries.filter(a=>a.severity==='warning'&&!a.resolvedAt).length;

  return <div className="fadein">
    <PageHead title={t('anomaly.title')} subtitle={t('anomaly.subtitle')}
      actions={isAdmin&&<Btn onClick={runNow} disabled={busy}><Icon name="refresh" className="w-4 h-4"/>{t('anomaly.runNow')}</Btn>}/>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <KpiCard label={t('anomaly.critical')} value={<span className={crit?'text-danger':''}>{crit}</span>} icon="triangle" accent={crit?'#EF4444':undefined}/>
      <KpiCard label={t('anomaly.warnings')} value={<span className={warn?'text-amber-600':''}>{warn}</span>} icon="info"/>
      <KpiCard label={t('anomaly.shown')} value={entries.length} icon="list"/>
      <KpiCard label={t('anomaly.total')} value={data.total} icon="database"/>
    </div>

    <Card className="p-3 mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <Icon name="filter" className="w-4 h-4 text-slate-400"/>
        <Select value={status} onChange={setStatus} className="w-44"
          options={[{value:'open',label:t('anomaly.statusOpen')},{value:'resolved',label:t('anomaly.statusResolved')},{value:'all',label:t('anomaly.statusAll')}]}/>
        <Select value={severity} onChange={setSeverity} className="w-44"
          options={[{value:'',label:t('anomaly.allSeverities')},...SEV.map(s=>({value:s.key,label:t('anomaly.sev.'+s.key)}))]}/>
      </div>
    </Card>

    {entries.length===0
      ? <EmptyState icon="check" title={t(status==='open'?'anomaly.none':'anomaly.noneFiltered')} hint={t('anomaly.noneHint')}/>
      : <div className="grid gap-3 mb-4">
          {entries.map(a=><AnomalyCard key={a.id} a={a} t={t} canAck={isAdmin} onAck={ack}/>)}
        </div>}

    {data.undetectable&&<Card className="p-4">
      <SectionTitle>{t('anomaly.undetectable')}</SectionTitle>
      <p className="text-sm text-slate-500 mb-3">{t('anomaly.undetectableHint')}</p>
      <div className="grid sm:grid-cols-3 gap-2">
        {Object.entries(data.undetectable).map(([k,why]: any)=>
          <div key={k} className="flex items-start gap-2 text-sm p-2 rounded-lg bg-slate-50">
            <Icon name="info" className="w-4 h-4 text-slate-400 shrink-0 mt-0.5"/>
            <div><span className="font-medium text-navy">{t('anomaly.code.'+k)}</span>
              <span className="block text-xs text-slate-500">{why}</span></div>
          </div>)}
      </div>
    </Card>}
  </div>;
}
