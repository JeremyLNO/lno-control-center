import React from 'react'
const { useState, useEffect } = React;
import {
  fmtUSD, fmtSigned, fmtPct, fmtDate, clsPnl, api, Card, SectionTitle,
  KpiCard, useApp, PageHead, Denied, AreaChart, Loader
} from '../ui'

/* ============================================================
   MY EQUITY — an employee's own share of the Employee Fund. The admin-facing
   fund summary/allocations/pending-contributions view lives on its own page
   (see EmployeeFundPage.tsx) — this page is purely the employee's view.
   ============================================================ */
function MyEquityPage(){
  const {user,t}=useApp();
  const [data,setData]=useState(null); const [dataErr,setDataErr]=useState(null);
  useEffect(()=>{
    if(user.role==='shareholder') return;
    api('funds?myEquity=1').then(setData).catch(e=>setDataErr(e.message||'Failed to load'));
  },[]);
  if(user.role==='shareholder') return <Denied/>;

  const mine=data&&data.mine;
  const gainPct=mine&&mine.contributedAmount? ((mine.currentValue-mine.contributedAmount)/mine.contributedAmount)*100 : null;
  const weekly=data&&data.weekly;
  const weeklyPositive=weekly&&weekly.length>1?weekly[weekly.length-1].equity>=weekly[0].equity:true;

  return <div className="max-w-4xl mx-auto">
    <PageHead title={t('equity.title')} subtitle={t('equity.subtitle')}/>

    {dataErr? <Card className="p-8 text-center text-danger text-sm">{t('equity.loadErr',{err:dataErr})}</Card>
    : data===null? <Card className="p-8"><Loader/></Card>
    : !mine? <Card className="p-8 text-center text-slate-400">{t('equity.notSetUp')}</Card>
    : <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard label={t('equity.currentValue')} value={fmtUSD(mine.currentValue)} icon="dollar"/>
        <KpiCard label={t('equity.contributed')} value={fmtUSD(mine.contributedAmount)}/>
        <KpiCard label={t('equity.gain')} value={<span className={clsPnl(gainPct)}>{gainPct==null?'—':fmtPct(gainPct)}</span>}/>
        <KpiCard label={t('equity.memberSince')} value={fmtDate(mine.joinedAt)} icon="clock"/>
      </div>

      <Card className="p-5">
        <SectionTitle right={weekly&&weekly.length>1&&<span className={`text-sm font-semibold ${clsPnl(weekly[weekly.length-1].equity-weekly[0].equity)}`}>{fmtSigned(weekly[weekly.length-1].equity-weekly[0].equity)}</span>}>{t('equity.progressionWeekly')}</SectionTitle>
        {weekly&&weekly.length>1? <>
          <AreaChart data={weekly} positive={weeklyPositive} resetKey="my-equity-weekly"/>
          <div className="flex justify-between text-[11px] text-slate-400 mt-1"><span>{fmtDate(weekly[0].t)}</span><span>{fmtDate(weekly[weekly.length-1].t)}</span></div>
        </> : <div className="h-[180px] grid place-items-center text-center text-sm text-slate-400">{t('equity.notEnoughHistory')}</div>}
      </Card>

      <Card className="p-4 mt-4 bg-slate-50/60 border-slate-200/60">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">{t('equity.howItWorks')}</div>
        <p className="text-xs text-slate-500 leading-relaxed">{t('equity.howItWorksBody',{amount:fmtUSD(mine.contributedAmount),total:fmtUSD(data.fund.value)})}</p>
      </Card>
    </>}
  </div>;
}

export { MyEquityPage };
