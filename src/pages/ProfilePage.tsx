import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  initialsOf, api, toast, Icon, Card, SectionTitle, Btn, Toggle, Field, Input, Confirm, useApp,
  PageHead, PW_RULES, passwordOk
} from '../ui'

/* ============================================================
   PROFILE
   ============================================================ */
function ProfilePage(){
  const {user,setUser}=useApp();
  const [v,setV]=useState({firstName:user.firstName,lastName:user.lastName}); const [saved,setSaved]=useState(false);
  const [pw,setPw]=useState({cur:'',n1:'',n2:''}); const [pwMsg,setPwMsg]=useState(null);
  const [notify,setNotify]=useState(user.notify); const [phone,setPhone]=useState(user.phone||'');
  const fileRef=useRef<any>(null);
  async function patchSelf(patch){ try{ const r=await api('profile',{method:'PATCH',body:patch}); setUser(r.user); return true; }catch(e){ toast.error(e.message); return false; } }
  async function saveInfo(){ if(await patchSelf({firstName:v.firstName,lastName:v.lastName})){ setSaved(true); setTimeout(()=>setSaved(false),1800); } }
  async function changePw(){ if(!passwordOk(pw.n1))return setPwMsg({err:'New password does not meet all the requirements.'}); if(pw.n1!==pw.n2)return setPwMsg({err:'Confirmation must match'}); try{ await api('auth',{method:'POST',body:{action:'changePassword',current:pw.cur,next:pw.n1}}); setPw({cur:'',n1:'',n2:''}); setPwMsg({ok:'Password updated'}); }catch(e){ setPwMsg({err:e.message||'Could not update password'}); } }
  function upload(e){ const file=e.target.files[0]; if(!file)return; if(!['image/png','image/jpeg'].includes(file.type))return toast.error('Accepted formats: PNG, JPEG'); if(file.size>5*1024*1024)return toast.error('Maximum file size is 5 MB'); const r=new FileReader(); r.onload=()=>patchSelf({avatar:r.result}); r.readAsDataURL(file); }
  return <div className="max-w-2xl">
    <PageHead title="Profile & Settings" subtitle="Manage your personal account details"/>
    <Card className="p-5 mb-4">
      <div className="flex items-center gap-4 mb-5">
        <div className="relative">
          {user.avatar?<img src={user.avatar} className="w-20 h-20 rounded-full object-cover"/>:<span className="w-20 h-20 rounded-full bg-navy text-white grid place-items-center text-xl font-semibold">{initialsOf(user)}</span>}
          <button onClick={()=>fileRef.current.click()} className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-gold text-navy grid place-items-center shadow"><Icon name="camera" className="w-4 h-4"/></button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={upload}/>
        </div>
        <div><div className="font-semibold text-navy text-lg">{user.firstName||user.email}</div><div className="text-sm text-slate-400">{user.email} · {user.role}</div><div className="text-[11px] text-slate-400 mt-1">PNG or JPEG · max 5 MB</div></div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="First name"><Input value={v.firstName} onChange={e=>setV({...v,firstName:e.target.value})}/></Field>
        <Field label="Last name"><Input value={v.lastName} onChange={e=>setV({...v,lastName:e.target.value})}/></Field>
        <Field label="Email" hint="Contact an admin to change your email" className="sm:col-span-2"><Input value={user.email} disabled className="bg-slate-50 text-slate-400"/></Field>
      </div>
      <div className="flex items-center gap-3 mt-4"><Btn onClick={saveInfo}>Save changes</Btn>{saved&&<span className="text-sm text-success flex items-center gap-1 fadein"><Icon name="check" className="w-4 h-4"/>Changes saved</span>}</div>
    </Card>

    {user.authProvider==='google'
      ? <Card className="p-5 mb-4"><SectionTitle>Sign-in</SectionTitle>
          <div className="flex items-center gap-3 text-sm text-slate-600"><span className="w-9 h-9 rounded-lg bg-gold/15 text-gold grid place-items-center shrink-0"><Icon name="shield" className="w-5 h-5"/></span>
            <div>You sign in with <span className="font-medium text-navy">Google</span> (<span className="font-mono">{user.email}</span>). There's no password to manage.</div></div>
        </Card>
      : <Card className="p-5 mb-4">
          <SectionTitle>Change Password</SectionTitle>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Current password"><Input type="password" value={pw.cur} onChange={e=>setPw({...pw,cur:e.target.value})}/></Field>
            <Field label="New password"><Input type="password" value={pw.n1} onChange={e=>setPw({...pw,n1:e.target.value})}/></Field>
            <Field label="Confirm new"><Input type="password" value={pw.n2} onChange={e=>setPw({...pw,n2:e.target.value})}/></Field>
          </div>
          {pw.n1&&<div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 mt-2">
            {PW_RULES.map(([label,fn])=>{ const ok=fn(pw.n1); return <div key={label} className={`flex items-center gap-1.5 text-[11px] ${ok?'text-success':'text-slate-400'}`}><Icon name={ok?'check':'x'} className="w-3 h-3 shrink-0"/>{label}</div>; })}
          </div>}
          <div className="flex items-center gap-3 mt-4"><Btn onClick={changePw}>Update password</Btn>
            {pwMsg?.err&&<span className="text-sm text-danger">{pwMsg.err}</span>}{pwMsg?.ok&&<span className="text-sm text-success flex items-center gap-1"><Icon name="check" className="w-4 h-4"/>{pwMsg.ok}</span>}</div>
        </Card>}

    <Card className="p-5">
      <SectionTitle>WhatsApp Notifications</SectionTitle>
      <div className="flex items-center justify-between mb-3">
        <div><div className="text-sm font-medium text-navy">Receive notifications</div><div className="text-xs text-slate-400">{user.role==='shareholder'?'Get a WhatsApp when a new report is available':'WhatsApp alerts must also be enabled by an admin to deliver'}</div></div>
        <Toggle on={notify} onChange={async x=>{setNotify(x);if(await patchSelf({notify:x})&&x&&phone)toast.success('WhatsApp notifications on — welcome message sent');}}/>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Your phone number"><Input value={phone} onChange={e=>setPhone(e.target.value)} onBlur={()=>patchSelf({phone})} placeholder="+33 6 12 34 56 78"/></Field>
      </div>
      <div className="text-[11px] text-slate-500 mt-2 space-y-1 bg-navy/5 border border-slate-200 rounded-lg p-3">
        <div>Alerts are delivered through the firm's <span className="font-medium text-slate-600">TextMeBot</span> number — there's no personal key to set up. To receive them, make sure your WhatsApp number above is registered with TextMeBot. If you don't get the welcome message after turning notifications on, ask an admin to add your number.</div>
      </div>
    </Card>
  </div>;
}

export { ProfilePage };
