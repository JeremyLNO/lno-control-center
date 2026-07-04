import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  fmtUSD, fmtSigned, fmtPct, fmtDate, fmtSeniority, clsPnl, initialsOf, api, Icon, Card, SectionTitle,
  StatusPill, KpiCard, useApp, PageHead, Denied, AreaChart, SortHeader, sortRows
} from '../ui'

const EMP_GETTERS = {
  name: e => ((e.firstName || e.lastName) ? `${e.firstName} ${e.lastName}`.trim() : e.email).toLowerCase(),
  contributed: e => e.contributedAmount,
  currentValue: e => e.currentValue,
  gain: e => e.contributedAmount ? ((e.currentValue - e.contributedAmount) / e.contributedAmount) * 100 : -Infinity,
  joined: e => +new Date(e.joinedAt),
  seniority: e => +new Date(e.joinedAt),
};

/* ============================================================
   MY EQUITY — an employee's share of the Employee Fund
   ============================================================ */
function MyEquityPage(){
  const {user,t}=useApp();
  const [data,setData]=useState(null); const [dataErr,setDataErr]=useState(null);
  const [summary,setSummary]=useState(null); const [summaryErr,setSummaryErr]=useState(null);
  const [empSort,setEmpSort]=useState({col:'joined',dir:'asc'});
  const [empQ,setEmpQ]=useState('');
  useEffect(()=>{
    if(user.role==='shareholder') return;
    api('funds?myEquity=1').then(setData).catch(e=>setDataErr(e.message||'Failed to load'));
    if(user.role==='admin') api('funds?employeeSummary=1').then(setSummary).catch(e=>setSummaryErr(e.message||'Failed to load'));
  },[]);
  if(user.role==='shareholder') return <Denied/>;

  const mine=data&&data.mine;
  const gainPct=mine&&mine.contributedAmount? ((mine.currentValue-mine.contributedAmount)/mine.contributedAmount)*100 : null;
  const weekly=data&&data.weekly;
  const weeklyPositive=weekly&&weekly.length>1?weekly[weekly.length-1].equity>=weekly[0].equity:true;

  let empRows=summary? summary.employees : [];
  if(empQ.trim()){ const q=empQ.trim().toLowerCase(); empRows=empRows.filter(e=>EMP_GETTERS.name(e).includes(q)||(e.email||'').toLowerCase().includes(q)); }
  empRows=summary? sortRows(empRows,empSort,EMP_GETTERS) : empRows;

  return <div className="max-w-3xl">
    <PageHead title={t('equity.title')} subtitle={t('equity.subtitle')}/>

    {dataErr? <Card className="p-8 text-center text-danger text-sm">{t('equity.loadErr',{err:dataErr})}</Card>
    : data===null? <Card className="p-8 text-center text-slate-400">{t('common.loading')}</Card>
    : !mine? <Card className="p-8 text-center text-slate-400">{t('equity.notSetUp')}</Card>
    : <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard label={t('equity.currentValue')} value={fmtUSD(mine.currentValue)} icon="dollar"/>
        <KpiCard label={t('equity.contributed')} value={fmtUSD(mine.contributedAmount)}/>
        <KpiCard label={t('equity.gain')} value={<span className={clsPnl(gainPct)}>{gainPct==null?'—':fmtPct(gainPct)}</span>}/>
        <KpiCard label={t('equity.memberSince')} value={fmtDate(mine.joinedAt)} icon="clock"/>
      </div>
      <Card className="p-5">
        <SectionTitle>{t('equity.howItWorks')}</SectionTitle>
        <p className="text-sm text-slate-600">{t('equity.howItWorksBody',{amount:fmtUSD(mine.contributedAmount),total:fmtUSD(data.fund.value)})}</p>
      </Card>

      <Card className="p-5 mt-5">
        <SectionTitle right={weekly&&weekly.length>1&&<span className={`text-sm font-semibold ${clsPnl(weekly[weekly.length-1].equity-weekly[0].equity)}`}>{fmtSigned(weekly[weekly.length-1].equity-weekly[0].equity)}</span>}>{t('equity.progressionWeekly')}</SectionTitle>
        {weekly&&weekly.length>1? <>
          <AreaChart data={weekly} positive={weeklyPositive} resetKey="my-equity-weekly"/>
          <div className="flex justify-between text-[11px] text-slate-400 mt-1"><span>{fmtDate(weekly[0].t)}</span><span>{fmtDate(weekly[weekly.length-1].t)}</span></div>
        </> : <div className="h-[180px] grid place-items-center text-center text-sm text-slate-400">{t('equity.notEnoughHistory')}</div>}
      </Card>
    </>}

    {user.role==='admin'&&<Card className="p-5 mt-5">
      <div className="flex items-center justify-between mb-1 gap-3 flex-wrap"><SectionTitle>{t('equity.fundSummaryAdmin')}</SectionTitle>
        {summary&&<div className="relative w-56"><Icon name="search" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"/><input value={empQ} onChange={e=>setEmpQ(e.target.value)} placeholder={t('equity.searchEmployee')} className="w-full bg-slate-100 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"/></div>}
      </div>
      {summaryErr? <div className="text-sm text-danger">{t('equity.summaryLoadErr',{err:summaryErr})}</div>
      : summary===null? <div className="text-sm text-slate-400">{t('common.loading')}</div>
      : <>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">{t('equity.totalValue')}</div><div className="text-lg font-bold text-navy mt-0.5">{fmtUSD(summary.value)}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">{t('equity.totalContributed')}</div><div className="text-lg font-bold text-navy mt-0.5">{fmtUSD(summary.totalContributed)}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">{t('activity.openPnl')}</div><div className={`text-lg font-bold mt-0.5 ${clsPnl(summary.openUPnl)}`}>{fmtSigned(summary.openUPnl)}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">{t('equity.navPerUnit')}</div><div className="text-lg font-bold text-navy mt-0.5">{summary.navPerUnit.toFixed(4)}</div></div>
        </div>
        {empRows.length===0? <div className="text-sm text-slate-400 py-4 text-center">{t('equity.noEmployeesMatch',{q:empQ})}</div>
        : <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
            <SortHeader label={t('equity.employee')} col="name" sort={empSort} setSort={setEmpSort}/>
            <SortHeader label={t('equity.contributed')} col="contributed" sort={empSort} setSort={setEmpSort} align="right"/>
            <SortHeader label={t('equity.currentValue')} col="currentValue" sort={empSort} setSort={setEmpSort} align="right"/>
            <SortHeader label={t('equity.gain')} col="gain" sort={empSort} setSort={setEmpSort} align="right"/>
            <SortHeader label={t('equity.joined')} col="joined" sort={empSort} setSort={setEmpSort}/>
            <SortHeader label={t('equity.seniority')} col="seniority" sort={empSort} setSort={setEmpSort} align="right"/>
          </tr></thead>
          <tbody>{empRows.map(e=>{ const g=e.contributedAmount? ((e.currentValue-e.contributedAmount)/e.contributedAmount)*100 : null; return <tr key={e.userId} className="border-b border-slate-50">
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
        </table></div>}
      </>}
    </Card>}

    {user.role==='admin'&&summary&&summary.notEnrolled.length>0&&<Card className="p-5 mt-5">
      <SectionTitle right={<span className="text-[11px] text-slate-400">{t(summary.notEnrolled.length===1?'equity.accountCountOne':'equity.accountCountMany',{n:summary.notEnrolled.length})}</span>}>{t('equity.notInFund')}</SectionTitle>
      <p className="text-xs text-slate-400 mb-3">{t('equity.notInFundHint')}</p>
      <div className="space-y-2">{summary.notEnrolled.map(u=><div key={u.userId} className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 min-w-0">
          {u.avatar?<img src={u.avatar} className="w-6 h-6 rounded-full object-cover"/>:<span className="w-6 h-6 rounded-full bg-navy text-white grid place-items-center text-[10px] font-semibold shrink-0">{initialsOf(u)}</span>}
          <span className="text-navy truncate">{(u.firstName||u.lastName)?`${u.firstName} ${u.lastName}`.trim():u.email}</span>
          <span className="text-xs text-slate-400 shrink-0">{t('role.'+u.role)}</span>
        </span>
        <StatusPill status={u.active?'active':'inactive'}/>
      </div>)}</div>
    </Card>}
  </div>;
}

export { MyEquityPage };
