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
    <div className="space-y-4">
      {EDITABLE_ROLES.map(role=><Card key={role} className="p-5">
        <div className="font-semibold text-navy mb-3">{t('role.'+role)}</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {PERMISSIONS.map(([p])=><label key={p} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={(rolePerms[role]||[]).includes(p)} onChange={()=>toggle(role,p)} className="accent-navy w-4 h-4"/>{t('perm.'+p)}
          </label>)}
        </div>
      </Card>)}
    </div>
  </div>;
}
export { RulesPage };
