import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  FUND_PALETTE, api, toast, Icon, Card, Btn, Field, Input, Modal, Confirm, useApp, hasPerm,
  PageHead, Denied, EmptyState
} from '../ui'

/* ============================================================
   FUNDS — global CRUD (admins) / read-only list (operators, viewers)
   ============================================================ */
// Row of clickable colour chips from FUND_PALETTE.
function ColorPicker({value,onChange}: any){
  return <div className="flex flex-wrap gap-1.5">
    {FUND_PALETTE.map(c=><button key={c} type="button" onClick={()=>onChange(c)} title={c}
      className={`w-7 h-7 rounded-full transition ${value===c?'ring-2 ring-offset-2 ring-navy':'hover:scale-110'}`} style={{background:c}}>
      {value===c&&<Icon name="check" className="w-4 h-4 text-white mx-auto"/>}
    </button>)}
  </div>;
}
function FundModal({open,initial,onClose,onSave}: any){
  const {t}=useApp();
  const [name,setName]=useState(''); const [color,setColor]=useState(FUND_PALETTE[0]); const [busy,setBusy]=useState(false);
  useEffect(()=>{ if(open){ setName(initial?.name||''); setColor(initial?.color||FUND_PALETTE[0]); setBusy(false); } },[open,initial]);
  if(!open) return null;
  const save=async()=>{ if(!name.trim())return; setBusy(true); try{ await onSave({name:name.trim(),color}); }catch(e){ toast.error(e.message); setBusy(false); } };
  return <Modal open={open} onClose={onClose} title={initial?t('funds.editFundTitle'):t('funds.createFundTitle')}>
    <div className="space-y-4">
      <Field label={t('funds.name')}><Input value={name} autoFocus onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')save();}} placeholder={t('funds.namePlaceholder')}/></Field>
      <Field label={t('funds.colour')} hint={t('funds.colourHint')}><ColorPicker value={color} onChange={setColor}/></Field>
      <div className="flex justify-end gap-2 pt-1"><Btn variant="outline" onClick={onClose}>{t('common.cancel')}</Btn><Btn onClick={save} disabled={busy||!name.trim()}>{busy?t('funds.saving'):(initial?t('common.save'):t('funds.create'))}</Btn></div>
    </div>
  </Modal>;
}
function FundsPage(){
  const {funds,user,reloadData,refreshTick,refreshMs,t}=useApp();
  const isAdmin=user.role==='admin';
  const [modal,setModal]=useState(null); const [del,setDel]=useState(null);
  if(!hasPerm(user,'view_trades')) return <Denied/>;
  async function createFund(v){ await api('funds',{method:'POST',body:v}); await reloadData(); setModal(null); toast.success(t('funds.created')); }
  async function editFund(v){ await api('funds',{method:'PATCH',body:{id:modal.id,...v}}); await reloadData(); setModal(null); toast.success(t('funds.updated')); }
  async function removeFund(){ try{ await api('funds',{method:'DELETE',body:{id:del.id}}); await reloadData(); toast.success(t('funds.deleted')); }catch(e){ toast.error(e.message); } setDel(null); }
  return <div>
    <PageHead title={t('funds.title')} subtitle={t('funds.subtitle')}
      refresh={{ms:refreshMs,tick:refreshTick}}
      actions={isAdmin&&<Btn onClick={()=>setModal({})}><Icon name="plus" className="w-4 h-4"/>{t('funds.newFund')}</Btn>}/>
    {funds.length===0? <EmptyState icon="layers" title={t('funds.noFundsTitle')}
        hint={isAdmin?t('funds.noFundsHintAdmin'):t('funds.noFundsHintOther')}
        action={isAdmin&&<Btn onClick={()=>setModal({})}><Icon name="plus" className="w-4 h-4"/>{t('funds.createFund')}</Btn>}/>
    : <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {funds.map(f=><Card key={f.id} className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-4 h-4 rounded-full shrink-0" style={{background:f.color}}/>
            <span className="font-semibold text-navy truncate">{f.name}</span>
            {f.isEmployeeFund&&<span className="text-[10px] font-medium text-gold bg-gold/15 px-1.5 py-0.5 rounded-full shrink-0">{t('funds.employeeFund')}</span>}
          </div>
          {isAdmin&&<div className="flex gap-1 shrink-0">
            <button onClick={()=>setModal(f)} className="text-slate-400 hover:text-navy p-1" data-tip="Edit"><Icon name="pencil" className="w-4 h-4"/></button>
            {!f.isEmployeeFund&&<button onClick={()=>setDel(f)} className="text-slate-400 hover:text-danger p-1" data-tip="Delete"><Icon name="trash" className="w-4 h-4"/></button>}
          </div>}
        </div>
        <div className="flex items-center gap-4 mt-4 text-sm">
          <div><div className="text-[11px] text-slate-400">{t('funds.bots')}</div><div className="text-lg font-bold text-navy tnum">{f.botCount}</div></div>
          <div><div className="text-[11px] text-slate-400">{t('funds.open')}</div><div className="text-lg font-bold text-success tnum">{f.openCount}</div></div>
        </div>
      </Card>)}
    </div>}
    <FundModal open={!!modal} initial={modal&&modal.id?modal:null} onClose={()=>setModal(null)} onSave={modal&&modal.id?editFund:createFund}/>
    <Confirm open={!!del} title={t('funds.deleteFundTitle')} confirmLabel={t('funds.deleteFundTitle')}
      message={t('funds.deleteFundConfirm',{name:del?.name,count:del?.botCount||0})}
      onCancel={()=>setDel(null)} onConfirm={removeFund}/>
  </div>;
}

export { FundsPage };
