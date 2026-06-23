import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  PERMISSIONS, ALL_PERMS, ROLE_PERMS, ROLE_OPTIONS, fmtDT, initialsOf, api, toast, Icon, Card, Btn, Badge,
  StatusPill, Toggle, Select, Field, Input, ExportMenu, Modal, Confirm, useApp, PageHead, Denied, PW_RULES,
  passwordOk
} from '../ui.jsx'

/* ============================================================
   ADMIN — USERS
   ============================================================ */
// Recent sign-in audit for one user (timestamp · method · IP), loaded on expand.
function UserLoginHistory({userId}){
  const [rows,setRows]=useState(null);
  useEffect(()=>{ let alive=true; api('users?logins='+encodeURIComponent(userId)).then(r=>{ if(alive)setRows(r.logins||[]); }).catch(()=>{ if(alive)setRows([]); }); return ()=>{alive=false;}; },[userId]);
  if(rows===null) return <div className="text-xs text-slate-400">Loading…</div>;
  if(!rows.length) return <div className="text-xs text-slate-400">No sign-ins recorded yet.</div>;
  return <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
    {rows.map((l,i)=><div key={i} className="flex items-center justify-between gap-3 text-xs">
      <span className="text-slate-500 whitespace-nowrap">{fmtDT(l.createdAt)}</span>
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{l.method}</span>
      <span className="font-mono text-slate-400 truncate">{l.ip||'—'}</span>
    </div>)}
  </div>;
}
function AdminUsers(){
  const {user}=useApp();
  const [users,setUsers]=useState([]);
  const [exp,setExp]=useState(null); const [add,setAdd]=useState(false); const [del,setDel]=useState(null);
  const [sel,setSel]=useState(()=>new Set()); const [bulkDel,setBulkDel]=useState(false);
  // refetch periodically so the online lights + last-seen stay current
  useEffect(()=>{ if(user.role!=='admin') return; const load=()=>api('users').then(r=>setUsers(r.users||[])).catch(()=>{}); load(); const iv=setInterval(load,30000); return ()=>clearInterval(iv); },[]);
  if(user.role!=='admin') return <Denied/>;
  const isOnline=(u)=> u.lastSeenAt && (Date.now()-new Date(u.lastSeenAt).getTime() < 150000); // active within 2.5 min
  const up=async(id,patch)=>{ try{ const r=await api('users',{method:'PATCH',body:{id,...patch}}); setUsers(us=>us.map(u=>u.id===id?r.user:u)); }catch(e){ toast.error(e.message); } };
  const toggleSel=(id)=>setSel(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });
  const ids=[...sel];
  async function bulkPatch(patch,{skipSelf=false,verb='Updated'}={}){
    const targets=ids.filter(id=>!(skipSelf&&id===user.id)); if(!targets.length){ toast.info('Nothing to update (only your own account was selected).'); return; }
    let ok=0; await Promise.all(targets.map(async id=>{ try{ const r=await api('users',{method:'PATCH',body:{id,...patch}}); setUsers(us=>us.map(u=>u.id===id?r.user:u)); ok++; }catch(e){} }));
    toast.success(`${verb} ${ok} user${ok===1?'':'s'}${targets.length<ids.length?' · skipped you':''}`); setSel(new Set());
  }
  async function bulkDelete(){
    const targets=ids.filter(id=>id!==user.id); let ok=0;
    await Promise.all(targets.map(async id=>{ try{ await api('users',{method:'DELETE',body:{id}}); ok++; }catch(e){} }));
    setUsers(us=>us.filter(u=>!targets.includes(u.id))); toast.success(`Deleted ${ok} user${ok===1?'':'s'}`); setSel(new Set()); setBulkDel(false); setExp(null);
  }
  const allSel=users.length>0&&sel.size===users.length;
  return <div>
    <PageHead title="Users" subtitle={`${users.length} accounts`} actions={<Btn onClick={()=>setAdd(true)}><Icon name="plus" className="w-4 h-4"/>Add User</Btn>}/>
    <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
      <label className="flex items-center gap-2 text-sm text-slate-500 cursor-pointer select-none">
        <input type="checkbox" checked={allSel} ref={el=>{ if(el) el.indeterminate=sel.size>0&&!allSel; }} onChange={e=>setSel(e.target.checked?new Set(users.map(u=>u.id)):new Set())} className="accent-navy w-4 h-4"/>
        {sel.size>0?`${sel.size} selected`:'Select all'}
      </label>
      <div className="flex items-center gap-2 flex-wrap">
        {sel.size>0&&<>
          <Btn size="sm" variant="outline" onClick={()=>bulkPatch({active:true},{verb:'Activated'})}><Icon name="power" className="w-3.5 h-3.5"/>Activate</Btn>
          <Btn size="sm" variant="outline" onClick={()=>bulkPatch({active:false},{skipSelf:true,verb:'Deactivated'})}>Deactivate</Btn>
          <Select value="" onChange={v=>{ if(v) bulkPatch({role:v,permissions:ROLE_PERMS[v].slice()},{skipSelf:true,verb:'Re-roled'}); }} className="w-32" options={[{value:'',label:'Set role…'},...ROLE_OPTIONS]}/>
          <Btn size="sm" variant="danger" onClick={()=>setBulkDel(true)}><Icon name="trash" className="w-3.5 h-3.5"/>Delete</Btn>
        </>}
        <ExportMenu filename="lno_users" size="sm" variant="outline" headers={['Email','First name','Last name','Role','Active','Permissions']}
          getRows={()=>(sel.size?users.filter(u=>sel.has(u.id)):users).map(u=>[u.email,u.firstName||'',u.lastName||'',u.role,u.active?'yes':'no',(u.role==='admin'?ALL_PERMS:u.permissions||[]).join(' ')])}/>
      </div>
    </div>
    <div className="space-y-3">
      {users.map(u=><Card key={u.id} className={`overflow-hidden ${sel.has(u.id)?'ring-1 ring-gold/40':''}`}>
        <div className="flex items-center">
        <label className="pl-4 flex items-center shrink-0"><input type="checkbox" checked={sel.has(u.id)} onChange={()=>toggleSel(u.id)} className="accent-navy w-4 h-4"/></label>
        <button onClick={()=>setExp(exp===u.id?null:u.id)} className="flex-1 min-w-0 flex items-center gap-3 p-4 text-left hover:bg-slate-50/60">
          {u.avatar?<img src={u.avatar} className="w-10 h-10 rounded-full object-cover"/>:<span className="w-10 h-10 rounded-full bg-navy text-white grid place-items-center text-xs font-semibold shrink-0">{initialsOf(u)}</span>}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-navy flex items-center gap-2">{(u.firstName||u.lastName)?`${u.firstName} ${u.lastName}`.trim():u.email}
              <Badge className={u.role==='admin'?'bg-gold/15 text-gold':u.role==='operator'?'bg-blue-100 text-blue-700':u.role==='shareholder'?'bg-emerald-100 text-emerald-700':'bg-slate-100 text-slate-600'}>{u.role}</Badge>
            </div>
            <div className="text-xs text-slate-400 truncate">{u.email}</div>
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5 truncate">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOnline(u)?'bg-success pulse-dot':'bg-slate-300'}`}/>
              <span className={isOnline(u)?'text-success font-medium':''}>{isOnline(u)?'Online':(u.lastLoginAt?`Last sign-in ${fmtDT(u.lastLoginAt)}`:'Never signed in')}</span>
              {u.lastIp&&<span className="font-mono text-slate-400">· {u.lastIp}</span>}
            </div>
          </div>
          <StatusPill status={u.active?'active':'inactive'}/>
          <Icon name="chevdown" className={`w-4 h-4 text-slate-400 transition ${exp===u.id?'rotate-180':''}`}/>
        </button>
        </div>
        {exp===u.id&&<div className="border-t border-slate-100 p-4 space-y-4 fadein">
          <div className="flex flex-wrap gap-4">
            <div><Field label="Email"><div className="pt-1.5 text-sm font-mono text-slate-500">{u.email}</div></Field></div>
            <div className="w-44"><Field label="Role"><Select value={u.role} onChange={v=>up(u.id,{role:v,permissions:ROLE_PERMS[v].slice()})} options={ROLE_OPTIONS}/></Field></div>
            <div><Field label="Active"><div className="pt-1.5"><Toggle on={u.active} onChange={v=>up(u.id,{active:v})}/></div></Field></div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 mb-2">Permissions {u.role==='admin'&&<span className="text-slate-400">(admins always have all permissions)</span>}</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {PERMISSIONS.map(([p,l])=><label key={p} className={`flex items-center gap-2 text-sm ${u.role==='admin'?'opacity-50':''}`}>
                <input type="checkbox" disabled={u.role==='admin'} checked={u.role==='admin'||u.permissions.includes(p)} onChange={e=>up(u.id,{permissions:e.target.checked?[...u.permissions,p]:u.permissions.filter(x=>x!==p)})} className="accent-navy w-4 h-4"/>{l}
              </label>)}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 mb-2">Sign-in &amp; password</div>
            {u.authProvider==='google'
              ? <div className="text-sm text-slate-500 flex items-center gap-2"><Icon name="shield" className="w-4 h-4 text-slate-400 shrink-0"/>Signs in with Google (<span className="font-mono">{u.email}</span>) — no password to set.</div>
              : <AdminSetPassword user={u}/>}
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-2">Recent sign-ins
              {u.lastIp&&<span className="text-[11px] text-slate-400 font-normal">· last from <span className="font-mono">{u.lastIp}</span></span>}</div>
            <UserLoginHistory userId={u.id}/>
          </div>
          <div className="flex justify-end pt-1">
            <Btn variant="danger" size="sm" disabled={u.id===user.id} onClick={()=>setDel(u)}><Icon name="trash" className="w-3.5 h-3.5"/>Delete user</Btn>
          </div>
        </div>}
      </Card>)}
    </div>
    <AddUserModal open={add} onClose={()=>setAdd(false)} onCreated={u=>{setUsers(us=>[...us,u]);setAdd(false);}}/>
    <Confirm open={!!del} title="Delete user" message={`Permanently remove ${del?.email}? This cannot be undone.`} onCancel={()=>setDel(null)} onConfirm={async()=>{try{await api('users',{method:'DELETE',body:{id:del.id}});setUsers(us=>us.filter(u=>u.id!==del.id));toast.success('User deleted');}catch(e){toast.error(e.message);}setDel(null);setExp(null);}}/>
    <Confirm open={bulkDel} title="Delete selected users" message={`Permanently remove ${ids.filter(id=>id!==user.id).length} user(s)? Your own account is never deleted. This cannot be undone.`} confirmLabel="Delete all" onCancel={()=>setBulkDel(false)} onConfirm={bulkDelete}/>
  </div>;
}
// Password policy for shareholder accounts — mirrors api/_lib/auth.js passwordIssues().
function AdminSetPassword({user}){
  const [pw,setPw]=useState(''); const [show,setShow]=useState(false); const [busy,setBusy]=useState(false); const [msg,setMsg]=useState(null);
  async function save(){
    if(!passwordOk(pw)) return setMsg({err:'Password does not meet all the requirements below.'});
    setBusy(true);
    try{ await api('users',{method:'PATCH',body:{id:user.id,password:pw}}); setPw(''); setMsg({ok:'Password updated'}); toast.success(`New password set for ${user.email}`); }
    catch(e){ setMsg({err:e.message||'Could not set password'}); }
    finally{ setBusy(false); }
  }
  return <div>
    <div className="flex flex-wrap gap-2 items-start">
      <div className="relative flex-1 min-w-[220px] max-w-xs">
        <Input type={show?'text':'password'} value={pw} onChange={e=>{setPw(e.target.value);setMsg(null);}} placeholder="New password" className="pr-9 font-mono"/>
        <button type="button" onClick={()=>setShow(s=>!s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-navy"><Icon name={show?'eyeoff':'eye'} className="w-4 h-4"/></button>
      </div>
      <Btn type="button" variant="outline" size="sm" onClick={()=>{setPw(genPassword());setShow(true);setMsg(null);}}><Icon name="refresh" className="w-3.5 h-3.5"/>Generate</Btn>
      <Btn size="sm" onClick={save} disabled={busy||!pw}>{busy?'Setting…':'Set password'}</Btn>
      {msg?.ok&&<span className="text-sm text-success flex items-center gap-1 pt-1.5"><Icon name="check" className="w-4 h-4"/>{msg.ok}</span>}
      {msg?.err&&<span className="text-sm text-danger pt-1.5">{msg.err}</span>}
    </div>
    {pw&&<div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 mt-2">
      {PW_RULES.map(([label,fn])=>{ const ok=fn(pw); return <div key={label} className={`flex items-center gap-1.5 text-[11px] ${ok?'text-success':'text-slate-400'}`}><Icon name={ok?'check':'x'} className="w-3 h-3 shrink-0"/>{label}</div>; })}
    </div>}
    <div className="text-[11px] text-slate-400 mt-2">Share the new password with the user securely — they sign in with their email + this password.</div>
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
function AddUserModal({open,onClose,onCreated}){
  const [v,setV]=useState({email:'',firstName:'',lastName:'',role:'viewer',password:''}); const [err,setErr]=useState(''); const [busy,setBusy]=useState(false); const [showPw,setShowPw]=useState(false);
  useEffect(()=>{ if(open){setV({email:'',firstName:'',lastName:'',role:'viewer',password:''});setErr('');setShowPw(false);} },[open]);
  const isShareholder=v.role==='shareholder';
  async function submit(){
    if(isShareholder){
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email))return setErr('A valid email is required.');
      if(!passwordOk(v.password))return setErr('Password does not meet all the requirements below.');
    } else if(!v.email.endsWith('@lno.company')) return setErr('Email must end with @lno.company');
    setBusy(true);
    try{ const body={email:v.email.trim(),firstName:v.firstName,lastName:v.lastName,role:v.role}; if(isShareholder) body.password=v.password; const r=await api('users',{method:'POST',body}); onCreated(r.user); }
    catch(e){ setErr(e.message); } finally{ setBusy(false); }
  }
  return <Modal open={open} onClose={onClose} title="Add User">
    <div className="space-y-3">
      <Field label="Role"><Select value={v.role} onChange={r=>setV({...v,role:r})} options={ROLE_OPTIONS}/></Field>
      <Field label="Email *" hint={isShareholder?'Any email — shareholders have external addresses':'Must end with @lno.company'}><Input value={v.email} onChange={e=>setV({...v,email:e.target.value})} placeholder={isShareholder?'investor@example.com':'jane.doe@lno.company'}/></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name"><Input value={v.firstName} onChange={e=>setV({...v,firstName:e.target.value})}/></Field>
        <Field label="Last name"><Input value={v.lastName} onChange={e=>setV({...v,lastName:e.target.value})}/></Field>
      </div>
      {isShareholder&&<Field label="Password *">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input type={showPw?'text':'password'} value={v.password} onChange={e=>setV({...v,password:e.target.value})} placeholder="Set a strong password" className="pr-9 font-mono"/>
            <button type="button" onClick={()=>setShowPw(s=>!s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-navy"><Icon name={showPw?'eyeoff':'eye'} className="w-4 h-4"/></button>
          </div>
          <Btn type="button" variant="outline" size="sm" onClick={()=>{setV(x=>({...x,password:genPassword()}));setShowPw(true);}}><Icon name="refresh" className="w-3.5 h-3.5"/>Generate</Btn>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-2">
          {PW_RULES.map(([label,fn])=>{ const ok=fn(v.password||''); return <div key={label} className={`flex items-center gap-1.5 text-[11px] ${ok?'text-success':'text-slate-400'}`}><Icon name={ok?'check':'x'} className="w-3 h-3 shrink-0"/>{label}</div>; })}
        </div>
      </Field>}
      {err&&<div className="text-sm text-danger">{err}</div>}
      <div className="text-[11px] text-slate-400">{isShareholder
        ? 'Shareholders sign in with their email + this password (they can’t use Google — external email). Share these credentials with them securely.'
        : <>Pre-provisions the account with a role. The user signs in with their <span className="font-mono">@lno.company</span> Google account — no password needed.</>}</div>
      <div className="flex justify-end gap-2 pt-1"><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn onClick={submit} disabled={busy}>{busy?'Creating…':'Create user'}</Btn></div>
    </div>
  </Modal>;
}

export { AdminUsers };
