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
  const {user}=useApp();
  const [exchanges,setExchanges]=useState([]);
  const [modal,setModal]=useState(null); const [del,setDel]=useState(null);
  const reload=()=>api('exchanges').then(r=>setExchanges(r.exchanges||[])).catch(()=>{});
  const [syncing,setSyncing]=useState(false);
  async function runSync(){ setSyncing(true); try{ const r=await api('bots',{method:'POST',body:{action:'sync'}}); await reload(); if(r.errors){ toast.error((r.errorMsgs&&r.errorMsgs[0])||`${r.errors} exchange${r.errors===1?'':'s'} failed to sync`); } else { toast.success(`Synced ${r.connected||0} exchange${(r.connected||0)===1?'':'s'} · ${r.positions||0} position${(r.positions||0)===1?'':'s'}`); } }catch(e){ toast.error(e.message); } finally{ setSyncing(false); } }
  useEffect(()=>{ if(user.role==='admin') reload(); },[]);
  if(user.role!=='admin') return <Denied/>;
  const mask=(s)=> s? s.slice(0,6)+'••••••••'+s.slice(-4) : '';
  return <div>
    <PageHead title="Exchanges" subtitle="Exchange API connections" actions={<div className="flex items-center gap-2">
      <Btn variant="outline" onClick={runSync} disabled={syncing}><Icon name="refresh" className="w-4 h-4"/>{syncing?'Syncing…':'Sync now'}</Btn>
      <Btn onClick={()=>setModal({mode:'add',data:{name:'binance',label:'',apiKey:'',secret:'',note:''}})}><Icon name="plus" className="w-4 h-4"/>Add Exchange</Btn>
    </div>}/>
    <div className="grid md:grid-cols-2 gap-4">
      {exchanges.map(e=><Card key={e.id} className="p-5">
        <div className="flex items-start justify-between">
          <div><div className="font-semibold text-navy">{e.label}</div><div className="text-xs text-slate-400 font-mono">{e.name}</div></div>
          <StatusPill status={e.status}/>
        </div>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-400">API Key</span><span className="font-mono text-xs">{mask(e.apiKey)}</span></div>
          <div className="flex justify-between items-center"><span className="text-slate-400">API Secret</span>
            <span className="flex items-center gap-1.5 font-mono text-xs">{e.hasSecret? e.secretMasked : <span className="text-slate-300">none</span>}<Icon name="shield" className="w-3.5 h-3.5 text-success" data-tip="Encrypted at rest"/></span>
          </div>
          <div className="flex justify-between"><span className="text-slate-400">Last sync</span><span className="text-xs">{e.lastSync?fmtDT(e.lastSync):'—'}</span></div>
          {e.note&&<div className="text-xs text-slate-400 pt-1">{e.note}</div>}
          {e.status==='error'&&e.lastError&&<div className="text-xs text-danger bg-danger/5 border border-danger/20 rounded-lg p-2 mt-1 break-words"><span className="font-medium">Sync error:</span> {e.lastError}</div>}
        </div>
        <div className="flex gap-2 mt-4">
          <Btn variant="outline" size="sm" onClick={()=>setModal({mode:'edit',data:{...e,secret:''}})}><Icon name="pencil" className="w-3.5 h-3.5"/>Edit</Btn>
          <Btn variant="ghost" size="sm" className="text-danger" onClick={()=>setDel(e)}><Icon name="trash" className="w-3.5 h-3.5"/>Delete</Btn>
        </div>
      </Card>)}
    </div>
    <ExchangeModal modal={modal} onClose={()=>setModal(null)} onSave={async(d)=>{
      try{
        const body: any={name:(d.name||'binance'),label:d.label,apiKey:d.apiKey,note:d.note}; if(d.secret) body.apiSecret=d.secret;
        if(modal.mode==='add') await api('exchanges',{method:'POST',body});
        else await api('exchanges',{method:'PATCH',body:{id:d.id,...body}});
        setModal(null); await runSync(); // kick off a first sync so it doesn't sit at "pending"
      }catch(e){ toast.error(e.message); }
    }}/>
    <Confirm open={!!del} title="Delete exchange" message={`Remove ${del?.label}? Bots using this connection will lose API access.`} onCancel={()=>setDel(null)} onConfirm={async()=>{try{await api('exchanges',{method:'DELETE',body:{id:del.id}});await reload();toast.success('Exchange removed');}catch(e){toast.error(e.message);}setDel(null);}}/>
  </div>;
}
function ExchangeModal({modal,onClose,onSave}: any){
  const [v,setV]=useState<any>({}); useEffect(()=>{ if(modal)setV(modal.data); },[modal]);
  if(!modal)return null;
  return <Modal open={true} onClose={onClose} title={modal.mode==='add'?'Add Exchange':'Edit Exchange'}>
    <div className="space-y-3">
      <Field label="Exchange"><Select value={v.name||'binance'} onChange={x=>setV({...v,name:x})} options={[{value:'binance',label:'Binance (USDT-M Futures)'}]}/></Field>
      <Field label="Label" hint="Any name you like — e.g. “Main account”, “Sub-account 2”."><Input value={v.label||''} onChange={e=>setV({...v,label:e.target.value})} placeholder="Main account"/></Field>
      <Field label="API Key"><Input autoComplete="off" value={v.apiKey||''} onChange={e=>setV({...v,apiKey:e.target.value})}/></Field>
      <Field label="API Secret" hint={modal.mode==='edit'?'Leave blank to keep the existing secret':undefined}><Input type="password" autoComplete="new-password" value={v.secret||''} onChange={e=>setV({...v,secret:e.target.value})} placeholder={modal.mode==='edit'?'•••••••• — leave blank to keep':undefined}/></Field>
      <Field label="Note (optional)"><Input value={v.note||''} onChange={e=>setV({...v,note:e.target.value})}/></Field>
      <div className="text-[11px] text-slate-500 bg-navy/5 border border-slate-200 rounded-lg p-3">The key needs <span className="font-medium">Futures read</span> + <span className="font-medium">IP whitelist</span> (Vercel has no fixed IP, so route via a static-IP proxy). The secret is stored AES-encrypted and never returned. See <span className="font-mono">BINANCE_SETUP.md</span>.</div>
      <div className="flex justify-end gap-2 pt-1"><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn onClick={()=>onSave(v)}>Save</Btn></div>
    </div>
  </Modal>;
}

export { AdminExchanges };
