import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  fmtPctPlain, fmtSigned, fmtAgo, fmtDur, api, toast, Icon, Card, SectionTitle, Btn, Confirm, useApp, hasPerm,
  dormantInfo, LiveBadge, PageHead, Denied
} from '../ui'

function StatusPage(){
  const {user,data,dataStatus,reloadData,t}=useApp();
  const [snaps,setSnaps]=useState(null); const [alerts,setAlerts]=useState(null); const [openwa,setOpenwa]=useState(undefined); const [dbErr,setDbErr]=useState(null);
  const [exchanges,setExchanges]=useState(null);
  const [wipe,setWipe]=useState(false); const [wiping,setWiping]=useState(false);
  async function doReset(){ setWiping(true); try{ await api('init',{method:'POST',body:{action:'reset'}}); toast.success(t('sysstatus.resetSuccess')); reloadData&&reloadData(); }catch(e){ toast.error(e.message); } finally{ setWiping(false); setWipe(false); } }
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
  const mttaMin=acked.length? acked.reduce((s,a)=>s+(+new Date(a.ackedAt)-+new Date(a.createdAt)),0)/acked.length/60000 : null;
  const ackRate=(alerts&&alerts.length)? acked.length/alerts.length*100 : null;
  const dormantCount=data.openBots.filter(b=>dormantInfo(b).dormant).length;

  // Reconciliation: equity should equal walletBalance + sum(open bots' unrealized PnL) —
  // both recorded from the same sync pass. A gap beyond a small tolerance means the stored
  // bots table drifted from the account-level snapshot (e.g. a partial sync failure).
  const openUpnl=data.openBots.reduce((a,b)=>a+(b.unrealizedPnl||0),0);
  const computedEquity=live&&live.walletBalance!=null? live.walletBalance+openUpnl : null;
  const reconcileDiff=computedEquity!=null? computedEquity-live.equity : null;
  const reconcileTol=live? Math.max(1,Math.abs(live.equity)*0.001) : 1;
  const reconcileOk=reconcileDiff==null||Math.abs(reconcileDiff)<=reconcileTol;

  const checks=[
    {label:t('sysstatus.exchangeSync'), state:connected>0?(syncErr?'warn':'ok'):'neutral', sub:connected>0?(syncErr?t('sysstatus.connectedErrSub'):t(connected===1?'sysstatus.connectedCountSubOne':'sysstatus.connectedCountSubMany',{n:connected})):t('live.noExchangeConnected')},
    {label:t('sysstatus.database'), state:dbOk?'ok':'down', sub:dbOk?(lastSnap?t('sysstatus.lastSnapshotSub',{day:lastSnap.day}):t('sysstatus.connectedSub')):t('sysstatus.unreachable')},
    {label:t('sysstatus.positions'), state:data.openBots.length?'ok':'neutral', sub:t('live.openTracked',{open:data.openBots.length,tracked:data.bots.length})},
    {label:t('sysstatus.botActivity'), state:dormantCount>0?'warn':data.openBots.length?'ok':'neutral', sub:dormantCount>0?t('sysstatus.dormantSub',{n:dormantCount}):t('sysstatus.allActive')},
    ...(connected>0?[{label:t('sysstatus.balanceReconciliation'), state:reconcileOk?'ok':'warn', sub:reconcileDiff==null?'—':reconcileOk?t('sysstatus.matchesBalance'):t('sysstatus.offBy',{diff:fmtSigned(reconcileDiff)})}]:[]),
    {label:t('sysstatus.alerting'), state:alerts==null?'neutral':'ok', sub:alerts==null?t('sysstatus.checking'):t('sysstatus.pendingAckSub',{n:unacked.length})},
    ...(user.role==='admin'?[{label:t('sysstatus.whatsappTextmebot'), state:openwa==null?'neutral':openwa.enabled?(openwa.hasApiKey?'ok':'warn'):'neutral', sub:openwa===undefined?t('sysstatus.checking'):openwa===null?'—':openwa.enabled?(openwa.hasApiKey?t('sysstatus.enabledConfigured'):t('sysstatus.enabledNoKey')):t('sysstatus.disabledOptional')}]:[]),
  ];
  const anyDown=checks.some(c=>c.state==='down'); const anyWarn=checks.some(c=>c.state==='warn');
  const overall=anyDown?[t('sysstatus.degraded'),'bg-danger','text-danger']:anyWarn?[t('sysstatus.partialOutage'),'bg-amber-500','text-amber-600']:[t('sysstatus.allOperational'),'bg-success','text-success'];
  const dotCls=(s)=>s==='ok'?'bg-success':s==='warn'?'bg-amber-500':s==='down'?'bg-danger':'bg-slate-300';

  return <div>
    <PageHead title={t('sysstatus.title')} subtitle={t('sysstatus.subtitle')}/>
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
        <SectionTitle right={<span className="text-[11px] text-slate-400">{live&&live.syncedAt?t('live.syncedAgo',{ago:fmtAgo(live.syncedAt)}):t('sysstatus.neverSynced')}</span>}>{t('sysstatus.exchangeConnections')}</SectionTitle>
        {user.role!=='admin'? <div className="text-sm text-slate-400">{connected>0?t(connected===1?'sysstatus.connectedCountDotOne':'sysstatus.connectedCountDotMany',{n:connected}):t('sysstatus.noExchangeConnectedDot')}</div>
        : exchanges==null? <div className="text-sm text-slate-400">{t('common.loading')}</div>
        : exchanges.length===0? <div className="text-sm text-slate-400">{t('sysstatus.noExchangeConnectionsYet')}</div>
        : <div className="space-y-2">
          {exchanges.map(e=><div key={e.id} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${e.status==='connected'?'bg-success':e.status==='error'?'bg-danger':'bg-slate-300'}`}/>{e.label||e.name}</span>
            <span className="font-mono text-xs text-slate-400">{e.lastSync?fmtAgo(e.lastSync):'—'}</span>
          </div>)}
        </div>}
      </Card>
      <Card className="p-5">
        <SectionTitle right={<span className="text-[11px] text-slate-400">{t('sysstatus.acknowledgement')}</span>}>{t('sysstatus.alertAnalytics')}</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">{t('sysstatus.meanTimeToAck')}</div><div className="text-lg font-bold text-navy mt-0.5">{mttaMin==null?'—':fmtDur(mttaMin)}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">{t('sysstatus.ackRate')}</div><div className="text-lg font-bold text-navy mt-0.5">{ackRate==null?'—':fmtPctPlain(ackRate)}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">{t('sysstatus.totalAlerts')}</div><div className="text-lg font-bold text-navy mt-0.5">{alerts==null?'—':alerts.length}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">{t('sysstatus.pendingAck')}</div><div className={`text-lg font-bold mt-0.5 ${unacked.length?'text-danger':'text-navy'}`}>{alerts==null?'—':unacked.length}</div></div>
        </div>
        <div className="text-[11px] text-slate-400 mt-3">{lastSnap?t('sysstatus.lastRecordedSnapshot',{day:lastSnap.day,ago:fmtAgo(lastSnap.day)}):t('sysstatus.noSnapshotsYet')}</div>
      </Card>
    </div>
    {user.role==='admin'&&<Card className="p-5 mt-5">
      <SectionTitle>{t('sysstatus.maintenance')}</SectionTitle>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="text-sm text-slate-600 max-w-md">{t('sysstatus.wipeDescription')}</div>
        <Btn variant="danger" onClick={()=>setWipe(true)}><Icon name="trash" className="w-4 h-4"/>{t('sysstatus.resetData')}</Btn>
      </div>
    </Card>}
    <Confirm open={wipe} title={t('sysstatus.resetConfirmTitle')} message={t('sysstatus.resetConfirmMessage')} confirmLabel={wiping?t('sysstatus.resetting'):t('sysstatus.resetEverything')} onCancel={()=>setWipe(false)} onConfirm={doReset}/>
  </div>;
}

export { StatusPage };
