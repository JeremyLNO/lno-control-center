import React from 'react'
const { useState, useEffect } = React;
import {
  fmtUSD, fmtSigned, fmtPct, fmtDate, fmtSeniority, clsPnl, initialsOf, api, toast, Icon, Card, SectionTitle,
  StatusPill, Select, Btn, useApp, PageHead, Denied, SortHeader, sortRows, Loader
} from '../ui'

const EMP_GETTERS = {
  name: e => ((e.firstName || e.lastName) ? `${e.firstName} ${e.lastName}`.trim() : e.email).toLowerCase(),
  contributed: e => e.contributedAmount,
  currentValue: e => e.currentValue,
  gain: e => e.contributedAmount ? ((e.currentValue - e.contributedAmount) / e.contributedAmount) * 100 : -Infinity,
  joined: e => +new Date(e.joinedAt),
  seniority: e => +new Date(e.joinedAt),
};
const NOT_ENROLLED_GETTERS = {
  name: u => ((u.firstName || u.lastName) ? `${u.firstName} ${u.lastName}`.trim() : u.email).toLowerCase(),
  role: u => u.role,
  status: u => u.active ? 1 : 0,
};

/* ============================================================
   EMPLOYEE FUND — admin view: global summary, per-employee allocations
   (sortable), accounts not yet linked to the fund (sortable). Shareholders
   never appear here — the fund is staff-only (see api/_lib/employeeFund.js).
   ============================================================ */
function EmployeeFundPage(){
  const {user,t}=useApp();
  const [summary,setSummary]=useState(null); const [summaryErr,setSummaryErr]=useState(null);
  const [empSort,setEmpSort]=useState({col:'joined',dir:'asc'});
  const [neSort,setNeSort]=useState({col:'name',dir:'asc'});
  const [empQ,setEmpQ]=useState('');
  const [assignSel,setAssignSel]=useState({});
  const [assigning,setAssigning]=useState(null);
  const loadSummary=()=>api('funds?employeeSummary=1').then(setSummary).catch(e=>setSummaryErr(e.message||'Failed to load'));
  useEffect(()=>{ if(user.role==='admin') loadSummary(); },[]);
  if(user.role!=='admin') return <Denied/>;

  async function doAssign(contributionId){
    const userId=assignSel[contributionId]; if(!userId) return;
    setAssigning(contributionId);
    try{
      const r=await api('funds',{method:'POST',body:{action:'assignEmployeeContribution',contributionId,userId}});
      setSummary(r);
      setAssignSel(s=>{ const n={...s}; delete n[contributionId]; return n; });
      const target=(r.employees||[]).find(e=>e.userId===userId);
      const name=target?((target.firstName||target.lastName)?`${target.firstName} ${target.lastName}`.trim():target.email):'';
      toast.success(t('equity.assignedOk',{name}));
    }catch(e){ toast.error(e.message); } finally{ setAssigning(null); }
  }

  let empRows=summary? summary.employees : [];
  if(empQ.trim()){ const q=empQ.trim().toLowerCase(); empRows=empRows.filter(e=>EMP_GETTERS.name(e).includes(q)||(e.email||'').toLowerCase().includes(q)); }
  empRows=summary? sortRows(empRows,empSort,EMP_GETTERS) : empRows;
  const neRows=summary? sortRows(summary.notEnrolled,neSort,NOT_ENROLLED_GETTERS) : [];

  const nameOf=(p)=> (p.firstName||p.lastName)? `${p.firstName} ${p.lastName}`.trim() : p.email;
  const assigneeOpts=summary? [
    ...summary.notEnrolled.map(u=>({value:u.userId,label:`${nameOf(u)} (${t('role.'+u.role)})`})),
    ...summary.employees.map(e=>({value:e.userId,label:`${nameOf(e)} (${t('role.'+e.role)})`})),
  ] : [];

  return <div className="max-w-3xl">
    <PageHead title={t('employeeFund.title')} subtitle={t('employeeFund.subtitle')}/>

    {summary&&<Card className="p-5 mb-5">
      <SectionTitle right={summary.pendingContributions.length>0&&<span className="text-[11px] text-slate-400">{summary.pendingContributions.length}</span>}>{t('equity.pendingContributionsTitle')}</SectionTitle>
      <p className="text-xs text-slate-400 mb-3">{t('equity.pendingContributionsHint')}</p>
      {summary.pendingContributions.length===0? <div className="text-sm text-slate-400 py-2">{t('equity.noPendingContributions')}</div>
      : <div className="space-y-2">{summary.pendingContributions.map(c=><div key={c.id} className="flex items-center gap-2 flex-wrap text-sm border border-slate-100 rounded-lg p-2.5">
          <span className="font-semibold text-navy tnum shrink-0">{fmtUSD(c.amount)}</span>
          <span className="text-xs text-slate-400 shrink-0">{t('equity.detectedOn',{date:fmtDate(c.detectedAt)})}</span>
          <div className="flex-1 min-w-[180px]"><Select value={assignSel[c.id]||''} onChange={v=>setAssignSel(s=>({...s,[c.id]:v}))} options={[{value:'',label:t('equity.assignTo')},...assigneeOpts]}/></div>
          <Btn size="sm" onClick={()=>doAssign(c.id)} disabled={!assignSel[c.id]||assigning===c.id}>{assigning===c.id?t('equity.assigning'):t('equity.assign')}</Btn>
        </div>)}</div>}
    </Card>}

    <Card className="p-5">
      <div className="flex items-center justify-between mb-1 gap-3 flex-wrap"><SectionTitle>{t('employeeFund.summaryTitle')}</SectionTitle>
        {summary&&<div className="relative w-56"><Icon name="search" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"/><input value={empQ} onChange={e=>setEmpQ(e.target.value)} placeholder={t('equity.searchEmployee')} className="w-full bg-slate-100 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"/></div>}
      </div>
      {summaryErr? <div className="text-sm text-danger">{t('equity.summaryLoadErr',{err:summaryErr})}</div>
      : summary===null? <Loader/>
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
    </Card>

    {summary&&summary.notEnrolled.length>0&&<Card className="p-5 mt-5">
      <SectionTitle right={<span className="text-[11px] text-slate-400">{t(summary.notEnrolled.length===1?'equity.accountCountOne':'equity.accountCountMany',{n:summary.notEnrolled.length})}</span>}>{t('equity.notInFund')}</SectionTitle>
      <p className="text-xs text-slate-400 mb-3">{t('equity.notInFundHint')}</p>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
          <SortHeader label={t('equity.employee')} col="name" sort={neSort} setSort={setNeSort}/>
          <SortHeader label={t('users.role')} col="role" sort={neSort} setSort={setNeSort}/>
          <SortHeader label={t('users.active')} col="status" sort={neSort} setSort={setNeSort}/>
        </tr></thead>
        <tbody>{neRows.map(u=><tr key={u.userId} className="border-b border-slate-50">
          <td className="px-3 py-2.5"><span className="flex items-center gap-2 min-w-0">
            {u.avatar?<img src={u.avatar} className="w-6 h-6 rounded-full object-cover"/>:<span className="w-6 h-6 rounded-full bg-navy text-white grid place-items-center text-[10px] font-semibold shrink-0">{initialsOf(u)}</span>}
            <span className="text-navy truncate">{(u.firstName||u.lastName)?`${u.firstName} ${u.lastName}`.trim():u.email}</span>
          </span></td>
          <td className="px-3 py-2.5 text-slate-500">{t('role.'+u.role)}</td>
          <td className="px-3 py-2.5"><StatusPill status={u.active?'active':'inactive'}/></td>
        </tr>)}</tbody>
      </table></div>
    </Card>}
  </div>;
}

export { EmployeeFundPage };
