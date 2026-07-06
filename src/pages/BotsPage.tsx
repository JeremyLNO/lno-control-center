import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  fmtUSD, fmtSigned, fmtNum, fmtPctPlain, clsPnl, fmtAgo, api, toast, Icon, Card, SectionTitle, Btn, StatusPill,
  Select, Confirm, useApp, fundOf, attrStats, PageHead, Denied, EmptyState, SideTag
} from '../ui'

/* ============================================================
   ADMIN — BOTS (auto-detected positions; assign to funds, sync)
   ============================================================ */
function BotsPage(){
  const {funds,user,data,reloadData,refreshTick,refreshMs,t}=useApp();
  const [syncing,setSyncing]=useState(false); const [del,setDel]=useState(null);
  const [attr,setAttr]=useState(null); const [costs,setCosts]=useState(null);
  useEffect(()=>{ if(user.role!=='admin')return; api('bots?attribution=1').then(setAttr).catch(()=>setAttr({perSymbol:[],perFund:[]})); api('bots?costs=1').then(setCosts).catch(()=>setCosts({perSymbol:[],perFund:[]})); },[]);
  if(user.role!=='admin') return <Denied/>;
  const fundOpts=[{value:'',label:t('bots.unassignedOption')},...funds.map(f=>({value:f.id,label:f.name}))];

  async function assign(id,fundId){ try{ await api('bots',{method:'PATCH',body:{id,fundId:fundId||null}}); await reloadData(); }catch(e){ toast.error(e.message); } }
  async function removeBot(){ try{ await api('bots',{method:'DELETE',body:{id:del.id}}); await reloadData(); toast.success(t('bots.removed')); }catch(e){ toast.error(e.message); } setDel(null); }
  async function sync(){ setSyncing(true); try{ const r=await api('bots',{method:'POST',body:{action:'sync'}}); await reloadData(); if(r.errors){ toast.error((r.errorMsgs&&r.errorMsgs[0])||t(r.errors===1?'bots.syncFailedOne':'bots.syncFailedMany',{n:r.errors})); } else if(!r.connected){ toast.error(t('bots.noExchangeConnectedHint')); } else { toast.success(t(r.positions===1?'bots.syncedResultOne':'bots.syncedResultMany',{n:r.positions,created:r.created})); } }catch(e){ toast.error(e.message); } finally{ setSyncing(false); } }

  const bots=data.bots;
  const unassigned=bots.filter(b=>b.status==='open'&&!b.fundId);
  const lastSynced=data.live&&data.live.syncedAt? fmtAgo(data.live.syncedAt) : t('live.never');

  const Row = ({b}: any) =>{ return <tr className="border-b border-slate-50 hover:bg-slate-50/60">
    <td className="px-3 py-2.5 font-mono text-xs text-navy">{b.symbol}<div className="text-[10px] text-slate-400 capitalize">{b.exchange}</div></td>
    <td className="px-3 py-2.5"><SideTag side={b.side}/></td>
    <td className="px-3 py-2.5 text-right tnum text-slate-500">{fmtNum(b.qty,b.qty&&b.qty<1?4:2)}</td>
    <td className={`px-3 py-2.5 text-right font-medium tnum ${clsPnl(b.unrealizedPnl)}`}>{fmtSigned(b.unrealizedPnl)}</td>
    <td className="px-3 py-2.5 text-right tnum text-slate-500 hidden sm:table-cell">{fmtUSD(Math.abs(b.notional))}</td>
    <td className="px-3 py-2.5"><StatusPill status={b.status==='open'?'active':'inactive'}/></td>
    <td className="px-3 py-2.5"><Select className="w-40" value={b.fundId||''} onChange={v=>assign(b.id,v)} options={fundOpts}/></td>
    <td className="px-3 py-2.5 text-right"><button onClick={()=>setDel(b)} className="text-slate-300 hover:text-danger p-1" data-tip={t('bots.removeBot')}><Icon name="trash" className="w-4 h-4"/></button></td>
  </tr>; };
  const head=<tr className="border-b border-slate-100 text-slate-500">
    <th className="px-3 py-2.5 text-left font-medium">{t('activity.symbol')}</th><th className="px-3 py-2.5 text-left font-medium">{t('activity.side')}</th>
    <th className="px-3 py-2.5 text-right font-medium">{t('live.qty')}</th><th className="px-3 py-2.5 text-right font-medium">{t('activity.openPnl')}</th>
    <th className="px-3 py-2.5 text-right font-medium hidden sm:table-cell">{t('activity.notional')}</th><th className="px-3 py-2.5 text-left font-medium">{t('positions.status')}</th>
    <th className="px-3 py-2.5 text-left font-medium">{t('activity.fund')}</th><th className="px-3 py-2.5 w-10"></th>
  </tr>;

  return <div>
    <PageHead title={t('bots.title')} subtitle={t('bots.subtitle')}
      refresh={{ms:refreshMs,tick:refreshTick}}
      actions={<div className="flex items-center gap-3">
        <span className="hidden sm:block text-xs text-slate-400">{t('bots.lastSynced',{ago:lastSynced})}</span>
        <Btn onClick={sync} disabled={syncing}><Icon name="refresh" className={`w-4 h-4 ${syncing?'animate-spin':''}`}/>{syncing?t('bots.syncing'):t('bots.syncNow')}</Btn>
      </div>}/>

    {bots.length===0? <EmptyState icon="list" title={t('bots.noBotsTitle')}
        hint={t('bots.noBotsHint')}/>
    : <>
      {/* Unassigned inbox — needs attention */}
      {unassigned.length>0&&<Card className="overflow-hidden mb-5 border border-gold/30">
        <div className="p-4 pb-2 flex items-center gap-2"><Icon name="triangle" className="w-4 h-4 text-gold"/><span className="text-sm font-semibold text-navy">{t('bots.unassignedPositions')}</span><span className="text-[11px] text-slate-400">{t(unassigned.length===1?'bots.needFundOne':'bots.needFundMany',{n:unassigned.length})}</span></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs">{head}</thead>
          <tbody>{unassigned.map(b=><Row key={b.id} b={b}/>)}</tbody>
        </table></div>
      </Card>}

      {/* All bots */}
      <Card className="overflow-hidden">
        <div className="p-5 pb-0"><SectionTitle right={<span className="text-[11px] text-slate-400">{t('bots.openClosedCount',{open:bots.filter(b=>b.status==='open').length,closed:bots.filter(b=>b.status==='closed').length})}</span>}>{t('bots.allBots')}</SectionTitle></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs">{head}</thead>
          <tbody>{bots.map(b=><Row key={b.id} b={b}/>)}</tbody>
        </table></div>
      </Card>
    </>}

    {/* Performance attribution — realized PnL only (win rate/profit factor need closed
        trades; a currently-open position's unrealized PnL isn't a win or loss yet) */}
    <Card className="overflow-hidden mt-5">
      <div className="p-5 pb-0"><SectionTitle right={<span className="text-[11px] text-slate-400">{t('bots.fromRealizedPnl')}</span>}>{t('bots.perfByFund')}</SectionTitle></div>
      {attr===null? <div className="p-5 text-sm text-slate-400">{t('common.loading')}</div>
      : attr.perFund.length===0? <div className="p-5 text-sm text-slate-400">{t('bots.noClosedTrades')}</div>
      : <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
            <th className="px-3 py-2.5 text-left font-medium">{t('activity.fund')}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t('bots.trades')}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t('bots.winRate')}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t('bots.netPnl')}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t('bots.contribution')}</th>
          </tr></thead>
          <tbody>{attr.perFund.map(f=>{ const s=attrStats(f); const fund=f.fundId&&funds.find(x=>x.id===f.fundId); return <tr key={f.fundId||'unassigned'} className="border-b border-slate-50">
            <td className="px-3 py-2.5">{fund?fund.name:t('live.unassigned')}</td>
            <td className="px-3 py-2.5 text-right tnum text-slate-500">{f.trades}</td>
            <td className="px-3 py-2.5 text-right tnum text-slate-500">{s.winRate==null?'—':s.winRate.toFixed(0)+'%'}</td>
            <td className={`px-3 py-2.5 text-right font-medium tnum ${clsPnl(f.netPnl)}`}>{fmtSigned(f.netPnl)}</td>
            <td className="px-3 py-2.5 text-right tnum text-slate-500">{f.contributionPct==null?'—':fmtPctPlain(f.contributionPct)}</td>
          </tr>; })}</tbody>
        </table></div>}
    </Card>

    <Card className="overflow-hidden mt-5">
      <div className="p-5 pb-0"><SectionTitle right={<span className="text-[11px] text-slate-400">{t('bots.fromRealizedPnl')}</span>}>{t('bots.perfByBot')}</SectionTitle></div>
      {attr===null? <div className="p-5 text-sm text-slate-400">{t('common.loading')}</div>
      : attr.perSymbol.length===0? <div className="p-5 text-sm text-slate-400">{t('bots.noClosedTrades')}</div>
      : <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
            <th className="px-3 py-2.5 text-left font-medium">{t('activity.symbol')}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t('bots.trades')}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t('bots.winRate')}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t('bots.profitFactor')}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t('bots.avgWin')}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t('bots.avgLoss')}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t('bots.netPnl')}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t('bots.contribution')}</th>
          </tr></thead>
          <tbody>{attr.perSymbol.map(s=>{ const st=attrStats(s); return <tr key={s.symbol} className="border-b border-slate-50">
            <td className="px-3 py-2.5 font-mono text-xs text-navy">{s.symbol}</td>
            <td className="px-3 py-2.5 text-right tnum text-slate-500">{s.trades}</td>
            <td className="px-3 py-2.5 text-right tnum text-slate-500">{st.winRate==null?'—':st.winRate.toFixed(0)+'%'}</td>
            <td className="px-3 py-2.5 text-right tnum text-slate-500">{st.profitFactor==null?'—':st.profitFactor===Infinity?'∞':st.profitFactor.toFixed(2)}</td>
            <td className="px-3 py-2.5 text-right tnum text-success">{st.avgWin==null?'—':fmtSigned(st.avgWin)}</td>
            <td className="px-3 py-2.5 text-right tnum text-danger">{st.avgLoss==null?'—':fmtSigned(st.avgLoss)}</td>
            <td className={`px-3 py-2.5 text-right font-medium tnum ${clsPnl(s.netPnl)}`}>{fmtSigned(s.netPnl)}</td>
            <td className="px-3 py-2.5 text-right tnum text-slate-500">{s.contributionPct==null?'—':fmtPctPlain(s.contributionPct)}</td>
          </tr>; })}</tbody>
        </table></div>}
    </Card>

    {/* Funding & fee drag — same income_events ledger, FUNDING_FEE + COMMISSION types.
        Shows the "cost" side that a profitable-looking strategy can still bleed through. */}
    <Card className="overflow-hidden mt-5">
      <div className="p-5 pb-0"><SectionTitle right={<span className="text-[11px] text-slate-400">{t('bots.fundingCommissions')}</span>}>{t('bots.fundingFeeDragByFund')}</SectionTitle></div>
      {costs===null? <div className="p-5 text-sm text-slate-400">{t('common.loading')}</div>
      : costs.perFund.length===0? <div className="p-5 text-sm text-slate-400">{t('bots.noFundingHistory')}</div>
      : <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
            <th className="px-3 py-2.5 text-left font-medium">{t('activity.fund')}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t('bots.funding')}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t('bots.commission')}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t('bots.totalDrag')}</th>
          </tr></thead>
          <tbody>{costs.perFund.map(f=>{ const fund=f.fundId&&funds.find(x=>x.id===f.fundId); return <tr key={f.fundId||'unassigned'} className="border-b border-slate-50">
            <td className="px-3 py-2.5">{fund?fund.name:t('live.unassigned')}</td>
            <td className={`px-3 py-2.5 text-right tnum ${clsPnl(f.funding)}`}>{fmtSigned(f.funding)}</td>
            <td className="px-3 py-2.5 text-right tnum text-danger">{fmtSigned(f.commission)}</td>
            <td className={`px-3 py-2.5 text-right font-medium tnum ${clsPnl(f.totalCost)}`}>{fmtSigned(f.totalCost)}</td>
          </tr>; })}</tbody>
        </table></div>}
    </Card>

    <Card className="overflow-hidden mt-5">
      <div className="p-5 pb-0"><SectionTitle right={<span className="text-[11px] text-slate-400">{t('bots.fundingCommissions')}</span>}>{t('bots.fundingFeeDragByBot')}</SectionTitle></div>
      {costs===null? <div className="p-5 text-sm text-slate-400">{t('common.loading')}</div>
      : costs.perSymbol.length===0? <div className="p-5 text-sm text-slate-400">{t('bots.noFundingHistory')}</div>
      : <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
            <th className="px-3 py-2.5 text-left font-medium">{t('activity.symbol')}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t('bots.funding')}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t('bots.commission')}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t('bots.totalDrag')}</th>
          </tr></thead>
          <tbody>{costs.perSymbol.map(s=><tr key={s.symbol} className="border-b border-slate-50">
            <td className="px-3 py-2.5 font-mono text-xs text-navy">{s.symbol}</td>
            <td className={`px-3 py-2.5 text-right tnum ${clsPnl(s.funding)}`}>{fmtSigned(s.funding)}</td>
            <td className="px-3 py-2.5 text-right tnum text-danger">{fmtSigned(s.commission)}</td>
            <td className={`px-3 py-2.5 text-right font-medium tnum ${clsPnl(s.totalCost)}`}>{fmtSigned(s.totalCost)}</td>
          </tr>)}</tbody>
        </table></div>}
    </Card>

    <Confirm open={!!del} title={t('bots.removeBotTitle')} confirmLabel={t('bots.removeBot')}
      message={t('bots.removeConfirm',{symbol:del?.symbol,exchange:del?.exchange})}
      onCancel={()=>setDel(null)} onConfirm={removeBot}/>
  </div>;
}

export { BotsPage };
