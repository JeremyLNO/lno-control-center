import React from 'react'
const { useState, useEffect, useMemo, useCallback } = React;
import {
  fmtSigned, fmtNum, fmtPctPlain, fmtDT, fmtDate, clsPnl, Icon, Card, SectionTitle, Btn, Badge,
  StatusPill, Select, Field, Input, Modal, KpiCard, PageHead, Denied, Loader, EmptyState,
  useApp, hasPerm, toast
} from '../ui'

/* ============================================================
   STRATEGY PLAYBOOK
   ============================================================ */
// The declared side of each bot: what it is meant to do, within what limits, and what it is
// expected to deliver — none of which the exchange can tell us. Paired with the realised KPIs
// from api/_lib/analytics.js so the declaration and the outcome sit side by side.
//
// Versions are the point: a strategy edited in place would silently rewrite the meaning of
// every trade it ever produced. Each trade is attributed to the version live when it OPENED.

// Comma-separated list <-> array. Used for allowed assets and timeframes, which operators
// think of as a short list, not as JSON.
const toList=(s: string)=>String(s||'').split(',').map(x=>x.trim()).filter(Boolean);
const fromList=(a: any)=>Array.isArray(a)?a.join(', '):'';

// Expectation targets the operator can declare. Kept aligned with KPI_RULES in
// api/_lib/strategies.js — the server decides met/missed, this only collects the numbers.
const EXPECT_FIELDS=[
  {key:'minProfitFactor', label:'playbook.minProfitFactor', step:'0.1'},
  {key:'minWinRate',      label:'playbook.minWinRate',      step:'1', suffix:'%'},
  {key:'minExpectancy',   label:'playbook.minExpectancy',   step:'1'},
  {key:'maxDrawdown',     label:'playbook.maxDrawdown',     step:'10'},
];
const RISK_FIELDS=[
  {key:'maxLeverage',  label:'playbook.maxLeverage',  step:'1'},
  {key:'maxNotional',  label:'playbook.maxNotional',  step:'100'},
  {key:'maxDailyLoss', label:'playbook.maxDailyLoss', step:'50'},
  {key:'maxOpenPositions', label:'playbook.maxOpenPositions', step:'1'},
];

function ExpectationPill({status}: any){
  const {t}=useApp();
  const map={met:'bg-success/10 text-success', missed:'bg-danger/10 text-danger', unknown:'bg-slate-200 text-slate-500'};
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${map[status]||map.unknown}`}>{t('playbook.expect.'+status)}</span>;
}

// A declared block of prose (objective, rules, disable conditions). Renders the "not
// documented yet" state explicitly — an empty rules box is a real gap in a playbook, not
// something to hide behind blank space.
function Prose({title,text,t}: any){
  return <div>
    <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">{title}</div>
    {text ? <p className="text-sm text-navy whitespace-pre-wrap">{text}</p>
          : <p className="text-sm text-slate-400 italic">{t('playbook.undocumented')}</p>}
  </div>;
}

export default function PlaybookPage(){
  const {api,user,t}=useApp();
  const [list,setList]=useState<any[]|null>(null);
  const [selId,setSelId]=useState<string|null>(null);
  const [editing,setEditing]=useState<any>(null);
  const [deploying,setDeploying]=useState<any>(null);
  const allowed=hasPerm(user,'view_trades');
  const canEdit=hasPerm(user,'manage_strategies');

  const load=useCallback(()=>{
    api('bots?playbook=1').then(r=>setList(r.strategies||[])).catch(()=>setList([]));
  },[api]);
  useEffect(()=>{ if(allowed) load(); },[allowed,load]);

  const sel=useMemo(()=>{
    if(!list||!list.length) return null;
    return list.find(s=>s.id===selId)||list[0];
  },[list,selId]);

  if(!allowed) return <Denied/>;
  if(list===null) return <div className="py-16"><Loader/></div>;

  return <div className="fadein">
    <PageHead title={t('playbook.title')} subtitle={t('playbook.subtitle')}
      actions={canEdit&&<Btn onClick={()=>setEditing({__new:true,name:'',allowedSymbols:[],allowedTimeframes:[],riskLimits:{},expectedKpis:{},params:{}})}>
        <Icon name="plus" className="w-4 h-4"/>{t('playbook.new')}</Btn>}/>

    {list.length===0
      ? <EmptyState icon="shield" title={t('playbook.empty')} hint={t('playbook.emptyHint')}
          action={canEdit&&<Btn onClick={()=>setEditing({__new:true,name:'',allowedSymbols:[],allowedTimeframes:[],riskLimits:{},expectedKpis:{},params:{}})}>{t('playbook.new')}</Btn>}/>
      : <div className="grid lg:grid-cols-[260px_1fr] gap-4 items-start">
          {/* Strategy picker. A plain list, not a dropdown: the count is small and seeing all
              of them at once is part of reading a playbook. */}
          <Card className="p-2">
            {list.map(s=><button key={s.id} onClick={()=>setSelId(s.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg transition ${sel?.id===s.id?'bg-navy text-white':'hover:bg-slate-50 text-navy'}`}>
              <div className="text-sm font-medium truncate">{s.name}</div>
              <div className={`text-[11px] truncate ${sel?.id===s.id?'text-white/60':'text-slate-400'}`}>
                {s.botId||t('playbook.noBot')} · {t('playbook.nVersions',{n:s.versions.length})}
              </div>
            </button>)}
          </Card>

          {sel&&<div className="grid gap-4">
            <StrategyHeader s={sel} t={t} canEdit={canEdit} onEdit={()=>setEditing(sel)} onDeploy={()=>setDeploying(sel)}/>
            <ExpectationsCard s={sel} t={t}/>
            <DeclarationCard s={sel} t={t}/>
            <VersionsCard s={sel} t={t}/>
          </div>}
        </div>}

    {editing&&<StrategyModal init={editing} t={t} api={api} onClose={()=>setEditing(null)}
      onSaved={(id)=>{ setEditing(null); setSelId(id); load(); }}/>}
    {deploying&&<DeployModal strategy={deploying} t={t} api={api} onClose={()=>setDeploying(null)}
      onSaved={()=>{ setDeploying(null); load(); }}/>}
  </div>;
}

function StrategyHeader({s,t,canEdit,onEdit,onDeploy}: any){
  const live=s.versions.find(v=>!v.retiredAt);
  return <Card className="p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-navy">{s.name}</h2>
          <StatusPill status={s.status}/>
        </div>
        <div className="text-sm text-slate-500 mt-0.5">
          {s.botId ? <span className="font-mono text-xs">{s.botId}</span> : <span className="italic">{t('playbook.noBot')}</span>}
          {live && <> · <span className="text-navy font-medium">{t('playbook.liveVersion',{v:live.label})}</span> <span className="text-slate-400">({fmtDate(live.deployedAt)})</span></>}
        </div>
      </div>
      {canEdit&&<div className="flex items-center gap-2">
        <Btn variant="outline" size="sm" onClick={onEdit}><Icon name="pencil" className="w-3.5 h-3.5"/>{t('common.edit')}</Btn>
        <Btn size="sm" onClick={onDeploy}><Icon name="zap" className="w-3.5 h-3.5"/>{t('playbook.deploy')}</Btn>
      </div>}
    </div>
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-4">
      <KpiCard label={t('kpi.trades')} value={s.overall.trades}/>
      <KpiCard label={t('kpi.netPnl')} value={<span className={clsPnl(s.overall.netPnl)}>{fmtSigned(s.overall.netPnl)}</span>}/>
      <KpiCard label={t('kpi.winRate')} value={s.overall.winRate==null?'—':fmtPctPlain(s.overall.winRate)}/>
      <KpiCard label={t('kpi.profitFactor')} value={s.overall.profitFactor==null?'n/a':fmtNum(s.overall.profitFactor,2)}/>
      <KpiCard label={t('kpi.maxDrawdown')} value={<span className="text-danger">{fmtSigned(s.overall.maxDrawdown)}</span>}/>
    </div>
  </Card>;
}

// Declared target vs realised value. This is the whole point of writing expected KPIs down:
// "profit factor 0.9" is only actionable next to the 1.4 the strategy was signed off on.
function ExpectationsCard({s,t}: any){
  if(!s.expectations||!s.expectations.length) return <Card className="p-4">
    <SectionTitle>{t('playbook.expectations')}</SectionTitle>
    <p className="text-sm text-slate-400 italic">{t('playbook.noExpectations')}</p>
  </Card>;
  // A drawdown limit is declared as a magnitude ("no worse than 900") but measured as a
  // negative number. Rendering the target as "+900" next to an actual of "-611" makes the
  // comparison read backwards, so the ceiling is shown on the same sign as what it bounds.
  const fmtFor=(e,v)=>{ if(v==null) return '—';
    if(e.kpi==='winRate') return fmtPctPlain(v);
    if(e.kpi==='profitFactor') return fmtNum(v,2);
    if(e.key==='maxDrawdown') return fmtSigned(-Math.abs(v));
    return fmtSigned(v); };
  return <Card className="p-4">
    <SectionTitle>{t('playbook.expectations')}</SectionTitle>
    <table className="w-full text-sm">
      <thead><tr className="border-b border-slate-200 text-slate-500">
        <th className="px-3 py-2 text-left font-medium">{t('playbook.metric')}</th>
        <th className="px-3 py-2 text-right font-medium">{t('playbook.target')}</th>
        <th className="px-3 py-2 text-right font-medium">{t('playbook.actual')}</th>
        <th className="px-3 py-2 text-right font-medium">{t('playbook.verdict')}</th>
      </tr></thead>
      <tbody>
        {s.expectations.map(e=><tr key={e.key} className="border-b border-slate-100 last:border-0">
          <td className="px-3 py-2 text-navy">{t('playbook.'+e.key)}</td>
          <td className="px-3 py-2 text-right tnum text-slate-500">{fmtFor(e,e.target)}</td>
          <td className={`px-3 py-2 text-right tnum font-medium ${e.status==='missed'?'text-danger':'text-navy'}`}>{fmtFor(e,e.value)}</td>
          <td className="px-3 py-2 text-right"><ExpectationPill status={e.status}/></td>
        </tr>)}
      </tbody>
    </table>
  </Card>;
}

function DeclarationCard({s,t}: any){
  const chips=(arr,empty)=> arr&&arr.length
    ? <div className="flex flex-wrap gap-1">{arr.map(x=><span key={x} className="px-2 py-0.5 rounded-md bg-slate-100 text-xs font-mono text-navy">{x}</span>)}</div>
    : <span className="text-sm text-slate-400 italic">{empty}</span>;
  const limits=Object.entries(s.riskLimits||{}).filter(([,v])=>v!==''&&v!=null);
  const params=Object.entries(s.params||{});
  return <Card className="p-4 grid md:grid-cols-2 gap-5">
    <Prose title={t('playbook.objective')} text={s.objective} t={t}/>
    <Prose title={t('playbook.disableConditions')} text={s.disableConditions} t={t}/>
    <Prose title={t('playbook.entryRules')} text={s.entryRules} t={t}/>
    <Prose title={t('playbook.exitRules')} text={s.exitRules} t={t}/>
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">{t('playbook.allowedSymbols')}</div>
      {chips(s.allowedSymbols,t('playbook.anySymbol'))}
    </div>
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">{t('playbook.allowedTimeframes')}</div>
      {chips(s.allowedTimeframes,t('playbook.anyTimeframe'))}
    </div>
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">{t('playbook.riskLimits')}</div>
      {limits.length? <div className="grid gap-1">{limits.map(([k,v]: any)=>
        <div key={k} className="flex justify-between text-sm"><span className="text-slate-500">{t('playbook.'+k)}</span><span className="tnum text-navy font-medium">{String(v)}</span></div>)}</div>
        : <span className="text-sm text-slate-400 italic">{t('playbook.noLimits')}</span>}
    </div>
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">{t('playbook.params')}</div>
      {params.length? <div className="grid gap-1">{params.map(([k,v]: any)=>
        <div key={k} className="flex justify-between text-sm gap-3"><span className="text-slate-500 font-mono text-xs truncate">{k}</span><span className="tnum text-navy">{String(v)}</span></div>)}</div>
        : <span className="text-sm text-slate-400 italic">{t('playbook.noParams')}</span>}
    </div>
  </Card>;
}

// Version timeline, newest first, each with the result of the trades it actually produced.
// This is what makes "did that change help?" answerable.
function VersionsCard({s,t}: any){
  return <Card className="p-4">
    <SectionTitle right={<span className="text-xs text-slate-400">{t('playbook.versionsHint')}</span>}>
      {t('playbook.versions')}
    </SectionTitle>
    {s.versions.length===0
      ? <p className="text-sm text-slate-400 italic">{t('playbook.noVersions')}</p>
      : <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 text-slate-500">
            <th className="px-3 py-2 text-left font-medium">{t('playbook.version')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('playbook.period')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('playbook.changes')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('kpi.trades')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('kpi.netPnl')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('kpi.winRate')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('kpi.profitFactor')}</th>
          </tr></thead>
          <tbody>
            {s.versions.map(v=><tr key={v.id} className="border-b border-slate-100 last:border-0 align-top">
              <td className="px-3 py-2">
                <span className="font-medium text-navy">{v.label}</span>
                {!v.retiredAt&&<Badge className="ml-2" color="#10B981" dot>{t('playbook.live')}</Badge>}
              </td>
              <td className="px-3 py-2 text-slate-500 whitespace-nowrap text-xs">
                {fmtDT(v.deployedAt)}<br/>{v.retiredAt? '→ '+fmtDT(v.retiredAt) : '→ '+t('playbook.now')}
              </td>
              <td className="px-3 py-2 text-slate-600 max-w-xs">{v.changes||<span className="text-slate-300">—</span>}</td>
              <td className="px-3 py-2 text-right tnum text-slate-600">{v.actual.trades}</td>
              <td className={`px-3 py-2 text-right tnum font-medium ${clsPnl(v.actual.netPnl)}`}>{fmtSigned(v.actual.netPnl)}</td>
              <td className="px-3 py-2 text-right tnum text-slate-600">{v.actual.winRate==null?'—':fmtPctPlain(v.actual.winRate)}</td>
              <td className="px-3 py-2 text-right tnum text-slate-600">{v.actual.profitFactor==null?'n/a':fmtNum(v.actual.profitFactor,2)}</td>
            </tr>)}
          </tbody>
        </table>}
  </Card>;
}

function StrategyModal({init,t,api,onClose,onSaved}: any){
  const isNew=!!init.__new;
  const [f,setF]=useState<any>({
    name:init.name||'', botId:init.botId||'', objective:init.objective||'',
    entryRules:init.entryRules||'', exitRules:init.exitRules||'', disableConditions:init.disableConditions||'',
    allowedSymbols:fromList(init.allowedSymbols), allowedTimeframes:fromList(init.allowedTimeframes),
    status:init.status||'active',
    riskLimits:{...(init.riskLimits||{})}, expectedKpis:{...(init.expectedKpis||{})},
  });
  const [busy,setBusy]=useState(false);
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  const setNested=(grp,k,v)=>setF(p=>({...p,[grp]:{...p[grp],[k]:v===''?undefined:Number(v)}}));

  const save=async()=>{
    if(!f.name.trim()){ toast.error(t('playbook.nameRequired')); return; }
    setBusy(true);
    try{
      const body={ ...f, allowedSymbols:toList(f.allowedSymbols), allowedTimeframes:toList(f.allowedTimeframes),
        botId:f.botId||null };
      const r=isNew ? await api('bots',{method:'POST',body:{action:'createStrategy',...body}})
                    : await api('bots',{method:'POST',body:{action:'updateStrategy',id:init.id,...body}});
      toast.success(t(isNew?'playbook.created':'playbook.updated'));
      onSaved(r.strategy.id);
    }catch(e: any){ toast.error(e.message); }
    finally{ setBusy(false); }
  };

  return <Modal open wide onClose={onClose} title={t(isNew?'playbook.new':'playbook.editTitle')}>
    <div className="p-5 grid gap-4 max-h-[70vh] overflow-y-auto">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={t('playbook.name')}><Input value={f.name} onChange={e=>set('name',e.target.value)}/></Field>
        <Field label={t('playbook.bot')} hint={t('playbook.botHint')}>
          <Input value={f.botId} onChange={e=>set('botId',e.target.value)} placeholder="binance:BTCUSDT"/>
        </Field>
      </div>
      <Field label={t('playbook.objective')}>
        <textarea rows={2} value={f.objective} onChange={e=>set('objective',e.target.value)}
          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-gold/40"/>
      </Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={t('playbook.entryRules')}>
          <textarea rows={4} value={f.entryRules} onChange={e=>set('entryRules',e.target.value)}
            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-gold/40"/>
        </Field>
        <Field label={t('playbook.exitRules')}>
          <textarea rows={4} value={f.exitRules} onChange={e=>set('exitRules',e.target.value)}
            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-gold/40"/>
        </Field>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={t('playbook.allowedSymbols')} hint={t('playbook.commaSeparated')}>
          <Input value={f.allowedSymbols} onChange={e=>set('allowedSymbols',e.target.value)} placeholder="BTCUSDT, ETHUSDT"/>
        </Field>
        <Field label={t('playbook.allowedTimeframes')} hint={t('playbook.commaSeparated')}>
          <Input value={f.allowedTimeframes} onChange={e=>set('allowedTimeframes',e.target.value)} placeholder="15m, 1h"/>
        </Field>
      </div>
      <Field label={t('playbook.disableConditions')} hint={t('playbook.disableHint')}>
        <textarea rows={2} value={f.disableConditions} onChange={e=>set('disableConditions',e.target.value)}
          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-gold/40"/>
      </Field>
      <div>
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{t('playbook.riskLimits')}</div>
        <div className="grid sm:grid-cols-4 gap-3">
          {RISK_FIELDS.map(rf=><Field key={rf.key} label={t(rf.label)}>
            <Input type="number" step={rf.step} value={f.riskLimits[rf.key]??''} onChange={e=>setNested('riskLimits',rf.key,e.target.value)}/>
          </Field>)}
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{t('playbook.expectations')}</div>
        <div className="grid sm:grid-cols-4 gap-3">
          {EXPECT_FIELDS.map(ef=><Field key={ef.key} label={t(ef.label)}>
            <Input type="number" step={ef.step} value={f.expectedKpis[ef.key]??''} onChange={e=>setNested('expectedKpis',ef.key,e.target.value)}/>
          </Field>)}
        </div>
      </div>
      <Field label={t('playbook.status')}>
        <Select value={f.status} onChange={v=>set('status',v)} className="w-48"
          options={[{value:'active',label:t('status.active')},{value:'paused',label:t('status.paused')},{value:'inactive',label:t('status.inactive')}]}/>
      </Field>
    </div>
    <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
      <Btn variant="ghost" onClick={onClose}>{t('common.cancel')}</Btn>
      <Btn onClick={save} disabled={busy}>{busy?t('common.save'):t('common.save')}</Btn>
    </div>
  </Modal>;
}

function DeployModal({strategy,t,api,onClose,onSaved}: any){
  const [label,setLabel]=useState('');
  const [changes,setChanges]=useState('');
  const [at,setAt]=useState('');
  const [busy,setBusy]=useState(false);
  const save=async()=>{
    if(!label.trim()){ toast.error(t('playbook.labelRequired')); return; }
    setBusy(true);
    try{
      await api('bots',{method:'POST',body:{action:'deployVersion',strategyId:strategy.id,label,changes,at:at||undefined}});
      toast.success(t('playbook.deployed'));
      onSaved();
    }catch(e: any){ toast.error(e.message); }
    finally{ setBusy(false); }
  };
  return <Modal open onClose={onClose} title={t('playbook.deployTitle',{name:strategy.name})}>
    <div className="p-5 grid gap-3">
      <Field label={t('playbook.versionLabel')}><Input value={label} onChange={e=>setLabel(e.target.value)} placeholder="v2.1"/></Field>
      <Field label={t('playbook.changes')}>
        <textarea rows={3} value={changes} onChange={e=>setChanges(e.target.value)}
          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-gold/40"/>
      </Field>
      {/* Backdating exists because a deployment is often recorded after the fact. Saving
          re-attributes historical trades to the corrected timeline. */}
      <Field label={t('playbook.deployedAt')} hint={t('playbook.deployedAtHint')}>
        <Input type="datetime-local" value={at} onChange={e=>setAt(e.target.value)}/>
      </Field>
    </div>
    <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
      <Btn variant="ghost" onClick={onClose}>{t('common.cancel')}</Btn>
      <Btn onClick={save} disabled={busy}>{busy?t('common.save'):t('playbook.deploy')}</Btn>
    </div>
  </Modal>;
}
