import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  FUND_PALETTE, api, toast, Icon, Card, Btn, Field, Input, Modal, Confirm, useApp, hasPerm,
  PageHead, Denied, EmptyState
} from '../ui.jsx'

/* ============================================================
   FUNDS — global CRUD (admins) / read-only list (operators, viewers)
   ============================================================ */
// Row of clickable colour chips from FUND_PALETTE.
function ColorPicker({value,onChange}){
  return <div className="flex flex-wrap gap-1.5">
    {FUND_PALETTE.map(c=><button key={c} type="button" onClick={()=>onChange(c)} title={c}
      className={`w-7 h-7 rounded-full transition ${value===c?'ring-2 ring-offset-2 ring-navy':'hover:scale-110'}`} style={{background:c}}>
      {value===c&&<Icon name="check" className="w-4 h-4 text-white mx-auto"/>}
    </button>)}
  </div>;
}
function FundModal({open,initial,onClose,onSave}){
  const [name,setName]=useState(''); const [color,setColor]=useState(FUND_PALETTE[0]); const [busy,setBusy]=useState(false);
  useEffect(()=>{ if(open){ setName(initial?.name||''); setColor(initial?.color||FUND_PALETTE[0]); setBusy(false); } },[open,initial]);
  if(!open) return null;
  const save=async()=>{ if(!name.trim())return; setBusy(true); try{ await onSave({name:name.trim(),color}); }catch(e){ toast.error(e.message); setBusy(false); } };
  return <Modal open={open} onClose={onClose} title={initial?'Edit fund':'Create fund'}>
    <div className="space-y-4">
      <Field label="Name"><Input value={name} autoFocus onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')save();}} placeholder="Delta Fund"/></Field>
      <Field label="Colour" hint="Shown as a coloured dot here and as an emoji in the WhatsApp report"><ColorPicker value={color} onChange={setColor}/></Field>
      <div className="flex justify-end gap-2 pt-1"><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy||!name.trim()}>{busy?'Saving…':(initial?'Save':'Create')}</Btn></div>
    </div>
  </Modal>;
}
function FundsPage(){
  const {funds,user,reloadData}=useApp();
  const isAdmin=user.role==='admin';
  const [modal,setModal]=useState(null); const [del,setDel]=useState(null);
  if(!hasPerm(user,'view_trades')) return <Denied/>;
  async function createFund(v){ await api('funds',{method:'POST',body:v}); await reloadData(); setModal(null); toast.success('Fund created'); }
  async function editFund(v){ await api('funds',{method:'PATCH',body:{id:modal.id,...v}}); await reloadData(); setModal(null); toast.success('Fund updated'); }
  async function removeFund(){ try{ await api('funds',{method:'DELETE',body:{id:del.id}}); await reloadData(); toast.success('Fund deleted — its bots are now unassigned'); }catch(e){ toast.error(e.message); } setDel(null); }
  return <div>
    <PageHead title="Funds" subtitle="Group your positions into funds — each gets a colour used in reports"
      actions={isAdmin&&<Btn onClick={()=>setModal({})}><Icon name="plus" className="w-4 h-4"/>New fund</Btn>}/>
    {funds.length===0? <EmptyState icon="layers" title="No funds yet"
        hint={isAdmin?'Create your first fund, then assign positions to it from the Bots page.':'No funds have been created yet.'}
        action={isAdmin&&<Btn onClick={()=>setModal({})}><Icon name="plus" className="w-4 h-4"/>Create a fund</Btn>}/>
    : <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {funds.map(f=><Card key={f.id} className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-4 h-4 rounded-full shrink-0" style={{background:f.color}}/>
            <span className="font-semibold text-navy truncate">{f.name}</span>
          </div>
          {isAdmin&&<div className="flex gap-1 shrink-0">
            <button onClick={()=>setModal(f)} className="text-slate-400 hover:text-navy p-1" data-tip="Edit"><Icon name="pencil" className="w-4 h-4"/></button>
            <button onClick={()=>setDel(f)} className="text-slate-400 hover:text-danger p-1" data-tip="Delete"><Icon name="trash" className="w-4 h-4"/></button>
          </div>}
        </div>
        <div className="flex items-center gap-4 mt-4 text-sm">
          <div><div className="text-[11px] text-slate-400">Bots</div><div className="text-lg font-bold text-navy tnum">{f.botCount}</div></div>
          <div><div className="text-[11px] text-slate-400">Open</div><div className="text-lg font-bold text-success tnum">{f.openCount}</div></div>
        </div>
      </Card>)}
    </div>}
    <FundModal open={!!modal} initial={modal&&modal.id?modal:null} onClose={()=>setModal(null)} onSave={modal&&modal.id?editFund:createFund}/>
    <Confirm open={!!del} title="Delete fund" confirmLabel="Delete fund"
      message={`Delete "${del?.name}"? Its ${del?.botCount||0} bot(s) will become unassigned (not deleted). This cannot be undone.`}
      onCancel={()=>setDel(null)} onConfirm={removeFund}/>
  </div>;
}

export { FundsPage };
