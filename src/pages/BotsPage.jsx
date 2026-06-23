import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  fmtUSD, fmtSigned, fmtNum, clsPnl, fmtAgo, api, toast, Icon, Card, SectionTitle, Btn, StatusPill,
  Select, Confirm, useApp, PageHead, Denied, EmptyState, SideTag
} from '../ui.jsx'

/* ============================================================
   ADMIN — BOTS (auto-detected positions; assign to funds, sync)
   ============================================================ */
function BotsPage(){
  const {funds,user,data,reloadData}=useApp();
  const [syncing,setSyncing]=useState(false); const [del,setDel]=useState(null);
  if(user.role!=='admin') return <Denied/>;
  const fundOpts=[{value:'',label:'— Unassigned —'},...funds.map(f=>({value:f.id,label:f.name}))];

  async function assign(id,fundId){ try{ await api('bots',{method:'PATCH',body:{id,fundId:fundId||null}}); await reloadData(); }catch(e){ toast.error(e.message); } }
  async function removeBot(){ try{ await api('bots',{method:'DELETE',body:{id:del.id}}); await reloadData(); toast.success('Bot removed'); }catch(e){ toast.error(e.message); } setDel(null); }
  async function sync(){ setSyncing(true); try{ const r=await api('bots',{method:'POST',body:{action:'sync'}}); await reloadData(); if(r.errors){ toast.error((r.errorMsgs&&r.errorMsgs[0])||`${r.errors} exchange${r.errors===1?'':'s'} failed to sync`); } else if(!r.connected){ toast.error('No exchange connected — add a Binance key under Exchanges.'); } else { toast.success(`Synced — ${r.positions} position${r.positions===1?'':'s'}, ${r.created} new`); } }catch(e){ toast.error(e.message); } finally{ setSyncing(false); } }

  const bots=data.bots;
  const unassigned=bots.filter(b=>b.status==='open'&&!b.fundId);
  const lastSynced=data.live&&data.live.syncedAt? fmtAgo(data.live.syncedAt) : 'never';

  const Row=({b})=>{ return <tr className="border-b border-slate-50 hover:bg-slate-50/60">
    <td className="px-3 py-2.5 font-mono text-xs text-navy">{b.symbol}<div className="text-[10px] text-slate-400 capitalize">{b.exchange}</div></td>
    <td className="px-3 py-2.5"><SideTag side={b.side}/></td>
    <td className="px-3 py-2.5 text-right tnum text-slate-500">{fmtNum(b.qty,b.qty&&b.qty<1?4:2)}</td>
    <td className={`px-3 py-2.5 text-right font-medium tnum ${clsPnl(b.unrealizedPnl)}`}>{fmtSigned(b.unrealizedPnl)}</td>
    <td className="px-3 py-2.5 text-right tnum text-slate-500 hidden sm:table-cell">{fmtUSD(Math.abs(b.notional))}</td>
    <td className="px-3 py-2.5"><StatusPill status={b.status==='open'?'active':'inactive'}/></td>
    <td className="px-3 py-2.5"><Select className="w-40" value={b.fundId||''} onChange={v=>assign(b.id,v)} options={fundOpts}/></td>
    <td className="px-3 py-2.5 text-right"><button onClick={()=>setDel(b)} className="text-slate-300 hover:text-danger p-1" data-tip="Remove bot"><Icon name="trash" className="w-4 h-4"/></button></td>
  </tr>; };
  const head=<tr className="border-b border-slate-100 text-slate-500">
    <th className="px-3 py-2.5 text-left font-medium">Symbol</th><th className="px-3 py-2.5 text-left font-medium">Side</th>
    <th className="px-3 py-2.5 text-right font-medium">Qty</th><th className="px-3 py-2.5 text-right font-medium">Open PnL</th>
    <th className="px-3 py-2.5 text-right font-medium hidden sm:table-cell">Notional</th><th className="px-3 py-2.5 text-left font-medium">Status</th>
    <th className="px-3 py-2.5 text-left font-medium">Fund</th><th className="px-3 py-2.5 w-10"></th>
  </tr>;

  return <div>
    <PageHead title="Bots" subtitle="Auto-detected positions — assign each to a fund"
      actions={<div className="flex items-center gap-3">
        <span className="hidden sm:block text-xs text-slate-400">last synced {lastSynced}</span>
        <Btn onClick={sync} disabled={syncing}><Icon name="refresh" className={`w-4 h-4 ${syncing?'animate-spin':''}`}/>{syncing?'Syncing…':'Sync now'}</Btn>
      </div>}/>

    {bots.length===0? <EmptyState icon="list" title="No bots yet"
        hint="Bots appear automatically when a position is detected on a connected exchange. Add a Binance key under Exchanges, then Sync now."/>
    : <>
      {/* Unassigned inbox — needs attention */}
      {unassigned.length>0&&<Card className="overflow-hidden mb-5 border border-gold/30">
        <div className="p-4 pb-2 flex items-center gap-2"><Icon name="triangle" className="w-4 h-4 text-gold"/><span className="text-sm font-semibold text-navy">Unassigned positions</span><span className="text-[11px] text-slate-400">{unassigned.length} need a fund</span></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs">{head}</thead>
          <tbody>{unassigned.map(b=><Row key={b.id} b={b}/>)}</tbody>
        </table></div>
      </Card>}

      {/* All bots */}
      <Card className="overflow-hidden">
        <div className="p-5 pb-0"><SectionTitle right={<span className="text-[11px] text-slate-400">{bots.filter(b=>b.status==='open').length} open · {bots.filter(b=>b.status==='closed').length} closed</span>}>All Bots</SectionTitle></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs">{head}</thead>
          <tbody>{bots.map(b=><Row key={b.id} b={b}/>)}</tbody>
        </table></div>
      </Card>
    </>}

    <Confirm open={!!del} title="Remove bot" confirmLabel="Remove"
      message={`Remove ${del?.symbol} (${del?.exchange})? It will reappear on the next sync if the position is still open.`}
      onCancel={()=>setDel(null)} onConfirm={removeBot}/>
  </div>;
}

export { BotsPage };
