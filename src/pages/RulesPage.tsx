import React from 'react'
const { useState, useEffect, useMemo } = React;
import { PERMISSIONS, api, toast, Icon, Card, Btn, useApp, PageHead, Denied, Loader, initialsOf } from '../ui'

/* ============================================================
   ADMIN — RULES (role -> permission mapping)
   Permissions are granted per role, not per user (see api/_lib/rolePerms.js). Admin always
   has every permission and isn't shown as an editable row here.
   ============================================================ */
const EDITABLE_ROLES = ['operator', 'viewer', 'shareholder'];
// Purely a presentational grouping (no permission/role logic changes) — organizes the flat
// PERMISSIONS list into the visual sections the redesign calls for.
const PERM_GROUPS = [
  {key:'dashboard', perms:['view_activity']},
  {key:'trading', perms:['view_realtime','view_trades']},
  {key:'reports', perms:['view_reports_daily','view_reports_weekly','view_reports_monthly','export_data']},
  {key:'exchanges', perms:['view_exchanges','manage_exchanges']},
  {key:'funds', perms:['manage_funds']},
  {key:'notifications', perms:['manage_whatsapp']},
  {key:'audit', perms:['view_audit']},
];
// The scheduled reports, and the permission that decides who receives each — the Rules page
// is the single source of truth for report distribution on every channel (see
// CONTENT_TYPE_PERM in api/_lib/notify.js), so the effective recipients belong here.
const REPORT_KINDS = [
  {kind:'daily', perm:'view_reports_daily'},
  {kind:'weekly', perm:'view_reports_weekly'},
  {kind:'monthly', perm:'view_reports_monthly'},
];

function RulesPage(){
  const {user,t}=useApp();
  const [rolePerms,setRolePerms]=useState(null);
  const [saving,setSaving]=useState(false);
  const [dirty,setDirty]=useState(false);
  // Real accounts, to turn the abstract role matrix into "these actual people get the
  // daily report" — the gap that let a viewer keep receiving reports unnoticed.
  const [users,setUsers]=useState(null);
  useEffect(()=>{ if(user.role!=='admin') return; api('users?rules=1').then(r=>setRolePerms(r.rolePerms)).catch(()=>{}); },[user.role]);
  useEffect(()=>{ if(user.role!=='admin') return; api('users').then(r=>setUsers(r.users||[])).catch(()=>setUsers([])); },[user.role]);
  if(user.role!=='admin') return <Denied/>;
  if(!rolePerms) return <div className="text-sm text-slate-400 py-10 text-center"><Loader/></div>;
  function toggle(role,perm){
    setRolePerms(rp=>{ const cur=rp[role]||[]; const next=cur.includes(perm)?cur.filter(p=>p!==perm):[...cur,perm]; return {...rp,[role]:next}; });
    setDirty(true);
  }
  async function save(){
    setSaving(true);
    try{ const r=await api('users',{method:'PUT',body:{rolePerms}}); setRolePerms(r.rolePerms); setDirty(false); toast.success(t('rules.saved')); }
    catch(e){ toast.error(e.message); }
    finally{ setSaving(false); }
  }
  const permLabel=(p)=>{ const found=PERMISSIONS.find(x=>x[0]===p); return found?t('perm.'+p):p; };
  // Effective recipients of each scheduled report, mirroring the backend exactly:
  // an active user receives it if their role holds the permission (admin implicitly holds
  // everything); WhatsApp additionally requires their own opt-in + a phone number. Reflects
  // the UNSAVED matrix above, so you see the consequence before clicking Save.
  const holders=(perm)=> (users||[]).filter(u=>u.active && (u.role==='admin' || (rolePerms[u.role]||[]).includes(perm)));
  const nameOf=(u)=> (u.firstName||u.lastName)? `${u.firstName} ${u.lastName}`.trim() : u.email;

  return <div className="max-w-2xl">
    <PageHead title={t('rules.title')} subtitle={t('rules.subtitle')} actions={<Btn onClick={save} disabled={saving||!dirty}>{saving?t('rules.saving'):t('rules.saveChanges')}</Btn>}/>
    <Card className="p-5 mb-4">
      <div className="flex items-center gap-3 text-sm text-slate-600">
        <span className="w-9 h-9 rounded-lg bg-gold/15 text-gold grid place-items-center shrink-0"><Icon name="shield" className="w-5 h-5"/></span>
        <div>{t('rules.adminHint')}</div>
      </div>
    </Card>
    <Card className="overflow-hidden"><div className="overflow-x-auto max-h-[70vh] overflow-y-auto"><table className="w-full text-sm">
      <thead className="text-xs sticky top-0 z-10"><tr className="bg-white border-b border-slate-200 shadow-sm">
        <th className="px-4 py-2.5 text-left font-medium text-slate-500 w-1/2">{t('rules.permission')}</th>
        {EDITABLE_ROLES.map(role=><th key={role} className="px-4 py-2.5 text-center font-medium text-slate-500">{t('role.'+role)}</th>)}
      </tr></thead>
      <tbody>
        {PERM_GROUPS.map(g=><React.Fragment key={g.key}>
          <tr className="bg-slate-50/80"><td colSpan={1+EDITABLE_ROLES.length} className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t('rules.group.'+g.key)}</td></tr>
          {g.perms.map(p=><tr key={p} className="border-b border-slate-50 hover:bg-slate-50/60">
            <td className="px-4 py-3 text-navy">{permLabel(p)}</td>
            {EDITABLE_ROLES.map(role=><td key={role} className="px-4 py-3 text-center">
              <input type="checkbox" checked={(rolePerms[role]||[]).includes(p)} onChange={()=>toggle(role,p)} className="accent-navy w-4 h-4"/>
            </td>)}
          </tr>)}
        </React.Fragment>)}
      </tbody>
    </table></div></Card>

    <Card className="p-5 mt-4">
      <div className="mb-1 text-sm font-semibold text-navy tracking-tight">{t('rules.distributionTitle')}</div>
      <p className="text-xs text-slate-400 mb-4">{t('rules.distributionHint')}</p>
      {users===null? <Loader/>
      : <div className="space-y-4">
        {REPORT_KINDS.map(({kind,perm})=>{
          const list=holders(perm);
          return <div key={kind}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-navy">{t('reports.kind'+kind.charAt(0).toUpperCase()+kind.slice(1))}</span>
              <span className="text-[11px] text-slate-400">{list.length}</span>
            </div>
            {list.length===0? <div className="text-xs text-slate-400 pl-0.5">{t('rules.distributionNobody')}</div>
            : <div className="flex flex-wrap gap-1.5">
              {list.map(u=>{
                const wa=!!(u.notify&&u.phone);
                return <span key={u.id} className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200/70 rounded-full pl-1 pr-2.5 py-1">
                  {u.avatar? <img src={u.avatar} className="w-5 h-5 rounded-full object-cover"/> : <span className="w-5 h-5 rounded-full bg-navy text-white grid place-items-center text-[9px] font-semibold">{initialsOf(u)}</span>}
                  <span className="text-xs text-navy">{nameOf(u)}</span>
                  <span className="flex items-center gap-1 text-slate-400" title={wa?`${t('rules.channelEmail')} + ${t('rules.channelWhatsApp')}`:t('rules.channelEmail')}>
                    <Icon name="mail" className="w-3 h-3"/>
                    {wa&&<Icon name="msg" className="w-3 h-3 text-success"/>}
                  </span>
                </span>;
              })}
            </div>}
          </div>;
        })}
      </div>}
    </Card>
  </div>;
}
export { RulesPage };
