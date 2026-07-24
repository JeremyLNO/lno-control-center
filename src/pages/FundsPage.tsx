import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  FUND_PALETTE, fmtUSD, fmtSigned, clsPnl, api, toast, Icon, Card, SectionTitle, Btn, Badge, Field, Input, Modal, Confirm, Donut, KpiCard, useApp, hasPerm,
  PageHead, Denied, EmptyState, SideTag
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
const FUND_TABS=['overview','bots','positions','settings'];
const FUND_TAB_LABEL_KEY={overview:'funds.overview',bots:'funds.bots',positions:'activity.positions',settings:'funds.settings'};
function FundsPage(){
  const {funds,user,data,reloadData,refreshTick,refreshMs,t}=useApp();
  const canManage=hasPerm(user,'manage_funds');
  const [modal,setModal]=useState(null); const [del,setDel]=useState(null);
  const [selId,setSelId]=useState(null);
  const [tab,setTab]=useState('overview');
  if(!hasPerm(user,'view_trades')) return <Denied/>;
  const sel=funds.find(f=>f.id===selId)||funds[0]||null;
  const selBots=sel? data.bots.filter(b=>b.fundId===sel.id) : [];
  const selOpen=selBots.filter(b=>b.status==='open');
  const selNotional=selOpen.reduce((s,b)=>s+Math.abs(b.notional||0),0);
  const selUpnl=selOpen.reduce((s,b)=>s+(b.unrealizedPnl||0),0);
  async function createFund(v){ await api('funds',{method:'POST',body:v}); await reloadData(); setModal(null); toast.success(t('funds.created')); }
  async function editFund(v){ await api('funds',{method:'PATCH',body:{id:modal.id,...v}}); await reloadData(); setModal(null); toast.success(t('funds.updated')); }
  async function removeFund(){ try{ await api('funds',{method:'DELETE',body:{id:del.id}}); await reloadData(); toast.success(t('funds.deleted')); }catch(e){ toast.error(e.message); } setDel(null); }

  const totalBots=funds.reduce((s,f)=>s+(f.botCount||0),0);
  const totalOpen=funds.reduce((s,f)=>s+(f.openCount||0),0);
  const allocFunds=(data.byFund||[]).filter(f=>f.id!=null&&f.notional>0);
  const allocTotal=allocFunds.reduce((s,f)=>s+f.notional,0);

  return <div>
    <PageHead title={t('funds.title')} subtitle={t('funds.subtitle')}
      refresh={{ms:refreshMs,tick:refreshTick}}
      actions={canManage&&<Btn onClick={()=>setModal({})}><Icon name="plus" className="w-4 h-4"/>{t('funds.newFund')}</Btn>}/>

    {funds.length>0&&<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      <KpiCard label={t('funds.activeFunds')} value={funds.length} icon="layers" accent="#C9A24D"/>
      <KpiCard label={t('positions.totalPositions')} value={totalBots} icon="briefcase" accent="#3B82F6"/>
      <KpiCard label={t('live.openPositions')} value={totalOpen} icon="trendup" accent="#10B981"/>
      <KpiCard label={t('activity.exposure')} value={fmtUSD(allocTotal)} icon="dollar" accent="#F59E0B"/>
    </div>}

    {allocFunds.length>0&&<Card className="p-5 mb-5">
      <SectionTitle>{t('activity.fundAllocation')}</SectionTitle>
      <div className="flex flex-wrap items-center gap-8">
        <Donut size={140} thickness={16}
          segments={allocFunds.map((f,i)=>({value:f.notional,color:f.color||FUND_PALETTE[i%FUND_PALETTE.length]}))}
          center={<div><div className="text-base font-bold text-navy tnum">{fmtUSD(allocTotal)}</div><div className="text-[10px] text-slate-400">{t('activity.exposure')}</div></div>}/>
        <div className="flex-1 min-w-[200px] space-y-1.5">
          {allocFunds.map((f,i)=><div key={f.id} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 min-w-0"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{background:f.color||FUND_PALETTE[i%FUND_PALETTE.length]}}/><span className="truncate text-navy font-medium">{f.name}</span></span>
            <span className="font-semibold text-navy tnum shrink-0">{(f.notional/allocTotal*100).toFixed(1)}%</span>
          </div>)}
        </div>
      </div>
    </Card>}

    {funds.length===0? <EmptyState icon="layers" title={t('funds.noFundsTitle')}
        hint={canManage?t('funds.noFundsHintAdmin'):t('funds.noFundsHintOther')}
        action={canManage&&<Btn onClick={()=>setModal({})}><Icon name="plus" className="w-4 h-4"/>{t('funds.createFund')}</Btn>}/>
    : <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Fund list — clicking a card selects it as the detail on the right */}
      <div className="space-y-3">
        {funds.map(f=><button key={f.id} onClick={()=>{setSelId(f.id);setTab('overview');}}
          className={`w-full text-left p-4 rounded-xl border transition ${sel&&sel.id===f.id?'bg-white border-2 shadow-sm':'bg-white/60 border-slate-200/80 hover:bg-white'}`}
          style={sel&&sel.id===f.id?{borderColor:f.color}:undefined}>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{background:f.color}}/>
            <span className="font-semibold text-navy truncate">{f.name}</span>
            {f.isEmployeeFund&&<span className="text-[10px] font-medium text-gold bg-gold/15 px-1.5 py-0.5 rounded-full shrink-0">{t('funds.employeeFund')}</span>}
          </div>
          <div className="flex items-center gap-4 mt-2.5 text-xs text-slate-500">
            <span>{t('funds.bots')} <span className="font-semibold text-navy tnum">{f.botCount}</span></span>
            <span>{t('funds.open')} <span className="font-semibold text-success tnum">{f.openCount}</span></span>
          </div>
        </button>)}
      </div>

      {/* Selected fund detail, organized into tabs (existing content only — Overview /
          Bots / Positions / Settings — no new data, just structured presentation) */}
      {sel&&<div className="lg:col-span-2">
        <Card className="p-5">
          <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-4 h-4 rounded-full shrink-0" style={{background:sel.color}}/>
              <h2 className="text-lg font-bold text-navy truncate">{sel.name}</h2>
              {sel.isEmployeeFund&&<span className="text-[10px] font-medium text-gold bg-gold/15 px-1.5 py-0.5 rounded-full shrink-0">{t('funds.employeeFund')}</span>}
            </div>
            {canManage&&<div className="flex gap-1 shrink-0">
              <button onClick={()=>setModal(sel)} className="text-slate-400 hover:text-navy p-1" data-tip="Edit"><Icon name="pencil" className="w-4 h-4"/></button>
              {!sel.isEmployeeFund&&<button onClick={()=>setDel(sel)} className="text-slate-400 hover:text-danger p-1" data-tip="Delete"><Icon name="trash" className="w-4 h-4"/></button>}
            </div>}
          </div>

          <div className="flex items-center gap-1 border-b border-slate-100 mb-4">
            {FUND_TABS.map(tb=><button key={tb} onClick={()=>setTab(tb)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab===tb?'border-gold text-navy':'border-transparent text-slate-400 hover:text-navy'}`}>
              {t(FUND_TAB_LABEL_KEY[tb])}
            </button>)}
          </div>

          {tab==='overview'&&<div>
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">{t('funds.bots')}</div><div className="text-lg font-bold text-navy tnum mt-0.5">{sel.botCount}</div></div>
              <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">{t('funds.open')}</div><div className="text-lg font-bold text-success tnum mt-0.5">{sel.openCount}</div></div>
              <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">{t('activity.openPnl')}</div><div className={`text-lg font-bold tnum mt-0.5 ${clsPnl(selUpnl)}`}>{fmtSigned(selUpnl)}</div></div>
            </div>
            <SectionTitle>{t('funds.allocationByBot')}</SectionTitle>
            {selOpen.length===0? <div className="h-[140px] grid place-items-center text-center text-sm text-slate-400">{t('funds.noBotsInFund')}</div>
            : <div className="flex flex-col sm:flex-row items-center gap-6">
              <Donut size={120} thickness={14} segments={selOpen.map((b,i)=>({value:Math.abs(b.notional||0),color:FUND_PALETTE[i%FUND_PALETTE.length]}))}
                center={<div><div className="text-sm font-bold text-navy tnum">{fmtUSD(selNotional)}</div><div className="text-[10px] text-slate-400">{t('activity.exposure')}</div></div>}/>
              <div className="flex-1 w-full space-y-1.5">
                {selOpen.map((b,i)=><div key={b.id} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 min-w-0"><span className="w-2 h-2 rounded-full shrink-0" style={{background:FUND_PALETTE[i%FUND_PALETTE.length]}}/><span className="truncate text-slate-600 font-mono">{b.symbol}</span></span>
                  <span className="font-medium text-navy tnum shrink-0">{selNotional?(Math.abs(b.notional||0)/selNotional*100).toFixed(1):'0.0'}%</span>
                </div>)}
              </div>
            </div>}
          </div>}

          {(tab==='bots'||tab==='positions')&&<div className="overflow-x-auto">
            {(()=>{ const list=tab==='positions'?selOpen:selBots; return list.length===0
              ? <div className="text-sm text-slate-400 py-6 text-center">{t('funds.noBotsInFund')}</div>
              : <table className="w-full text-sm">
                <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500 text-left">
                  <th className="px-3 py-2 font-medium">{t('activity.symbol')}</th>
                  <th className="px-3 py-2 font-medium">{t('activity.side')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('activity.openPnl')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('activity.notional')}</th>
                  <th className="px-3 py-2 font-medium">{t('positions.status')}</th>
                </tr></thead>
                <tbody>{list.map(b=><tr key={b.id} className="border-b border-slate-50">
                  <td className="px-3 py-2 font-mono text-xs text-navy">{b.symbol}</td>
                  <td className="px-3 py-2"><SideTag side={b.side}/></td>
                  <td className={`px-3 py-2 text-right tnum font-medium ${clsPnl(b.unrealizedPnl)}`}>{fmtSigned(b.unrealizedPnl)}</td>
                  <td className="px-3 py-2 text-right tnum text-slate-500">{fmtUSD(Math.abs(b.notional))}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 capitalize">{b.status}</td>
                </tr>)}</tbody>
              </table>; })()}
          </div>}

          {tab==='settings'&&<div className="max-w-sm space-y-4">
            <Field label={t('funds.name')}><div className="text-sm text-navy font-medium">{sel.name}</div></Field>
            <Field label={t('funds.colour')}><span className="inline-block w-6 h-6 rounded-full" style={{background:sel.color}}/></Field>
            {canManage&&<div className="flex gap-2 pt-2">
              <Btn variant="outline" onClick={()=>setModal(sel)}><Icon name="pencil" className="w-4 h-4"/>{t('common.edit')}</Btn>
              {!sel.isEmployeeFund&&<Btn variant="danger" onClick={()=>setDel(sel)}><Icon name="trash" className="w-4 h-4"/>{t('funds.deleteFundTitle')}</Btn>}
            </div>}
          </div>}
        </Card>
      </div>}
    </div>}
    <FundModal open={!!modal} initial={modal&&modal.id?modal:null} onClose={()=>setModal(null)} onSave={modal&&modal.id?editFund:createFund}/>
    <Confirm open={!!del} title={t('funds.deleteFundTitle')} confirmLabel={t('funds.deleteFundTitle')}
      message={t('funds.deleteFundConfirm',{name:del?.name,count:del?.botCount||0})}
      onCancel={()=>setDel(null)} onConfirm={removeFund}/>
  </div>;
}

export { FundsPage };
