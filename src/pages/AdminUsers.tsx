import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  ROLE_OPTIONS, fmtDT, initialsOf, api, toast, Icon, Card, Btn, Badge,
  StatusPill, Toggle, Select, Field, Input, ExportMenu, Modal, Confirm, useApp, PageHead, Denied, PW_RULES,
  passwordOk, Loader
} from '../ui'

/* ============================================================
   ADMIN — USERS
   ============================================================ */
// Recent sign-in audit for one user (timestamp · method · IP), loaded on expand.
function UserLoginHistory({userId}: any){
  const {t}=useApp();
  const [rows,setRows]=useState(null);
  useEffect(()=>{ let alive=true; api('users?logins='+encodeURIComponent(userId)).then(r=>{ if(alive)setRows(r.logins||[]); }).catch(()=>{ if(alive)setRows([]); }); return ()=>{alive=false;}; },[userId]);
  if(rows===null) return <div className="text-xs text-slate-400"><Loader/></div>;
  if(!rows.length) return <div className="text-xs text-slate-400">{t('users.noSignIns')}</div>;
  return <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
    {rows.map((l,i)=><div key={i} className="flex items-center justify-between gap-3 text-xs">
      <span className="text-slate-500 whitespace-nowrap">{fmtDT(l.createdAt)}</span>
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{l.method}</span>
      <span className="font-mono text-slate-400 truncate">{l.ip||'—'}</span>
    </div>)}
  </div>;
}
function AdminUsers(){
  const {user,t}=useApp();
  const roleOpts=ROLE_OPTIONS.map(o=>({...o,label:t('role.'+o.value)}));
  const [users,setUsers]=useState([]);
  const [exp,setExp]=useState(null); const [add,setAdd]=useState(false); const [del,setDel]=useState(null);
  const [sel,setSel]=useState(()=>new Set()); const [bulkDel,setBulkDel]=useState(false);
  const [roleFilter,setRoleFilter]=useState('all');
  const [loading,setLoading]=useState(false);
  // loads once on mount — no auto-polling, refresh is manual (the online lights/last-seen
  // are a snapshot as of the last load, not a live feed)
  const load=useCallback(()=>{ if(user.role!=='admin') return; setLoading(true); api('users').then(r=>setUsers(r.users||[])).catch(()=>{}).finally(()=>setLoading(false)); },[user.role]);
  useEffect(()=>{ load(); },[load]);
  if(user.role!=='admin') return <Denied/>;
  const isOnline=(u)=> u.lastSeenAt && (Date.now()-new Date(u.lastSeenAt).getTime() < 150000); // active within 2.5 min
  const up=async(id,patch)=>{ try{ const r=await api('users',{method:'PATCH',body:{id,...patch}}); setUsers(us=>us.map(u=>u.id===id?r.user:u)); }catch(e){ toast.error(e.message); } };
  const toggleSel=(id)=>setSel(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });
  const ids=[...sel];
  async function bulkPatch(patch,{skipSelf=false,verbKey='users.verbActivated'}={}){
    const targets=ids.filter(id=>!(skipSelf&&id===user.id)); if(!targets.length){ toast.info(t('users.nothingToUpdate')); return; }
    let ok=0; await Promise.all(targets.map(async id=>{ try{ const r=await api('users',{method:'PATCH',body:{id,...patch}}); setUsers(us=>us.map(u=>u.id===id?r.user:u)); ok++; }catch(e){} }));
    const verb=t(verbKey);
    toast.success(t(ok===1?'users.bulkResultOne':'users.bulkResultMany',{verb,n:ok})+(targets.length<ids.length?t('users.skippedYou'):'')); setSel(new Set());
  }
  async function bulkDelete(){
    const targets=ids.filter(id=>id!==user.id); let ok=0;
    await Promise.all(targets.map(async id=>{ try{ await api('users',{method:'DELETE',body:{id}}); ok++; }catch(e){} }));
    setUsers(us=>us.filter(u=>!targets.includes(u.id))); toast.success(t(ok===1?'users.deletedOne':'users.deletedMany',{n:ok})); setSel(new Set()); setBulkDel(false); setExp(null);
  }
  const filteredUsers=roleFilter==='all'?users:users.filter(u=>u.role===roleFilter);
  const allSel=filteredUsers.length>0&&filteredUsers.every(u=>sel.has(u.id));
  return <div>
    <PageHead title={t('users.title')} subtitle={t('users.accountsCount',{n:users.length})} actions={<>
      <Btn variant="outline" onClick={load} disabled={loading}><Icon name="refresh" className={`w-4 h-4 ${loading?'animate-spin':''}`}/>{t('common.refresh')}</Btn>
      <Btn onClick={()=>setAdd(true)}><Icon name="plus" className="w-4 h-4"/>{t('users.addUser')}</Btn>
    </>}/>
    <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-slate-500 cursor-pointer select-none">
          <input type="checkbox" checked={allSel} ref={el=>{ if(el) el.indeterminate=sel.size>0&&!allSel; }} onChange={e=>setSel(e.target.checked?new Set(filteredUsers.map(u=>u.id)):new Set())} className="accent-navy w-4 h-4"/>
          {sel.size>0?t('users.selectedCount',{n:sel.size}):t('users.selectAll')}
        </label>
        <Select value={roleFilter} onChange={setRoleFilter} className="w-36" options={[{value:'all',label:t('users.allRoles')},...roleOpts]}/>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {sel.size>0&&<>
          <Btn size="sm" variant="outline" onClick={()=>bulkPatch({active:true},{verbKey:'users.verbActivated'})}><Icon name="power" className="w-3.5 h-3.5"/>{t('users.activate')}</Btn>
          <Btn size="sm" variant="outline" onClick={()=>bulkPatch({active:false},{skipSelf:true,verbKey:'users.verbDeactivated'})}>{t('users.deactivate')}</Btn>
          <Select value="" onChange={v=>{ if(v) bulkPatch({role:v},{skipSelf:true,verbKey:'users.verbReroled'}); }} className="w-32" options={[{value:'',label:t('users.setRolePlaceholder')},...roleOpts]}/>
          <Btn size="sm" variant="danger" onClick={()=>setBulkDel(true)}><Icon name="trash" className="w-3.5 h-3.5"/>{t('common.delete')}</Btn>
        </>}
        <ExportMenu filename="lno_users" size="sm" variant="outline" headers={['Email','First name','Last name','Role','Active']}
          getRows={()=>(sel.size?filteredUsers.filter(u=>sel.has(u.id)):filteredUsers).map(u=>[u.email,u.firstName||'',u.lastName||'',u.role,u.active?'yes':'no'])}/>
      </div>
    </div>
    {filteredUsers.length===0 && <div className="text-sm text-slate-400 text-center py-10">{t('users.noMatchFilter')}</div>}
    <div className="space-y-3">
      {filteredUsers.map(u=><Card key={u.id} className={`overflow-hidden ${sel.has(u.id)?'ring-1 ring-gold/40':''}`}>
        <div className="flex items-center">
        <label className="pl-4 flex items-center shrink-0"><input type="checkbox" checked={sel.has(u.id)} onChange={()=>toggleSel(u.id)} className="accent-navy w-4 h-4"/></label>
        <button onClick={()=>setExp(exp===u.id?null:u.id)} className="flex-1 min-w-0 flex items-center gap-3 p-4 text-left hover:bg-slate-50/60">
          {u.avatar?<img src={u.avatar} className="w-10 h-10 rounded-full object-cover"/>:<span className="w-10 h-10 rounded-full bg-navy text-white grid place-items-center text-xs font-semibold shrink-0">{initialsOf(u)}</span>}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-navy flex items-center gap-2">{(u.firstName||u.lastName)?`${u.firstName} ${u.lastName}`.trim():u.email}
              <Badge className={u.role==='admin'?'bg-gold/15 text-gold':u.role==='operator'?'bg-blue-100 text-blue-700':u.role==='shareholder'?'bg-emerald-100 text-emerald-700':'bg-slate-100 text-slate-600'}>{t('role.'+u.role)}</Badge>
            </div>
            <div className="text-xs text-slate-400 truncate">{u.email}</div>
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5 truncate">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOnline(u)?'bg-success pulse-dot':'bg-slate-300'}`}/>
              <span className={isOnline(u)?'text-success font-medium':''}>{isOnline(u)?t('users.online'):(u.lastLoginAt?t('users.lastSignIn',{date:fmtDT(u.lastLoginAt)}):t('users.neverSignedIn'))}</span>
              {u.lastIp&&<span className="font-mono text-slate-400">· {u.lastIp}</span>}
            </div>
          </div>
          <StatusPill status={u.active?'active':'inactive'}/>
          <Icon name="chevdown" className={`w-4 h-4 text-slate-400 transition ${exp===u.id?'rotate-180':''}`}/>
        </button>
        </div>
        {exp===u.id&&<div className="border-t border-slate-100 p-4 space-y-4 fadein">
          <div className="flex flex-wrap gap-4">
            <div><Field label={t('login.email')}><div className="pt-1.5 text-sm font-mono text-slate-500">{u.email}</div></Field></div>
            <div className="w-44"><Field label={t('users.role')}><Select value={u.role} onChange={v=>up(u.id,{role:v})} options={roleOpts}/></Field></div>
            <div><Field label={t('users.active')}><div className="pt-1.5"><Toggle on={u.active} onChange={v=>up(u.id,{active:v})}/></div></Field></div>
          </div>
          <div className="text-[11px] text-slate-400">{t('users.permissionsByRoleHint')}</div>
          <div>
            <div className="text-xs font-medium text-slate-500 mb-2">{t('users.signInPassword')}</div>
            {u.authProvider==='google'
              ? <div className="text-sm text-slate-500 flex items-center gap-2"><Icon name="shield" className="w-4 h-4 text-slate-400 shrink-0"/>{t('users.signsInWithGoogle',{email:u.email})}</div>
              : u.authProvider==='otp'
              ? <div className="text-sm text-slate-500 flex items-center gap-2"><Icon name="mail" className="w-4 h-4 text-slate-400 shrink-0"/>{t('users.signsInWithCode',{email:u.email})}</div>
              : <AdminSetPassword user={u}/>}
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-2">{t('users.recentSignIns')}
              {u.lastIp&&<span className="text-[11px] text-slate-400 font-normal">{t('users.lastFrom',{ip:u.lastIp})}</span>}</div>
            <UserLoginHistory userId={u.id}/>
          </div>
          <div className="flex justify-end pt-1">
            <Btn variant="danger" size="sm" disabled={u.id===user.id} onClick={()=>setDel(u)}><Icon name="trash" className="w-3.5 h-3.5"/>{t('users.deleteUser')}</Btn>
          </div>
        </div>}
      </Card>)}
    </div>
    <AddUserModal open={add} onClose={()=>setAdd(false)} onCreated={u=>{setUsers(us=>[...us,u]);setAdd(false);}}/>
    <Confirm open={!!del} title={t('users.deleteUser')} message={t('users.deleteUserConfirm',{email:del?.email})} onCancel={()=>setDel(null)} onConfirm={async()=>{try{await api('users',{method:'DELETE',body:{id:del.id}});setUsers(us=>us.filter(u=>u.id!==del.id));toast.success(t('users.userDeleted'));}catch(e){toast.error(e.message);}setDel(null);setExp(null);}}/>
    <Confirm open={bulkDel} title={t('users.deleteSelectedTitle')} message={t('users.deleteSelectedConfirm',{n:ids.filter(id=>id!==user.id).length})} confirmLabel={t('users.deleteAll')} onCancel={()=>setBulkDel(false)} onConfirm={bulkDelete}/>
  </div>;
}
// Password policy for shareholder accounts — mirrors api/_lib/auth.js passwordIssues().
function AdminSetPassword({user}: any){
  const {t}=useApp();
  const [pw,setPw]=useState(''); const [show,setShow]=useState(false); const [busy,setBusy]=useState(false); const [msg,setMsg]=useState(null);
  async function save(){
    if(!passwordOk(pw)) return setMsg({err:t('users.passwordRequirementsErr')});
    setBusy(true);
    try{ await api('users',{method:'PATCH',body:{id:user.id,password:pw}}); setPw(''); setMsg({ok:t('users.passwordUpdated')}); toast.success(t('users.newPasswordSetFor',{email:user.email})); }
    catch(e){ setMsg({err:e.message||t('users.couldNotSetPassword')}); }
    finally{ setBusy(false); }
  }
  return <div>
    <div className="flex flex-wrap gap-2 items-start">
      <div className="relative flex-1 min-w-[220px] max-w-xs">
        <Input type={show?'text':'password'} value={pw} onChange={e=>{setPw(e.target.value);setMsg(null);}} placeholder={t('users.newPasswordPlaceholder')} className="pr-9 font-mono"/>
        <button type="button" onClick={()=>setShow(s=>!s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-navy"><Icon name={show?'eyeoff':'eye'} className="w-4 h-4"/></button>
      </div>
      <Btn type="button" variant="outline" size="sm" onClick={()=>{setPw(genPassword());setShow(true);setMsg(null);}}><Icon name="refresh" className="w-3.5 h-3.5"/>{t('users.generate')}</Btn>
      <Btn size="sm" onClick={save} disabled={busy||!pw}>{busy?t('users.settingPassword'):t('users.setPassword')}</Btn>
      {msg?.ok&&<span className="text-sm text-success flex items-center gap-1 pt-1.5"><Icon name="check" className="w-4 h-4"/>{msg.ok}</span>}
      {msg?.err&&<span className="text-sm text-danger pt-1.5">{msg.err}</span>}
    </div>
    {pw&&<div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 mt-2">
      {PW_RULES.map(([label,fn])=>{ const ok=fn(pw); return <div key={label} className={`flex items-center gap-1.5 text-[11px] ${ok?'text-success':'text-slate-400'}`}><Icon name={ok?'check':'x'} className="w-3 h-3 shrink-0"/>{t(label)}</div>; })}
    </div>}
    <div className="text-[11px] text-slate-400 mt-2">{t('users.shareNewPasswordHint')}</div>
  </div>;
}
function genPassword(){
  const U='ABCDEFGHJKLMNPQRSTUVWXYZ',L='abcdefghijkmnopqrstuvwxyz',D='23456789',S='!@#$%^&*?-_',all=U+L+D+S;
  const rnd=(n)=>{ try{ const a=new Uint32Array(1); crypto.getRandomValues(a); return a[0]%n; }catch(e){ return Math.floor(Math.random()*n); } };
  const pick=s=>s[rnd(s.length)];
  const arr=[pick(U),pick(L),pick(D),pick(S)];
  while(arr.length<16) arr.push(pick(all));
  for(let i=arr.length-1;i>0;i--){ const j=rnd(i+1); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  return arr.join('');
}
function AddUserModal({open,onClose,onCreated}: any){
  const {t}=useApp();
  const roleOpts=ROLE_OPTIONS.map(o=>({...o,label:t('role.'+o.value)}));
  const [v,setV]=useState({email:'',firstName:'',lastName:'',role:'viewer'}); const [err,setErr]=useState(''); const [busy,setBusy]=useState(false);
  useEffect(()=>{ if(open){setV({email:'',firstName:'',lastName:'',role:'viewer'});setErr('');} },[open]);
  const isShareholder=v.role==='shareholder';
  async function submit(){
    if(isShareholder){
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email))return setErr(t('users.validEmailRequired'));
    } else if(!v.email.endsWith('@lno.company')) return setErr(t('users.emailMustEndWith'));
    setBusy(true);
    try{ const body: any={email:v.email.trim(),firstName:v.firstName,lastName:v.lastName,role:v.role}; const r=await api('users',{method:'POST',body}); onCreated(r.user); }
    catch(e){ setErr(e.message); } finally{ setBusy(false); }
  }
  return <Modal open={open} onClose={onClose} title={t('users.addUserTitle')}>
    <div className="space-y-3">
      <Field label={t('users.role')}><Select value={v.role} onChange={r=>setV({...v,role:r})} options={roleOpts}/></Field>
      <Field label={t('users.emailRequired')} hint={isShareholder?t('users.emailHintShareholder'):t('users.emailHintInternal')}><Input value={v.email} onChange={e=>setV({...v,email:e.target.value})} placeholder={isShareholder?t('users.emailPlaceholderShareholder'):t('users.emailPlaceholderInternal')}/></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('users.firstName')}><Input value={v.firstName} onChange={e=>setV({...v,firstName:e.target.value})}/></Field>
        <Field label={t('users.lastName')}><Input value={v.lastName} onChange={e=>setV({...v,lastName:e.target.value})}/></Field>
      </div>
      {err&&<div className="text-sm text-danger">{err}</div>}
      <div className="text-[11px] text-slate-400 flex items-start gap-1.5">{isShareholder&&<Icon name="mail" className="w-3.5 h-3.5 shrink-0 mt-0.5"/>}{isShareholder? t('users.shareholderOtpHint') : t('users.internalAccountHint',{domain:'@lno.company'})}</div>
      <div className="flex justify-end gap-2 pt-1"><Btn variant="outline" onClick={onClose}>{t('common.cancel')}</Btn><Btn onClick={submit} disabled={busy}>{busy?t('users.creating'):t('users.createUser')}</Btn></div>
    </div>
  </Modal>;
}

export { AdminUsers };
