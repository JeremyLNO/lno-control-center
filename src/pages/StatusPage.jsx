import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  fmtPctPlain, fmtAgo, fmtDur, api, toast, Icon, Card, SectionTitle, Btn, Confirm, useApp, hasPerm,
  LiveBadge, PageHead, Denied
} from '../ui.jsx'

function StatusPage(){
  const {user,data,dataStatus,reloadData}=useApp();
  const [snaps,setSnaps]=useState(null); const [alerts,setAlerts]=useState(null); const [openwa,setOpenwa]=useState(undefined); const [dbErr,setDbErr]=useState(null);
  const [exchanges,setExchanges]=useState(null);
  const [wipe,setWipe]=useState(false); const [wiping,setWiping]=useState(false);
  async function doReset(){ setWiping(true); try{ await api('init',{method:'POST',body:{action:'reset'}}); toast.success('Trading data reset — accounts kept'); reloadData&&reloadData(); }catch(e){ toast.error(e.message); } finally{ setWiping(false); setWipe(false); } }
  useEffect(()=>{
    api('snapshots?limit=3').then(r=>setSnaps(r.snapshots||[])).catch(e=>{ setSnaps([]); setDbErr(e.message); });
    api('alerts').then(r=>setAlerts(r.alerts||[])).catch(()=>setAlerts([]));
    if(user.role==='admin'){ api('openwa').then(r=>setOpenwa(r.config)).catch(()=>setOpenwa(null)); api('exchanges').then(r=>setExchanges(r.exchanges||[])).catch(()=>setExchanges([])); }
  },[]);
  if(!hasPerm(user,'view_activity')) return <Denied/>;

  const live=data.live; const connected=live?live.connected:0;
  const syncErr=dataStatus==='partial';
  const lastSnap=snaps&&snaps.length? snaps[snaps.length-1] : null;
  const dbOk=dbErr==null;
  const unacked=(alerts||[]).filter(a=>!a.ackedAt);
  const acked=(alerts||[]).filter(a=>a.ackedAt);
  const mttaMin=acked.length? acked.reduce((s,a)=>s+(new Date(a.ackedAt)-new Date(a.createdAt)),0)/acked.length/60000 : null;
  const ackRate=(alerts&&alerts.length)? acked.length/alerts.length*100 : null;

  const checks=[
    {label:'Exchange sync', state:connected>0?(syncErr?'warn':'ok'):'neutral', sub:connected>0?(syncErr?'Connected · last sync had errors':`${connected} exchange${connected===1?'':'s'} connected`):'No exchange connected'},
    {label:'Database', state:dbOk?'ok':'down', sub:dbOk?(lastSnap?`Last snapshot ${lastSnap.day}`:'Connected'):'Unreachable'},
    {label:'Positions', state:data.openBots.length?'ok':'neutral', sub:`${data.openBots.length} open · ${data.bots.length} tracked`},
    {label:'Alerting', state:alerts==null?'neutral':'ok', sub:alerts==null?'Checking…':`${unacked.length} pending acknowledgement`},
    ...(user.role==='admin'?[{label:'WhatsApp (TextMeBot)', state:openwa==null?'neutral':openwa.enabled?(openwa.hasApiKey?'ok':'warn'):'neutral', sub:openwa===undefined?'Checking…':openwa===null?'—':openwa.enabled?(openwa.hasApiKey?'Enabled & configured':'Enabled · no API key'):'Disabled (optional)'}]:[]),
  ];
  const anyDown=checks.some(c=>c.state==='down'); const anyWarn=checks.some(c=>c.state==='warn');
  const overall=anyDown?['Degraded','bg-danger','text-danger']:anyWarn?['Partial outage','bg-amber-500','text-amber-600']:['All systems operational','bg-success','text-success'];
  const dotCls=(s)=>s==='ok'?'bg-success':s==='warn'?'bg-amber-500':s==='down'?'bg-danger':'bg-slate-300';

  return <div>
    <PageHead title="System Status" subtitle="Health of exchange sync, database, alerting and integrations"/>
    <Card className="p-5 mb-5 flex items-center gap-3">
      <span className={`w-3 h-3 rounded-full ${overall[1]} ${anyDown?'':'pulse-dot'}`}/>
      <span className={`text-lg font-semibold ${overall[2]}`}>{overall[0]}</span>
      <span className="ml-auto"><LiveBadge status={dataStatus}/></span>
    </Card>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
      {checks.map(c=><Card key={c.label} className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-navy">{c.label}</span>
          <span className={`w-2.5 h-2.5 rounded-full ${dotCls(c.state)}`}/>
        </div>
        <div className="text-xs text-slate-500 mt-1.5">{c.sub}</div>
      </Card>)}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <Card className="p-5">
        <SectionTitle right={<span className="text-[11px] text-slate-400">{live&&live.syncedAt?`synced ${fmtAgo(live.syncedAt)}`:'never synced'}</span>}>Exchange Connections</SectionTitle>
        {user.role!=='admin'? <div className="text-sm text-slate-400">{connected>0?`${connected} exchange${connected===1?'':'s'} connected.`:'No exchange connected.'}</div>
        : exchanges==null? <div className="text-sm text-slate-400">Loading…</div>
        : exchanges.length===0? <div className="text-sm text-slate-400">No exchange connections yet — add one under Exchanges.</div>
        : <div className="space-y-2">
          {exchanges.map(e=><div key={e.id} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${e.status==='connected'?'bg-success':e.status==='error'?'bg-danger':'bg-slate-300'}`}/>{e.label||e.name}</span>
            <span className="font-mono text-xs text-slate-400">{e.lastSync?fmtAgo(e.lastSync):'—'}</span>
          </div>)}
        </div>}
      </Card>
      <Card className="p-5">
        <SectionTitle right={<span className="text-[11px] text-slate-400">acknowledgement</span>}>Alert Analytics</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Mean time to ack</div><div className="text-lg font-bold text-navy mt-0.5">{mttaMin==null?'—':fmtDur(mttaMin)}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Ack rate</div><div className="text-lg font-bold text-navy mt-0.5">{ackRate==null?'—':fmtPctPlain(ackRate)}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Total alerts</div><div className="text-lg font-bold text-navy mt-0.5">{alerts==null?'—':alerts.length}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Pending ack</div><div className={`text-lg font-bold mt-0.5 ${unacked.length?'text-danger':'text-navy'}`}>{alerts==null?'—':unacked.length}</div></div>
        </div>
        <div className="text-[11px] text-slate-400 mt-3">{lastSnap?`Last recorded snapshot ${lastSnap.day} · ${fmtAgo(lastSnap.day)}`:'No recorded snapshots yet — the daily cron writes one per day.'}</div>
      </Card>
    </div>
    {user.role==='admin'&&<Card className="p-5 mt-5">
      <SectionTitle>Maintenance</SectionTitle>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="text-sm text-slate-600 max-w-md">Wipe all trading data — bots, funds, exchanges, equity snapshots, reports, alerts, the WhatsApp log and sign-in history. <span className="font-medium text-navy">User accounts and settings are kept.</span> Use this once when going live, to clear test data.</div>
        <Btn variant="danger" onClick={()=>setWipe(true)}><Icon name="trash" className="w-4 h-4"/>Reset data</Btn>
      </div>
    </Card>}
    <Confirm open={wipe} title="Reset all trading data?" message="This permanently deletes bots, funds, exchanges, snapshots, reports, alerts, the WhatsApp log and sign-in history. User accounts and settings are kept. This cannot be undone." confirmLabel={wiping?'Resetting…':'Reset everything'} onCancel={()=>setWipe(false)} onConfirm={doReset}/>
  </div>;
}

export { StatusPage };
