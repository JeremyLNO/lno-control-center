import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  fmtDT, api, toast, Icon, Card, Btn, StatusPill, Select, Field, Input, Modal, Confirm,
  useApp, PageHead, Denied
} from '../ui'

/* ============================================================
   ADMIN — EXCHANGES
   ============================================================ */
function AdminExchanges(){
  const {user,t}=useApp();
  const [exchanges,setExchanges]=useState([]);
  const [modal,setModal]=useState(null); const [del,setDel]=useState(null);
  const reload=()=>api('exchanges').then(r=>setExchanges(r.exchanges||[])).catch(()=>{});
  const [syncing,setSyncing]=useState(false);
  async function runSync(){ setSyncing(true); try{ const r=await api('bots',{method:'POST',body:{action:'sync'}}); await reload(); if(r.errors){ toast.error((r.errorMsgs&&r.errorMsgs[0])||t(r.errors===1?'bots.syncFailedOne':'bots.syncFailedMany',{n:r.errors})); } else { const exch=t((r.connected||0)===1?'exchanges.exchangeCountOne':'exchanges.exchangeCountMany',{n:r.connected||0}); const pos=t((r.positions||0)===1?'exchanges.positionCountOne':'exchanges.positionCountMany',{n:r.positions||0}); toast.success(t('exchanges.syncedResult',{exch,pos})); } }catch(e){ toast.error(e.message); } finally{ setSyncing(false); } }
  useEffect(()=>{ if(user.role==='admin') reload(); },[]);
  if(user.role!=='admin') return <Denied/>;
  const mask=(s)=> s? s.slice(0,6)+'••••••••'+s.slice(-4) : '';
  return <div>
    <PageHead title={t('exchanges.title')} subtitle={t('exchanges.subtitle')} actions={<div className="flex items-center gap-2">
      <Btn variant="outline" onClick={runSync} disabled={syncing}><Icon name="refresh" className="w-4 h-4"/>{syncing?t('bots.syncing'):t('bots.syncNow')}</Btn>
      <Btn onClick={()=>setModal({mode:'add',data:{name:'binance',label:'',apiKey:'',secret:'',note:'',wallets:[]}})}><Icon name="plus" className="w-4 h-4"/>{t('exchanges.addExchange')}</Btn>
    </div>}/>
    <div className="grid md:grid-cols-2 gap-4">
      {exchanges.map(e=><Card key={e.id} className="p-5">
        <div className="flex items-start justify-between">
          <div><div className="font-semibold text-navy">{e.label}</div><div className="text-xs text-slate-400 font-mono">{e.name}</div></div>
          <StatusPill status={e.status}/>
        </div>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-400">{t('exchanges.apiKey')}</span><span className="font-mono text-xs">{mask(e.apiKey)}</span></div>
          <div className="flex justify-between items-center"><span className="text-slate-400">{t('exchanges.apiSecret')}</span>
            <span className="flex items-center gap-1.5 font-mono text-xs">{e.hasSecret? e.secretMasked : <span className="text-slate-300">{t('exchanges.none')}</span>}<Icon name="shield" className="w-3.5 h-3.5 text-success" data-tip={t('exchanges.encryptedAtRest')}/></span>
          </div>
          <div className="flex justify-between"><span className="text-slate-400">{t('exchanges.lastSync')}</span><span className="text-xs">{e.lastSync?fmtDT(e.lastSync):'—'}</span></div>
          {e.note&&<div className="text-xs text-slate-400 pt-1">{e.note}</div>}
          {e.status==='error'&&e.lastError&&<div className="text-xs text-danger bg-danger/5 border border-danger/20 rounded-lg p-2 mt-1 break-words"><span className="font-medium">{t('exchanges.syncError')}</span> {e.lastError}</div>}
        </div>
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="text-xs text-slate-400 mb-2">{t('exchanges.wallets')}</div>
          {(!e.wallets||e.wallets.length===0)
            ? <div className="text-xs text-slate-300">{t('exchanges.noWalletAddresses')}</div>
            : <div className="space-y-1.5">{e.wallets.map((w,i)=><div key={i} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-500 shrink-0">{w.network||'—'}</span>
                <span className="font-mono text-navy truncate" title={w.address}>{w.address}</span>
              </div>)}</div>}
        </div>
        <div className="flex gap-2 mt-4">
          <Btn variant="outline" size="sm" onClick={()=>setModal({mode:'edit',data:{...e,secret:''}})}><Icon name="pencil" className="w-3.5 h-3.5"/>{t('common.edit')}</Btn>
          <Btn variant="ghost" size="sm" className="text-danger" onClick={()=>setDel(e)}><Icon name="trash" className="w-3.5 h-3.5"/>{t('common.delete')}</Btn>
        </div>
      </Card>)}
    </div>
    <ExchangeModal modal={modal} onClose={()=>setModal(null)} onSave={async(d)=>{
      try{
        const body: any={name:(d.name||'binance'),label:d.label,apiKey:d.apiKey,note:d.note,wallets:(d.wallets||[]).filter((w)=>w.network||w.address)}; if(d.secret) body.apiSecret=d.secret;
        if(modal.mode==='add') await api('exchanges',{method:'POST',body});
        else await api('exchanges',{method:'PATCH',body:{id:d.id,...body}});
        setModal(null); await runSync(); // kick off a first sync so it doesn't sit at "pending"
      }catch(e){ toast.error(e.message); }
    }}/>
    <Confirm open={!!del} title={t('exchanges.deleteExchangeTitle')} message={t('exchanges.deleteExchangeConfirm',{label:del?.label})} onCancel={()=>setDel(null)} onConfirm={async()=>{try{await api('exchanges',{method:'DELETE',body:{id:del.id}});await reload();toast.success(t('exchanges.exchangeRemoved'));}catch(e){toast.error(e.message);}setDel(null);}}/>
  </div>;
}
function ExchangeModal({modal,onClose,onSave}: any){
  const {t}=useApp();
  const [v,setV]=useState<any>({}); useEffect(()=>{ if(modal)setV({...modal.data, wallets:modal.data.wallets||[]}); },[modal]);
  if(!modal)return null;
  const updateWallet=(i,patch)=>setV(x=>({...x,wallets:x.wallets.map((w,j)=>j===i?{...w,...patch}:w)}));
  const addWallet=()=>setV(x=>({...x,wallets:[...(x.wallets||[]),{network:'',address:''}]}));
  const removeWallet=(i)=>setV(x=>({...x,wallets:x.wallets.filter((_,j)=>j!==i)}));
  return <Modal open={true} onClose={onClose} title={modal.mode==='add'?t('exchanges.addExchangeTitle'):t('exchanges.editExchangeTitle')}>
    <div className="space-y-3">
      <Field label={t('exchanges.exchangeField')}><Select value={v.name||'binance'} onChange={x=>setV({...v,name:x})} options={[{value:'binance',label:t('exchanges.binanceFuturesLabel')}]}/></Field>
      <Field label={t('exchanges.label')} hint={t('exchanges.labelHint')}><Input value={v.label||''} onChange={e=>setV({...v,label:e.target.value})} placeholder={t('exchanges.labelPlaceholder')}/></Field>
      <Field label={t('exchanges.apiKey')}><Input autoComplete="off" value={v.apiKey||''} onChange={e=>setV({...v,apiKey:e.target.value})}/></Field>
      <Field label={t('exchanges.apiSecret')} hint={modal.mode==='edit'?t('exchanges.apiSecretHintEdit'):undefined}><Input type="password" autoComplete="new-password" value={v.secret||''} onChange={e=>setV({...v,secret:e.target.value})} placeholder={modal.mode==='edit'?t('exchanges.apiSecretPlaceholderEdit'):undefined}/></Field>
      <Field label={t('exchanges.noteOptional')}><Input value={v.note||''} onChange={e=>setV({...v,note:e.target.value})}/></Field>
      <div className="border-t border-slate-100 pt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium text-slate-500">{t('exchanges.walletsPublicAddresses')}</div>
          <Btn variant="outline" size="sm" onClick={addWallet}><Icon name="plus" className="w-3.5 h-3.5"/>{t('exchanges.addWallet')}</Btn>
        </div>
        {(v.wallets||[]).length===0 && <div className="text-xs text-slate-400 mb-2">{t('exchanges.noWalletAddressesDot')}</div>}
        {(v.wallets||[]).map((w,i)=><div key={i} className="flex items-center gap-2 mb-2">
          <Input className="w-32" value={w.network||''} onChange={e=>updateWallet(i,{network:e.target.value})} placeholder={t('exchanges.network')}/>
          <Input className="flex-1" value={w.address||''} onChange={e=>updateWallet(i,{address:e.target.value})} placeholder={t('exchanges.publicAddress')}/>
          <button onClick={()=>removeWallet(i)} className="text-slate-400 hover:text-danger p-1"><Icon name="trash" className="w-4 h-4"/></button>
        </div>)}
        <div className="text-[11px] text-slate-400">{t('exchanges.walletsPublicHint')}</div>
      </div>
      <div className="text-[11px] text-slate-500 bg-navy/5 border border-slate-200 rounded-lg p-3">{t('exchanges.keyRequirementsHint')}</div>
      <div className="flex justify-end gap-2 pt-1"><Btn variant="outline" onClick={onClose}>{t('common.cancel')}</Btn><Btn onClick={()=>onSave(v)}>{t('common.save')}</Btn></div>
    </div>
  </Modal>;
}

export { AdminExchanges };
