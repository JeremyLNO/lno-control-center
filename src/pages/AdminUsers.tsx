import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  ROLE_OPTIONS, AVATAR_STYLES, fmtDT, initialsOf, api, toast, Icon, Card, Btn, Badge, SectionTitle,
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
// All users' sign-ins, most recent first — admin-only, filterable by user/role/method/date/IP.
// Paged 50-at-a-time server-side: every filter here is sent to the API so paging always
// reflects the full matching set, not just whatever happens to be on the current page.
const LOGIN_PAGE_SIZE=50;
function LoginHistoryTable(){
  const {t}=useApp();
  const roleOpts=ROLE_OPTIONS.map(o=>({...o,label:t('role.'+o.value)}));
  const [page,setPage]=useState(null); const [offset,setOffset]=useState(0);
  const [q,setQ]=useState(''); const [roleF,setRoleF]=useState('all'); const [methodF,setMethodF]=useState('all');
  const [dateF,setDateF]=useState(''); const [ipF,setIpF]=useState('');
  const [methods,setMethods]=useState<string[]>([]);
  // Sign-in methods for the filter dropdown — from an unfiltered sample, so the option list
  // doesn't shrink to whatever the current filters/page happen to contain.
  useEffect(()=>{ api('users?allLogins=1&limit=500').then(r=>setMethods([...new Set((r.logins||[]).map((l:any)=>l.method))] as string[])).catch(()=>{}); },[]);
  useEffect(()=>{ setOffset(0); },[q,roleF,methodF,dateF,ipF]);
  useEffect(()=>{
    const qs=new URLSearchParams({allLogins:'1',limit:String(LOGIN_PAGE_SIZE),offset:String(offset)});
    if(q.trim()) qs.set('q',q.trim());
    if(roleF!=='all') qs.set('role',roleF);
    if(methodF!=='all') qs.set('method',methodF);
    if(dateF) qs.set('date',dateF);
    if(ipF.trim()) qs.set('ip',ipF.trim());
    setPage(null);
    api('users?'+qs.toString()).then(r=>setPage(r)).catch(()=>setPage({logins:[],total:0}));
  },[q,roleF,methodF,dateF,ipF,offset]);
  const rows=page?page.logins:[]; const total=page?page.total:0;
  const from=total===0?0:offset+1; const to=Math.min(offset+LOGIN_PAGE_SIZE,total);
  return <Card className="p-5 mt-4">
    <SectionTitle>{t('users.allSignIns')}</SectionTitle>
    <div className="flex flex-wrap gap-2 mb-3">
      <Input value={q} onChange={e=>setQ(e.target.value)} placeholder={t('users.filterByUser')} className="w-48"/>
      <Select value={roleF} onChange={setRoleF} className="w-36" options={[{value:'all',label:t('users.allRoles')},...roleOpts]}/>
      <Select value={methodF} onChange={setMethodF} className="w-32" options={[{value:'all',label:t('users.allMethods')},...methods.map(m=>({value:m,label:m}))]}/>
      <Input type="date" value={dateF} onChange={e=>setDateF(e.target.value)} className="w-40"/>
      <Input value={ipF} onChange={e=>setIpF(e.target.value)} placeholder={t('users.filterByIp')} className="w-36"/>
      {(dateF||ipF)&&<button onClick={()=>{setDateF('');setIpF('');}} className="text-xs text-slate-400 hover:text-navy">{t('common.clear')}</button>}
    </div>
    {page===null? <Loader/>
    : rows.length===0
      ? <div className="text-sm text-slate-400 py-6 text-center">{t('users.noMatchFilter')}</div>
      : <>
        <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500 text-left">
              <th className="px-3 py-2 font-medium">{t('login.email')}</th>
              <th className="px-3 py-2 font-medium">{t('users.role')}</th>
              <th className="px-3 py-2 font-medium">{t('users.method')}</th>
              <th className="px-3 py-2 font-medium">IP</th>
              <th className="px-3 py-2 font-medium">{t('users.signInDate')}</th>
            </tr></thead>
            <tbody>{rows.map((r,i)=><tr key={i} className="border-b border-slate-50">
              <td className="px-3 py-2 truncate max-w-[220px]">{(r.firstName||r.lastName)?`${r.firstName} ${r.lastName}`.trim():r.email}</td>
              <td className="px-3 py-2">{r.role?t('role.'+r.role):'—'}</td>
              <td className="px-3 py-2 text-[10px] uppercase tracking-wide text-slate-400">{r.method}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-400">{r.ip||'—'}</td>
              <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{fmtDT(r.createdAt)}</td>
            </tr>)}</tbody>
          </table></div>
        <div className="flex items-center justify-between gap-3 mt-3 text-xs text-slate-500">
          <span>{t('common.pageRange',{from,to,total})}</span>
          <div className="flex items-center gap-2">
            <Btn variant="ghost" disabled={offset===0} onClick={()=>setOffset(o=>Math.max(0,o-LOGIN_PAGE_SIZE))}><Icon name="chevleft" className="w-4 h-4"/>{t('common.prev')}</Btn>
            <Btn variant="ghost" disabled={offset+LOGIN_PAGE_SIZE>=total} onClick={()=>setOffset(o=>o+LOGIN_PAGE_SIZE)}>{t('common.next')}<Icon name="chevright" className="w-4 h-4"/></Btn>
          </div>
        </div>
      </>}
  </Card>;
}
function AdminUsers(){
  const {user,t}=useApp();
  const roleOpts=ROLE_OPTIONS.map(o=>({...o,label:t('role.'+o.value)}));
  const [users,setUsers]=useState([]);
  const [exp,setExp]=useState(null); const [add,setAdd]=useState(false); const [del,setDel]=useState(null);
  const [sel,setSel]=useState(()=>new Set()); const [bulkDel,setBulkDel]=useState(false);
  const [roleFilter,setRoleFilter]=useState('all');
  const [loading,setLoading]=useState(false);
  const [avatarPickFor,setAvatarPickFor]=useState(null);
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
    {filteredUsers.length>0&&<Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500 text-left">
          <th className="pl-4 py-2.5 w-8"></th>
          <th className="px-3 py-2.5 font-medium">{t('login.email')}</th>
          <th className="px-3 py-2.5 font-medium">{t('users.role')}</th>
          <th className="px-3 py-2.5 font-medium">{t('users.active')}</th>
          <th className="px-3 py-2.5 font-medium">{t('users.recentSignIns')}</th>
          <th className="px-3 py-2.5 font-medium">{t('users.notifications')}</th>
          <th className="px-3 py-2.5 font-medium text-right pr-4">{t('users.actions')}</th>
        </tr></thead>
        <tbody>
          {filteredUsers.map(u=><React.Fragment key={u.id}>
            <tr className={`border-b border-slate-50 hover:bg-slate-50/60 ${sel.has(u.id)?'bg-gold/5':''}`}>
              <td className="pl-4 py-2.5"><input type="checkbox" checked={sel.has(u.id)} onChange={()=>toggleSel(u.id)} className="accent-navy w-4 h-4"/></td>
              <td className="px-3 py-2.5">
                <button onClick={()=>setExp(exp===u.id?null:u.id)} className="flex items-center gap-2.5 text-left w-full">
                  {u.avatar?<img src={u.avatar} className="w-8 h-8 rounded-full object-cover shrink-0"/>:<span className="w-8 h-8 rounded-full bg-navy text-white grid place-items-center text-[11px] font-semibold shrink-0">{initialsOf(u)}</span>}
                  <div className="min-w-0">
                    <div className="font-medium text-navy truncate">{(u.firstName||u.lastName)?`${u.firstName} ${u.lastName}`.trim():u.email}</div>
                    <div className="text-xs text-slate-400 truncate">{u.email}</div>
                  </div>
                </button>
              </td>
              <td className="px-3 py-2.5"><Badge className={u.role==='admin'?'bg-gold/15 text-gold':u.role==='operator'?'bg-blue-100 text-blue-700':u.role==='shareholder'?'bg-emerald-100 text-emerald-700':'bg-slate-100 text-slate-600'}>{t('role.'+u.role)}</Badge></td>
              <td className="px-3 py-2.5"><StatusPill status={u.active?'active':'inactive'}/></td>
              <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                <span className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOnline(u)?'bg-success pulse-dot':'bg-slate-300'}`}/>
                  <span className={isOnline(u)?'text-success font-medium':'text-slate-400'}>{isOnline(u)?t('users.online'):(u.lastLoginAt?fmtDT(u.lastLoginAt):t('users.neverSignedIn'))}</span>
                </span>
              </td>
              <td className="px-3 py-2.5"><Icon name={u.notify?'msg':'x'} className={`w-4 h-4 ${u.notify?'text-success':'text-slate-300'}`} data-tip={u.notify?'WhatsApp notifications on':'WhatsApp notifications off'}/></td>
              <td className="px-3 py-2.5 text-right pr-4">
                <button onClick={()=>setExp(exp===u.id?null:u.id)} className="text-slate-400 hover:text-navy p-1"><Icon name="chevdown" className={`w-4 h-4 transition ${exp===u.id?'rotate-180':''}`}/></button>
              </td>
            </tr>
            {exp===u.id&&<tr className="border-b border-slate-50 fadein"><td colSpan={7} className="p-4 space-y-4 bg-slate-50/50">
          <div className="flex flex-wrap gap-4 items-start">
            <Field label={t('users.avatar')}><div className="flex items-center gap-2 pt-1">
              {u.avatar?<img src={u.avatar} className="w-10 h-10 rounded-full object-cover"/>:<span className="w-10 h-10 rounded-full bg-navy text-white grid place-items-center text-xs font-semibold shrink-0">{initialsOf(u)}</span>}
              <Btn size="sm" variant="outline" onClick={()=>setAvatarPickFor(u.id)}>{t('users.change')}</Btn>
            </div></Field>
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
            </td></tr>}
          </React.Fragment>)}
        </tbody>
      </table>
    </Card>}
    <LoginHistoryTable/>
    <AvatarPickerModal userId={avatarPickFor} onClose={()=>setAvatarPickFor(null)} onPick={async(avatar)=>{ await up(avatarPickFor,{avatar}); setAvatarPickFor(null); }}/>
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
// Admin avatar picker — preset gallery grouped by style (tabs), or upload a new photo.
function AvatarPickerModal({userId,onClose,onPick}: any){
  const {t}=useApp();
  const [style,setStyle]=useState('style1');
  const fileRef=useRef<any>(null);
  const active=AVATAR_STYLES.find(s=>s.key===style)||AVATAR_STYLES[0];
  function upload(e){
    const file=e.target.files[0]; if(!file) return;
    if(!['image/png','image/jpeg'].includes(file.type)) return toast.error(t('profile.acceptedFormats'));
    if(file.size>5*1024*1024) return toast.error(t('profile.maxFileSize'));
    const r=new FileReader(); r.onload=()=>onPick(r.result); r.readAsDataURL(file);
  }
  return <Modal open={!!userId} onClose={onClose} title={t('users.chooseAvatar')} wide>
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {AVATAR_STYLES.map(s=><button key={s.key} onClick={()=>setStyle(s.key)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${style===s.key?'bg-navy text-white':'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{t('users.avatarStyle',{n:s.n})}</button>)}
        <Btn size="sm" variant="outline" className="ml-auto" onClick={()=>fileRef.current?.click()}><Icon name="camera" className="w-3.5 h-3.5"/>{t('users.uploadPhoto')}</Btn>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={upload}/>
      </div>
      <div className="grid grid-cols-6 sm:grid-cols-8 gap-2 max-h-80 overflow-y-auto pr-1">
        {active.items.map(url=><button key={url} onClick={()=>onPick(url)} className="aspect-square rounded-full overflow-hidden ring-2 ring-transparent hover:ring-gold transition">
          <img src={url} className="w-full h-full object-cover"/>
        </button>)}
      </div>
    </div>
  </Modal>;
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
