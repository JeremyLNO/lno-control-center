import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  fmtUSD, fmtSigned, fmtPct, fmtDate, fmtSeniority, clsPnl, initialsOf, api, Icon, Card, SectionTitle,
  KpiCard, useApp, PageHead, Denied
} from '../ui'

/* ============================================================
   MY EQUITY — an employee's share of the Employee Fund
   ============================================================ */
function MyEquityPage(){
  const {user}=useApp();
  const [data,setData]=useState(null);
  const [summary,setSummary]=useState(null);
  useEffect(()=>{
    if(user.role==='shareholder') return;
    api('funds?myEquity=1').then(setData).catch(()=>setData({fund:null,mine:null}));
    if(user.role==='admin') api('funds?employeeSummary=1').then(setSummary).catch(()=>setSummary(null));
  },[]);
  if(user.role==='shareholder') return <Denied/>;

  const mine=data&&data.mine;
  const gainPct=mine&&mine.contributedAmount? ((mine.currentValue-mine.contributedAmount)/mine.contributedAmount)*100 : null;

  return <div className="max-w-3xl">
    <PageHead title="My Equity" subtitle="Your share of the Employee Fund"/>

    {data===null? <Card className="p-8 text-center text-slate-400">Loading…</Card>
    : !mine? <Card className="p-8 text-center text-slate-400">Your Employee Fund share hasn't been set up yet — check back soon, or ask an admin.</Card>
    : <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard label="Current Value" value={fmtUSD(mine.currentValue)} icon="dollar"/>
        <KpiCard label="Contributed" value={fmtUSD(mine.contributedAmount)}/>
        <KpiCard label="Gain" value={<span className={clsPnl(gainPct)}>{gainPct==null?'—':fmtPct(gainPct)}</span>}/>
        <KpiCard label="Member Since" value={fmtDate(mine.joinedAt)} icon="clock"/>
      </div>
      <Card className="p-5">
        <SectionTitle>How this works</SectionTitle>
        <p className="text-sm text-slate-600">You were credited {fmtUSD(mine.contributedAmount)} in the Employee Fund on your join date. The fund then trades like any other — your value grows or shrinks in proportion to your share, currently {fmtUSD(data.fund.value)} in total across everyone in the fund.</p>
      </Card>
    </>}

    {user.role==='admin'&&<Card className="p-5 mt-5">
      <div className="flex items-center justify-between mb-1"><SectionTitle>Fund Summary (admin)</SectionTitle></div>
      {summary===null? <div className="text-sm text-slate-400">Loading…</div>
      : <>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Total Value</div><div className="text-lg font-bold text-navy mt-0.5">{fmtUSD(summary.value)}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Total Contributed</div><div className="text-lg font-bold text-navy mt-0.5">{fmtUSD(summary.totalContributed)}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Open PnL</div><div className={`text-lg font-bold mt-0.5 ${clsPnl(summary.openUPnl)}`}>{fmtSigned(summary.openUPnl)}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">NAV / Unit</div><div className="text-lg font-bold text-navy mt-0.5">{summary.navPerUnit.toFixed(4)}</div></div>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
            <th className="px-3 py-2.5 text-left font-medium">Employee</th>
            <th className="px-3 py-2.5 text-right font-medium">Contributed</th>
            <th className="px-3 py-2.5 text-right font-medium">Current Value</th>
            <th className="px-3 py-2.5 text-right font-medium">Gain</th>
            <th className="px-3 py-2.5 text-left font-medium">Joined</th>
            <th className="px-3 py-2.5 text-right font-medium">Seniority</th>
          </tr></thead>
          <tbody>{summary.employees.map(e=>{ const g=e.contributedAmount? ((e.currentValue-e.contributedAmount)/e.contributedAmount)*100 : null; return <tr key={e.userId} className="border-b border-slate-50">
            <td className="px-3 py-2.5"><span className="flex items-center gap-2">
              {e.avatar?<img src={e.avatar} className="w-6 h-6 rounded-full object-cover"/>:<span className="w-6 h-6 rounded-full bg-navy text-white grid place-items-center text-[10px] font-semibold shrink-0">{initialsOf(e)}</span>}
              <span className="text-navy">{(e.firstName||e.lastName)?`${e.firstName} ${e.lastName}`.trim():e.email}</span>
            </span></td>
            <td className="px-3 py-2.5 text-right tnum text-slate-500">{fmtUSD(e.contributedAmount)}</td>
            <td className="px-3 py-2.5 text-right font-medium tnum text-navy">{fmtUSD(e.currentValue)}</td>
            <td className={`px-3 py-2.5 text-right tnum ${clsPnl(g)}`}>{g==null?'—':fmtPct(g)}</td>
            <td className="px-3 py-2.5 text-slate-500">{fmtDate(e.joinedAt)}</td>
            <td className="px-3 py-2.5 text-right tnum text-slate-500">{fmtSeniority(e.joinedAt)}</td>
          </tr>; })}</tbody>
        </table></div>
      </>}
    </Card>}
  </div>;
}

export { MyEquityPage };
