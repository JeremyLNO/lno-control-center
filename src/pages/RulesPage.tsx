import React from 'react'
const { useState, useEffect } = React;
import { PERMISSIONS, api, toast, Icon, Card, Btn, useApp, PageHead, Denied, Loader } from '../ui'

/* ============================================================
   ADMIN — RULES (role -> permission mapping)
   Permissions are granted per role, not per user (see api/_lib/rolePerms.js). Admin always
   has every permission and isn't shown as an editable row here.
   ============================================================ */
const EDITABLE_ROLES = ['operator', 'viewer', 'shareholder'];

function RulesPage(){
  const {user,t}=useApp();
  const [rolePerms,setRolePerms]=useState(null);
  const [saving,setSaving]=useState(false);
  const [dirty,setDirty]=useState(false);
  useEffect(()=>{ if(user.role!=='admin') return; api('users?rules=1').then(r=>setRolePerms(r.rolePerms)).catch(()=>{}); },[user.role]);
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
  return <div className="max-w-3xl">
    <PageHead title={t('rules.title')} subtitle={t('rules.subtitle')} actions={<Btn onClick={save} disabled={saving||!dirty}>{saving?t('rules.saving'):t('rules.saveChanges')}</Btn>}/>
    <Card className="p-5 mb-4">
      <div className="flex items-center gap-3 text-sm text-slate-600">
        <span className="w-9 h-9 rounded-lg bg-gold/15 text-gold grid place-items-center shrink-0"><Icon name="shield" className="w-5 h-5"/></span>
        <div>{t('rules.adminHint')}</div>
      </div>
    </Card>
    <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
      <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
        <th className="px-4 py-2.5 text-left font-medium">{t('rules.permission')}</th>
        {EDITABLE_ROLES.map(role=><th key={role} className="px-4 py-2.5 text-center font-medium">{t('role.'+role)}</th>)}
      </tr></thead>
      <tbody>
        {PERMISSIONS.map(([p])=><tr key={p} className="border-b border-slate-50 hover:bg-slate-50/60">
          <td className="px-4 py-2.5 text-navy">{t('perm.'+p)}</td>
          {EDITABLE_ROLES.map(role=><td key={role} className="px-4 py-2.5 text-center">
            <input type="checkbox" checked={(rolePerms[role]||[]).includes(p)} onChange={()=>toggle(role,p)} className="accent-navy w-4 h-4"/>
          </td>)}
        </tr>)}
      </tbody>
    </table></div></Card>
  </div>;
}
export { RulesPage };
