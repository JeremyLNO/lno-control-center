import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  WA_MSG_TYPES, WA_ROLE_COLS, fmtDT, api, toast, Icon, Card, SectionTitle, Btn, Toggle, Select, Field,
  Input, useApp, Login, PageHead, Denied
} from '../ui'

/* ============================================================
   ADMIN — WHATSAPP
   ============================================================ */
function AdminOpenWA(){
  const {user,funds,navigate}=useApp();
  const [cfg,setCfg]=useState(null);
  const [enabled,setEnabled]=useState(false); const [matrix,setMatrix]=useState({}); const [apiKey,setApiKey]=useState('');
  const [ddPct,setDdPct]=useState(10); const [pnlThr,setPnlThr]=useState(-5000); const [dailyReport,setDailyReport]=useState(true);
  const [rules,setRules]=useState([]);
  const [saved,setSaved]=useState(false); const [busy,setBusy]=useState(false); const [test,setTest]=useState(null); const [report,setReport]=useState(null);
  const [log,setLog]=useState(null); const [logQ,setLogQ]=useState(''); const [logStatus,setLogStatus]=useState('all');
  const loadLog=()=>api('openwa?log=1').then(r=>setLog(r.log||[])).catch(()=>setLog([]));
  useEffect(()=>{ if(user.role!=='admin')return; api('openwa').then(r=>{ const c=r.config; setCfg(c); setEnabled(c.enabled); setMatrix(c.notifMatrix||{}); setDdPct(c.drawdownPct??10); setPnlThr(c.pnlDayThreshold??-5000); setDailyReport(c.dailyReport??true); setRules(c.alertRules||[]); }).catch(()=>{}); loadLog(); },[]);
  if(user.role!=='admin') return <Denied/>;
  const scopeOpts=[{value:'portfolio',label:'Portfolio'},...funds.map(f=>({value:'fund:'+f.id,label:'Fund · '+f.name}))];
  const metricOpts=[{value:'drawdown',label:'Max drawdown (%)'},{value:'pnlDay',label:'Daily PnL ($)'}];
  const filteredLog=(log||[]).filter(l=>{
    if(logStatus==='ok'&&!l.ok) return false;
    if(logStatus==='fail'&&l.ok) return false;
    if(logQ){ const q=logQ.toLowerCase(); if(!((l.recipientName||'').toLowerCase().includes(q)||(l.phone||'').toLowerCase().includes(q)||(l.message||'').toLowerCase().includes(q))) return false; }
    return true;
  });
  const updateRule=(i,patch)=>setRules(rs=>rs.map((r,j)=>j===i?{...r,...patch}:r));
  const addRule=()=>setRules(rs=>[...rs,{id:'r'+Date.now(),scope:'portfolio',metric:'drawdown',value:10,enabled:true}]);
  const toggleMatrix=(type,role)=>setMatrix(m=>{ const cur=new Set(m[type]||[]); cur.has(role)?cur.delete(role):cur.add(role); return {...m,[type]:[...cur]}; });
  async function save(){ setBusy(true); try{ const body: any={enabled,drawdownPct:Number(ddPct),pnlDayThreshold:Number(pnlThr),dailyReport,alertRules:rules.map(r=>({...r,value:Number(r.value)})),notifMatrix:matrix}; if(apiKey.trim())body.apiKey=apiKey.trim(); const r=await api('openwa',{method:'PUT',body}); setCfg(r.config); setMatrix(r.config.notifMatrix||{}); setApiKey(''); setSaved(true); setTimeout(()=>setSaved(false),1800); }catch(e){ toast.error(e.message); } finally{ setBusy(false); } }
  async function sendTest(){ setTest({state:'sending'}); try{ const r=await api('openwa',{method:'POST',body:{action:'test'}}); setTest({state:r.ok?'ok':'err', msg:r.ok?'Message sent ✓':('Failed (HTTP '+(r.status||'?')+')')}); }catch(e){ setTest({state:'err',msg:e.message}); } loadLog(); }
  async function runReport(){ setReport({state:'sending'}); try{ const r=await api('cron/daily',{method:'POST'}); const n=(r.sent||[]).reduce((a,s)=>a+(s.sent||0),0); setReport({state:'ok',msg:`Ran ✓ — ${n} message(s) delivered`}); }catch(e){ setReport({state:'err',msg:e.message}); } loadLog(); }
  return <div className="max-w-2xl">
    <PageHead title="WhatsApp Alerts" subtitle="Send alerts to WhatsApp via TextMeBot — one firm-wide account key"/>
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div><div className="font-medium text-navy">Enable WhatsApp notifications</div><div className="text-xs text-slate-400">Master switch — if off, nobody receives anything</div></div>
        <Toggle on={enabled} onChange={setEnabled}/>
      </div>
      <div className="border-t border-slate-100 pt-4">
        <Field label="TextMeBot API key" hint={cfg&&cfg.hasApiKey?'Saved — leave blank to keep':'Required to send — paste your TextMeBot account key'}><Input type="password" autoComplete="new-password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={cfg&&cfg.apiKeyMasked?cfg.apiKeyMasked:'TextMeBot account key'}/></Field>
      </div>
      <div className="border-t border-slate-100 pt-4">
        <SectionTitle>Who gets notified</SectionTitle>
        <p className="text-xs text-slate-400 mb-3">Recipients are users who turned on WhatsApp in their <button onClick={()=>navigate('/profile')} className="text-gold hover:underline">profile</button>. Choose which role receives each message type.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-xs text-slate-500"><th className="text-left font-medium py-2 pr-3">Message type</th>{WA_ROLE_COLS.map(([k,l])=><th key={k} className="font-medium py-2 px-2 text-center w-20">{l}</th>)}</tr></thead>
          <tbody>
            {WA_MSG_TYPES.map(t=><tr key={t.key} className="border-t border-slate-50">
              <td className="py-2 pr-3 text-navy">{t.label}</td>
              {WA_ROLE_COLS.map(([role])=><td key={role} className="py-2 px-2 text-center"><input type="checkbox" checked={(matrix[t.key]||[]).includes(role)} onChange={()=>toggleMatrix(t.key,role)} className="accent-navy w-4 h-4"/></td>)}
            </tr>)}
          </tbody>
        </table></div>
      </div>
      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <Btn onClick={save} disabled={busy}>{busy?'Saving…':'Save settings'}</Btn>
        <Btn variant="outline" onClick={sendTest} disabled={!cfg}><Icon name="msg" className="w-4 h-4"/>Send test to me</Btn>
        {saved&&<span className="text-sm text-success flex items-center gap-1 fadein"><Icon name="check" className="w-4 h-4"/>Saved</span>}
        {test&&<span className={`text-sm flex items-center gap-1 ${test.state==='ok'?'text-success':test.state==='err'?'text-danger':'text-slate-400'}`}>{test.state==='sending'?'Sending…':test.msg}</span>}
      </div>
    </Card>

    <Card className="p-5 mt-4 space-y-4">
      <SectionTitle right={<span className="text-[11px] text-slate-400">checked daily · 08:00 Paris</span>}>Alert rules</SectionTitle>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Max drawdown alert (%)" hint="Alert when portfolio drawdown exceeds this"><Input type="number" value={ddPct} onChange={e=>setDdPct(e.target.value)} placeholder="10"/></Field>
        <Field label="Daily PnL alert ($)" hint="Alert when the day's PnL falls below this (e.g. -5000)"><Input type="number" value={pnlThr} onChange={e=>setPnlThr(e.target.value)} placeholder="-5000"/></Field>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 pt-4">
        <div><div className="text-sm font-medium text-navy">Daily portfolio report</div><div className="text-xs text-slate-400">Automatic WhatsApp summary every day at 08:00 (Europe/Paris)</div></div>
        <Toggle on={dailyReport} onChange={setDailyReport}/>
      </div>
      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <Btn onClick={save} disabled={busy}>{busy?'Saving…':'Save rules'}</Btn>
        <Btn variant="outline" onClick={runReport} disabled={!cfg||!cfg.enabled}><Icon name="trendup" className="w-4 h-4"/>Run report now</Btn>
        {report&&<span className={`text-sm flex items-center gap-1 ${report.state==='ok'?'text-success':report.state==='err'?'text-danger':'text-slate-400'}`}>{report.state==='sending'?'Running…':report.msg}</span>}
      </div>
    </Card>

    <Card className="p-5 mt-4 space-y-3">
      <SectionTitle right={<Btn variant="outline" size="sm" onClick={addRule}><Icon name="plus" className="w-3.5 h-3.5"/>Add rule</Btn>}>Scoped rules (per fund / bot)</SectionTitle>
      {rules.length===0&&<div className="text-sm text-slate-400 py-2">No scoped rules. The global thresholds above still apply to the whole portfolio.</div>}
      {rules.map((r,i)=><div key={r.id} className="flex flex-wrap items-center gap-2">
        <Select className="w-48" value={r.scope} onChange={v=>updateRule(i,{scope:v})} options={scopeOpts}/>
        <Select className="w-40" value={r.metric} onChange={v=>updateRule(i,{metric:v})} options={metricOpts}/>
        <Input type="number" className="w-24" value={r.value} onChange={e=>updateRule(i,{value:e.target.value})}/>
        <div data-tip="Enabled"><Toggle on={r.enabled} onChange={v=>updateRule(i,{enabled:v})} size="sm"/></div>
        <button onClick={()=>setRules(rs=>rs.filter((_,j)=>j!==i))} className="text-slate-400 hover:text-danger p-1"><Icon name="trash" className="w-4 h-4"/></button>
      </div>)}
      <div className="flex items-center gap-3 pt-1"><Btn onClick={save} disabled={busy}>{busy?'Saving…':'Save rules'}</Btn><span className="text-[11px] text-slate-400">Drawdown alerts when the scope's drawdown exceeds the % · PnL alerts when the day's PnL falls below the $ value · evaluated daily.</span></div>
    </Card>

    <Card className="p-5 mt-4">
      <SectionTitle>How it works</SectionTitle>
      <p className="text-sm text-slate-600 mb-4"><span className="font-mono text-xs bg-slate-100 px-1 rounded">TextMeBot</span> is a hosted WhatsApp relay — <span className="font-medium">no server to run</span>. One shared TextMeBot account key (set above, <span className="font-medium">encrypted at rest</span>) sends to every opted-in user's number; the backend just makes an HTTPS request. Recipients must have their WhatsApp number registered with TextMeBot. The matrix above decides which role gets each message type. <span className="text-slate-400">(Send-only: acknowledge alerts from the bell; the monthly PDF stays downloadable under Reports.)</span></p>
      <SectionTitle>Active alerts</SectionTitle>
      <ul className="text-sm text-slate-600 space-y-2">
        <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-success mt-0.5"/>Login-failure alerts to admins (after 3 failed attempts)</li>
        <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-success mt-0.5"/>Drawdown &amp; daily-PnL breaches — portfolio, per fund, or per bot</li>
        <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-success mt-0.5"/>Daily report, plus weekly (Mondays) &amp; monthly (1st) summaries</li>
      </ul>
    </Card>

    <Card className="p-5 mt-4">
      <SectionTitle right={<button onClick={loadLog} className="text-xs text-slate-400 hover:text-navy flex items-center gap-1"><Icon name="refresh" className="w-3.5 h-3.5"/>Refresh</button>}>Sent messages</SectionTitle>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]"><Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={logQ} onChange={e=>setLogQ(e.target.value)} placeholder="Filter by name, number or message…" className="w-full bg-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"/></div>
        <Select value={logStatus} onChange={setLogStatus} className="w-32" options={[{value:'all',label:'All'},{value:'ok',label:'Sent'},{value:'fail',label:'Failed'}]}/>
      </div>
      {log===null? <div className="text-sm text-slate-400">Loading…</div>
        : filteredLog.length===0? <div className="text-sm text-slate-400 py-3">{log.length===0?'No WhatsApp messages sent yet.':'No messages match the filter.'}</div>
        : <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500 text-left">
              <th className="px-3 py-2 font-medium">Recipient</th>
              <th className="px-3 py-2 font-medium">Number</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Sent at</th>
              <th className="px-3 py-2 font-medium">Message</th>
            </tr></thead>
            <tbody>
              {filteredLog.map(l=><tr key={l.id} className="border-b border-slate-50 align-top">
                <td className="px-3 py-2 whitespace-nowrap"><span className="inline-flex items-center gap-2"><span className={`w-2 h-2 rounded-full shrink-0 ${l.ok?'bg-success':'bg-danger'}`} title={l.ok?'Sent':'Failed'}/>{l.recipientName||<span className="text-slate-400">—</span>}</span></td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500 whitespace-nowrap">{l.phone}</td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap text-xs">{fmtDT(l.createdAt)}</td>
                <td className="px-3 py-2"><div className="text-navy whitespace-pre-wrap break-words max-w-md leading-snug">{l.message}</div>{!l.ok&&l.response&&<div className="text-[11px] text-danger break-words max-w-md mt-1" title={l.response}>{l.response}</div>}</td>
              </tr>)}
            </tbody>
          </table></div>}
    </Card>
  </div>;
}

export { AdminOpenWA };
