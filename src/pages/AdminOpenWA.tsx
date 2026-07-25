import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  WA_MSG_TYPES, WA_ROLE_COLS, fmtDT, api, toast, Icon, Card, SectionTitle, Btn, Toggle, Select, Field,
  Input, useApp, Login, PageHead, Denied, Loader, hasPerm
} from '../ui'

/* ============================================================
   ADMIN — WHATSAPP
   ============================================================ */
function AdminOpenWA(){
  const {user,funds,navigate,t}=useApp();
  const [cfg,setCfg]=useState(null);
  const [enabled,setEnabled]=useState(false); const [matrix,setMatrix]=useState({}); const [apiKey,setApiKey]=useState('');
  const [ddPct,setDdPct]=useState(10); const [pnlThr,setPnlThr]=useState(-5000); const [dailyReport,setDailyReport]=useState(true);
  const [rules,setRules]=useState([]);
  const [saved,setSaved]=useState(false); const [busy,setBusy]=useState(false); const [test,setTest]=useState(null); const [report,setReport]=useState(null);
  const LOG_PAGE_SIZE=50;
  const [log,setLog]=useState(null); const [logTotal,setLogTotal]=useState(0);
  const [logQ,setLogQ]=useState(''); const [logStatus,setLogStatus]=useState('all'); const [logOffset,setLogOffset]=useState(0);
  const loadLog=()=>{
    const qs=new URLSearchParams({log:'1',limit:String(LOG_PAGE_SIZE),offset:String(logOffset)});
    if(logStatus!=='all') qs.set('status',logStatus);
    if(logQ.trim()) qs.set('q',logQ.trim());
    return api('openwa?'+qs.toString()).then(r=>{ setLog(r.log||[]); setLogTotal(r.total||0); }).catch(()=>{ setLog([]); setLogTotal(0); });
  };
  useEffect(()=>{ if(!hasPerm(user,'manage_whatsapp'))return; api('openwa').then(r=>{ const c=r.config; setCfg(c); setEnabled(c.enabled); setMatrix(c.notifMatrix||{}); setDdPct(c.drawdownPct??10); setPnlThr(c.pnlDayThreshold??-5000); setDailyReport(c.dailyReport??true); setRules(c.alertRules||[]); }).catch(()=>{}); },[]);
  useEffect(()=>{ setLogOffset(0); },[logQ,logStatus]);
  useEffect(()=>{ if(!hasPerm(user,'manage_whatsapp'))return; loadLog(); },[logQ,logStatus,logOffset]);
  if(!hasPerm(user,'manage_whatsapp')) return <Denied/>;
  const scopeOpts=[{value:'portfolio',label:t('wa.portfolio')},...funds.map(f=>({value:'fund:'+f.id,label:t('wa.fundScopeLabel',{name:f.name})}))];
  const metricOpts=[{value:'drawdown',label:t('wa.metricDrawdown')},{value:'pnlDay',label:t('wa.metricPnlDay')}];
  const logFrom=logTotal===0?0:logOffset+1; const logTo=Math.min(logOffset+LOG_PAGE_SIZE,logTotal);
  const updateRule=(i,patch)=>setRules(rs=>rs.map((r,j)=>j===i?{...r,...patch}:r));
  const addRule=()=>setRules(rs=>[...rs,{id:'r'+Date.now(),scope:'portfolio',metric:'drawdown',value:10,enabled:true}]);
  const toggleMatrix=(type,role)=>setMatrix(m=>{ const cur=new Set(m[type]||[]); cur.has(role)?cur.delete(role):cur.add(role); return {...m,[type]:[...cur]}; });
  async function save(){ setBusy(true); try{ const body: any={enabled,drawdownPct:Number(ddPct),pnlDayThreshold:Number(pnlThr),dailyReport,alertRules:rules.map(r=>({...r,value:Number(r.value)})),notifMatrix:matrix}; if(apiKey.trim())body.apiKey=apiKey.trim(); const r=await api('openwa',{method:'PUT',body}); setCfg(r.config); setMatrix(r.config.notifMatrix||{}); setApiKey(''); setSaved(true); setTimeout(()=>setSaved(false),1800); }catch(e){ toast.error(e.message); } finally{ setBusy(false); } }
  async function sendTest(){ setTest({state:'sending'}); try{ const r=await api('openwa',{method:'POST',body:{action:'test'}}); setTest({state:r.ok?'ok':'err', msg:r.ok?t('wa.messageSentOk'):t('wa.testFailed',{status:r.status||'?'})}); }catch(e){ setTest({state:'err',msg:e.message}); } loadLog(); }
  async function runReport(){ setReport({state:'sending'}); try{ const r=await api('cron/daily',{method:'POST'}); const n=(r.sent||[]).reduce((a,s)=>a+(s.sent||0),0); setReport({state:'ok',msg:t('wa.ranOk',{n})}); }catch(e){ setReport({state:'err',msg:e.message}); } loadLog(); }
  return <div className="max-w-2xl">
    <PageHead title={t('wa.title')} subtitle={t('wa.subtitle')}/>
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div><div className="font-medium text-navy">{t('wa.enableNotifications')}</div><div className="text-xs text-slate-400">{t('wa.masterSwitchHint')}</div></div>
        <Toggle on={enabled} onChange={setEnabled}/>
      </div>
      <div className="border-t border-slate-100 pt-4">
        <Field label={t('wa.apiKeyLabel')} hint={cfg&&cfg.hasApiKey?t('wa.apiKeyHintSaved'):t('wa.apiKeyHintRequired')}><Input type="password" autoComplete="new-password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={cfg&&cfg.apiKeyMasked?cfg.apiKeyMasked:t('wa.apiKeyPlaceholder')}/></Field>
      </div>
      <div className="border-t border-slate-100 pt-4">
        <SectionTitle>{t('wa.whoGetsNotified')}</SectionTitle>
        <p className="text-xs text-slate-400 mb-2">{t('wa.recipientsHintPre')}<button onClick={()=>navigate('/profile')} className="text-gold hover:underline">{t('wa.profileLink')}</button>{t('wa.recipientsHintPost')}</p>
        {user.role==='admin'&&<p className="text-xs text-slate-500 bg-slate-50 border border-slate-200/70 rounded-lg p-2.5 mb-3 flex items-start gap-2">
          <Icon name="info" className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0"/>
          <span>{t('wa.reportsMovedToRules')} <button onClick={()=>navigate('/admin/rules')} className="text-gold hover:underline">{t('rules.title')}</button></span>
        </p>}
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-xs text-slate-500"><th className="text-left font-medium py-2 pr-3">{t('wa.messageType')}</th>{WA_ROLE_COLS.map(([k])=><th key={k} className="font-medium py-2 px-2 text-center w-20">{t('role.'+k)}</th>)}</tr></thead>
          <tbody>
            {WA_MSG_TYPES.map(wt=><tr key={wt.key} className="border-t border-slate-50">
              <td className="py-2 pr-3 text-navy">{t('watype.'+wt.key)}</td>
              {WA_ROLE_COLS.map(([role])=><td key={role} className="py-2 px-2 text-center"><input type="checkbox" checked={(matrix[wt.key]||[]).includes(role)} onChange={()=>toggleMatrix(wt.key,role)} className="accent-navy w-4 h-4"/></td>)}
            </tr>)}
          </tbody>
        </table></div>
      </div>
      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <Btn onClick={save} disabled={busy}>{busy?t('wa.saving'):t('wa.saveSettings')}</Btn>
        <Btn variant="outline" onClick={sendTest} disabled={!cfg}><Icon name="msg" className="w-4 h-4"/>{t('wa.sendTestToMe')}</Btn>
        {saved&&<span className="text-sm text-success flex items-center gap-1 fadein"><Icon name="check" className="w-4 h-4"/>{t('wa.saved')}</span>}
        {test&&<span className={`text-sm flex items-center gap-1 ${test.state==='ok'?'text-success':test.state==='err'?'text-danger':'text-slate-400'}`}>{test.state==='sending'?t('wa.sending'):test.msg}</span>}
      </div>
    </Card>

    <Card className="p-5 mt-4 space-y-4">
      <SectionTitle right={<span className="text-[11px] text-slate-400">{t('wa.checkedDaily')}</span>}>{t('wa.alertRulesTitle')}</SectionTitle>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={t('wa.maxDrawdownLabel')} hint={t('wa.maxDrawdownHint')}><Input type="number" value={ddPct} onChange={e=>setDdPct(e.target.value)} placeholder="10"/></Field>
        <Field label={t('wa.dailyPnlLabel')} hint={t('wa.dailyPnlHint')}><Input type="number" value={pnlThr} onChange={e=>setPnlThr(e.target.value)} placeholder="-5000"/></Field>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 pt-4">
        <div><div className="text-sm font-medium text-navy">{t('wa.dailyReportTitle')}</div><div className="text-xs text-slate-400">{t('wa.dailyReportHint')}</div></div>
        <Toggle on={dailyReport} onChange={setDailyReport}/>
      </div>
      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <Btn onClick={save} disabled={busy}>{busy?t('wa.saving'):t('wa.saveRules')}</Btn>
        <Btn variant="outline" onClick={runReport} disabled={!cfg||!cfg.enabled}><Icon name="trendup" className="w-4 h-4"/>{t('wa.runReportNow')}</Btn>
        {report&&<span className={`text-sm flex items-center gap-1 ${report.state==='ok'?'text-success':report.state==='err'?'text-danger':'text-slate-400'}`}>{report.state==='sending'?t('wa.running'):report.msg}</span>}
      </div>
    </Card>

    <Card className="p-5 mt-4 space-y-3">
      <SectionTitle right={<Btn variant="outline" size="sm" onClick={addRule}><Icon name="plus" className="w-3.5 h-3.5"/>{t('wa.addRule')}</Btn>}>{t('wa.scopedRulesTitle')}</SectionTitle>
      {rules.length===0&&<div className="text-sm text-slate-400 py-2">{t('wa.noScopedRules')}</div>}
      {rules.map((r,i)=><div key={r.id} className="flex flex-wrap items-center gap-2">
        <Select className="w-48" value={r.scope} onChange={v=>updateRule(i,{scope:v})} options={scopeOpts}/>
        <Select className="w-40" value={r.metric} onChange={v=>updateRule(i,{metric:v})} options={metricOpts}/>
        <Input type="number" className="w-24" value={r.value} onChange={e=>updateRule(i,{value:e.target.value})}/>
        <div data-tip={t('wa.enabledTooltip')}><Toggle on={r.enabled} onChange={v=>updateRule(i,{enabled:v})} size="sm"/></div>
        <button onClick={()=>setRules(rs=>rs.filter((_,j)=>j!==i))} className="text-slate-400 hover:text-danger p-1"><Icon name="trash" className="w-4 h-4"/></button>
      </div>)}
      <div className="flex items-center gap-3 pt-1"><Btn onClick={save} disabled={busy}>{busy?t('wa.saving'):t('wa.saveRules')}</Btn><span className="text-[11px] text-slate-400">{t('wa.rulesLegend')}</span></div>
    </Card>

    <Card className="p-5 mt-4">
      <SectionTitle>{t('wa.howItWorksTitle')}</SectionTitle>
      <p className="text-sm text-slate-600 mb-4">{t('wa.howItWorksBody')}</p>
      <SectionTitle>{t('wa.activeAlertsTitle')}</SectionTitle>
      <ul className="text-sm text-slate-600 space-y-2">
        <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-success mt-0.5"/>{t('wa.activeLoginAlert')}</li>
        <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-success mt-0.5"/>{t('wa.activeDrawdownAlert')}</li>
        <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-success mt-0.5"/>{t('wa.activeDormantAlert')}</li>
        <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-success mt-0.5"/>{t('wa.activeReportsAlert')}</li>
      </ul>
    </Card>

    <Card className="p-5 mt-4">
      <SectionTitle right={<button onClick={loadLog} className="text-xs text-slate-400 hover:text-navy flex items-center gap-1"><Icon name="refresh" className="w-3.5 h-3.5"/>{t('wa.refresh')}</button>}>{t('wa.sentMessagesTitle')}</SectionTitle>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]"><Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={logQ} onChange={e=>setLogQ(e.target.value)} placeholder={t('wa.filterPlaceholder')} className="w-full bg-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"/></div>
        <Select value={logStatus} onChange={setLogStatus} className="w-32" options={[{value:'all',label:t('wa.statusAll')},{value:'ok',label:t('wa.statusSent')},{value:'fail',label:t('wa.statusFailed')}]}/>
      </div>
      {log===null? <div className="text-sm text-slate-400"><Loader/></div>
        : log.length===0? <div className="text-sm text-slate-400 py-3">{logTotal===0&&!logQ&&logStatus==='all'?t('wa.noMessagesSent'):t('wa.noMessagesMatch')}</div>
        : <>
        <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500 text-left">
              <th className="px-3 py-2 font-medium">{t('wa.recipient')}</th>
              <th className="px-3 py-2 font-medium">{t('wa.number')}</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">{t('wa.sentAt')}</th>
              <th className="px-3 py-2 font-medium">{t('wa.message')}</th>
            </tr></thead>
            <tbody>
              {log.map(l=><tr key={l.id} className="border-b border-slate-50 align-top">
                <td className="px-3 py-2 whitespace-nowrap"><span className="inline-flex items-center gap-2"><span className={`w-2 h-2 rounded-full shrink-0 ${l.ok?'bg-success':'bg-danger'}`} title={l.ok?t('wa.statusSent'):t('wa.statusFailed')}/>{l.recipientName||<span className="text-slate-400">—</span>}</span></td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500 whitespace-nowrap">{l.phone}</td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap text-xs">{fmtDT(l.createdAt)}</td>
                <td className="px-3 py-2"><div className="text-navy whitespace-pre-wrap break-words max-w-md leading-snug">{l.message}</div>{!l.ok&&l.response&&<div className="text-[11px] text-danger break-words max-w-md mt-1" title={l.response}>{l.response}</div>}</td>
              </tr>)}
            </tbody>
          </table></div>
        <div className="flex items-center justify-between gap-3 mt-3 text-xs text-slate-500">
          <span>{t('common.pageRange',{from:logFrom,to:logTo,total:logTotal})}</span>
          <div className="flex items-center gap-2">
            <Btn variant="ghost" size="sm" disabled={logOffset===0} onClick={()=>setLogOffset(o=>Math.max(0,o-LOG_PAGE_SIZE))}><Icon name="chevleft" className="w-4 h-4"/>{t('common.prev')}</Btn>
            <Btn variant="ghost" size="sm" disabled={logOffset+LOG_PAGE_SIZE>=logTotal} onClick={()=>setLogOffset(o=>o+LOG_PAGE_SIZE)}>{t('common.next')}<Icon name="chevright" className="w-4 h-4"/></Btn>
          </div>
        </div>
        </>}
    </Card>
  </div>;
}

export { AdminOpenWA };
