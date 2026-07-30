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
const DECLARED_GROUPS = [
  {key:'dashboard', perms:['view_activity']},
  {key:'trading', perms:['view_realtime','view_trades']},
  {key:'analysis', perms:['manage_strategies','manage_comments']},
  {key:'reports', perms:['view_reports_daily','view_reports_weekly','view_reports_monthly','export_data']},
  {key:'exchanges', perms:['view_exchanges','manage_exchanges']},
  {key:'funds', perms:['manage_funds']},
  {key:'notifications', perms:['manage_whatsapp']},
  {key:'audit', perms:['view_audit']},
];
// Safety net: any permission that exists but was never assigned to a group above still gets
// rendered, in an "other" section. Grouping is cosmetic, but a permission MISSING from this
// page is not — it silently becomes ungrantable, which is exactly how manage_strategies and
// manage_comments shipped invisible. Derived from PERMISSIONS so the two cannot drift again.
const PERM_GROUPS = (() => {
  const grouped = new Set(DECLARED_GROUPS.flatMap(g => g.perms));
  const orphans = PERMISSIONS.map(p => p[0]).filter(p => !grouped.has(p));
  const groups = DECLARED_GROUPS.filter(g => g.perms.some(p => PERMISSIONS.some(x => x[0] === p)));
  return orphans.length ? [...groups, {key:'other', perms:orphans}] : groups;
})();
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
  const hasReport=(u,perm)=> u.role==='admin' || (rolePerms[u.role]||[]).includes(perm);
  // One row per person who receives at least one report — listing accounts that receive
  // nothing would just be the user list again. Plain computation, not useMemo: this sits
  // after the early returns above, where a hook would break the rules-of-hooks ordering.
  const recipients=(users||[])
    .filter(u=>u.active && REPORT_KINDS.some(({perm})=>hasReport(u,perm)))
    .sort((a,b)=>a.role.localeCompare(b.role)||String(a.email).localeCompare(String(b.email)));
  const nameOf=(u)=> (u.firstName||u.lastName)? `${u.firstName} ${u.lastName}`.trim() : u.email;

  return <div className="max-w-2xl">
    <PageHead title={t('rules.title')} subtitle={t('rules.subtitle')} actions={<Btn onClick={save} disabled={saving||!dirty}>{saving?t('rules.saving'):t('rules.saveChanges')}</Btn>}/>
    <Card className="p-5 mb-4">
      <div className="flex items-center gap-3 text-sm text-slate-600">
        <span className="w-9 h-9 rounded-lg bg-gold/15 text-gold grid place-items-center shrink-0"><Icon name="shield" className="w-5 h-5"/></span>
        <div>{t('rules.adminHint')}</div>
      </div>
    </Card>
    {/* No inner scroll — the whole matrix is always visible, the page itself scrolls. */}
    <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
      <thead className="text-xs"><tr className="bg-white border-b border-slate-200">
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

    <Card className="overflow-hidden mt-4">
      <div className="p-5 pb-3">
        <div className="text-sm font-semibold text-navy tracking-tight">{t('rules.distributionTitle')}</div>
        <p className="text-xs text-slate-400 mt-1">{t('rules.distributionHint')}</p>
      </div>
      {users===null? <div className="px-5 pb-5"><Loader/></div>
      : recipients.length===0? <div className="px-5 pb-5 text-sm text-slate-400">{t('rules.distributionNobody')}</div>
      : <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-xs"><tr className="border-b border-slate-200 text-slate-500">
          <th className="px-4 py-2.5 text-left font-medium">{t('equity.employee')}</th>
          <th className="px-4 py-2.5 text-left font-medium">{t('users.role')}</th>
          {REPORT_KINDS.map(({kind})=><th key={kind} className="px-4 py-2.5 text-center font-medium">{t('reports.kind'+kind.charAt(0).toUpperCase()+kind.slice(1))}</th>)}
          <th className="px-4 py-2.5 text-left font-medium">{t('rules.channels')}</th>
        </tr></thead>
        <tbody>
          {recipients.map(u=>{
            const wa=!!(u.notify&&u.phone);
            return <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50/60">
              <td className="px-4 py-2.5"><span className="flex items-center gap-2 min-w-0">
                {u.avatar? <img src={u.avatar} className="w-6 h-6 rounded-full object-cover shrink-0"/> : <span className="w-6 h-6 rounded-full bg-navy text-white grid place-items-center text-[10px] font-semibold shrink-0">{initialsOf(u)}</span>}
                <span className="text-navy truncate">{nameOf(u)}</span>
              </span></td>
              <td className="px-4 py-2.5 text-slate-500">{t('role.'+u.role)}</td>
              {REPORT_KINDS.map(({kind,perm})=><td key={kind} className="px-4 py-2.5 text-center">
                {hasReport(u,perm)? <Icon name="check" className="w-4 h-4 text-success inline"/> : <span className="text-slate-300">—</span>}
              </td>)}
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-1.5 text-slate-400" title={wa?`${t('rules.channelEmail')} + ${t('rules.channelWhatsApp')}`:t('rules.channelEmail')}>
                  <Icon name="mail" className="w-3.5 h-3.5"/>
                  {wa? <Icon name="msg" className="w-3.5 h-3.5 text-success"/> : <Icon name="msg" className="w-3.5 h-3.5 text-slate-200"/>}
                </span>
              </td>
            </tr>;
          })}
        </tbody>
      </table></div>}
    </Card>
  </div>;
}
export { RulesPage };
