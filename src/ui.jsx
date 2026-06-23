import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;

/* ============================================================
   DESIGN TOKENS & CONSTANTS
   ============================================================ */
const FUND_PALETTE = ['#C9A24D','#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444','#EC4899','#6366F1'];
const PERMISSIONS = [
  ['view_activity','View Activity'],
  ['view_realtime','View Real-Time'],
  ['view_trades','View Trades'],
  ['view_logs','View Logs'],
  ['view_reports','View reports'],
  ['export_data','Export data'],
  ['manage_users','Manage users'],
  ['manage_exchanges','Manage exchanges'],
  ['manage_whatsapp','Manage WhatsApp'],
  ['manage_funds','Manage funds'],
];
const ALL_PERMS = PERMISSIONS.map(p=>p[0]);
const ROLE_PERMS = {
  admin: ALL_PERMS.slice(),
  operator: ['view_activity','view_realtime','view_trades','view_logs','export_data'],
  viewer: ['view_activity','view_realtime','view_trades','view_logs'],
  // shareholder: dashboard + prices + system status (via view_activity) and read-only reports
  shareholder: ['view_activity','view_reports'],
};
const ROLE_OPTIONS = [
  {value:'admin',label:'Admin'},
  {value:'operator',label:'Operator'},
  {value:'shareholder',label:'Shareholder'},
  {value:'viewer',label:'Viewer'},
];
// WhatsApp notification matrix — message types (rows) × roles (columns)
const WA_MSG_TYPES = [
  {key:'login',label:'Login-failure alerts'},
  {key:'breach',label:'Threshold breaches'},
  {key:'daily',label:'Daily report'},
  {key:'weekly',label:'Weekly report'},
  {key:'monthly',label:'Monthly report'},
  {key:'new_report',label:'New report available'},
];
const WA_ROLE_COLS = [['admin','Admin'],['operator','Operator'],['viewer','Viewer'],['shareholder','Shareholder']];

/* ============================================================
   FORMATTERS
   ============================================================ */
const fmtUSD = (n,d=0)=> (n<0?'-':'')+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})+' USDT';
const fmtSigned = (n,d=0)=> (n>=0?'+':'-')+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})+' USDT';
const fmtNum = (n,d=0)=> Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtPct = (n,d=1)=> (n>=0?'+':'')+n.toFixed(d)+'%';
const fmtPctPlain = (n,d=1)=> n.toFixed(d)+'%';
const clsPnl = (n)=> n>0?'text-success':n<0?'text-danger':'text-slate-500';
const fmtPrice = (p)=>{ if(p==null||!isFinite(p))return '—'; const d=p>=1000?2:p>=1?3:p>=0.01?5:8; return p.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})+' USDT'; };
const fmtDate = (t)=> new Date(t).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'});
const fmtAgo = (t)=>{ if(t==null)return '—'; const min=Math.round((Date.now()-new Date(t).getTime())/60000); if(min<1)return 'just now'; if(min<60)return min+'m ago'; const h=Math.floor(min/60); if(h<24)return h+'h ago'; return Math.floor(h/24)+'d ago'; };
const fmtTime = (t)=> new Date(t).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
const fmtDT = (t)=> fmtDate(t)+' '+fmtTime(t);
const fmtDur = (mins)=>{ mins=Math.round(mins); if(mins<60)return mins+'m'; const h=Math.floor(mins/60),m=mins%60; if(h<24)return h+'h'+(m?' '+m+'m':''); const d=Math.floor(h/24),hh=h%24; return d+'d'+(hh?' '+hh+'h':''); };
const initialsOf = (u)=>{ const a=(u.firstName||'').trim(), b=(u.lastName||'').trim(); if(a||b) return ((a[0]||'')+(b[0]||'')).toUpperCase(); return (u.email||'?').slice(0,2).toUpperCase(); };

/* ============================================================
   TIME CONSTANTS + SYMBOL HELPERS
   ============================================================ */
const DAY = 86400000;
const NOW = Date.now();
// Derive a display base asset from a futures symbol (e.g. BTCUSDT -> BTC, ETHUSDC -> ETH).
function baseOf(sym){ if(!sym) return ''; const s=String(sym).toUpperCase(); for(const q of ['USDT','USDC','USD','BUSD']){ if(s.endsWith(q)) return s.slice(0,s.length-q.length); } return s; }

/* ============================================================
   API CLIENT — all accounts/config/secrets live in the backend DB.
   The browser only holds a short-lived JWT (sessionStorage); no
   passwords or secrets are ever stored client-side.
   ============================================================ */
const TOKEN_KEY='lno_token';
const getToken=()=>{ try{ return sessionStorage.getItem(TOKEN_KEY)||null; }catch(e){ return null; } };
const setToken=(t)=>{ try{ t? sessionStorage.setItem(TOKEN_KEY,t): sessionStorage.removeItem(TOKEN_KEY); }catch(e){} };

// lightweight UI preference store (last period, dismissed cards, …) in localStorage
const PREF={
  get:(k,d)=>{ try{ const v=localStorage.getItem('lno_pref_'+k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
  set:(k,v)=>{ try{ localStorage.setItem('lno_pref_'+k,JSON.stringify(v)); }catch(e){} },
};

// Google OAuth client ID — public by design (baked into the browser bundle; the security
// comes from the authorized origins + @lno.company restriction). A Vercel env var
// VITE_GOOGLE_CLIENT_ID overrides this default if set.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '842329765719-vinrm66bckks5vfgq54oj4hb3v6e6r1m.apps.googleusercontent.com';

/* ============================================================
   DATA EXPORT — CSV (no dep) + XLSX (code-split). Rows are
   arrays-of-arrays aligned to `headers`.
   ============================================================ */
function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },0);
}
function b64ToBlob(b64,type='application/pdf'){
  const bin=atob(b64); const arr=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return new Blob([arr],{type});
}
function toCSV(headers,rows){
  const esc=v=>{ v=v==null?'':String(v); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
  return [headers.map(esc).join(','),...rows.map(r=>r.map(esc).join(','))].join('\n');
}
async function exportRows({filename,headers,rows,format}){
  if(format==='csv'){ downloadBlob(new Blob(['﻿'+toCSV(headers,rows)],{type:'text/csv;charset=utf-8'}),filename+'.csv'); return; }
  const mod=await import('xlsx'); const XLSX=mod.utils?mod:(mod.default||mod);
  const ws=XLSX.utils.aoa_to_sheet([headers,...rows]); const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Data'); XLSX.writeFile(wb,filename+'.xlsx');
}
async function api(path,{method='GET',body,timeoutMs=35000}={}){
  const headers={}; const tok=getToken(); if(tok) headers['Authorization']='Bearer '+tok;
  if(body!==undefined) headers['Content-Type']='application/json';
  // client-side timeout so a hung request (function timeout / network stall) never leaves a
  // button stuck "…ing" — it fails cleanly and the action can be re-run manually.
  const ctrl=(typeof AbortController!=='undefined')?new AbortController():null;
  const timer=ctrl?setTimeout(()=>ctrl.abort(),timeoutMs):null;
  let r;
  try{ r=await fetch('/api/'+path,{method,headers,body:body!==undefined?JSON.stringify(body):undefined,signal:ctrl?ctrl.signal:undefined}); }
  catch(e){ if(ctrl&&ctrl.signal.aborted){ const t=new Error('Request timed out — please try again.'); t.status=0; t.timeout=true; throw t; } throw e; }
  finally{ if(timer) clearTimeout(timer); }
  let data=null; try{ data=await r.json(); }catch(e){}
  if(!r.ok){
    // a 401 while holding a token = expired/invalid session -> let the app sign out gracefully
    if(r.status===401 && tok) { try{ window.dispatchEvent(new CustomEvent('lno:unauthorized')); }catch(e){} }
    const err=new Error((data&&data.error)||('HTTP '+r.status)); err.status=r.status; err.data=data; throw err;
  }
  return data;
}

/* ============================================================
   TOASTS — imperative (toast.success/error/info), rendered by <Toaster/>
   ============================================================ */
const _toastSubs=new Set();
const toast={
  _emit(t){ const item={id:(typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():String(Date.now()+Math.random()),...t}; _toastSubs.forEach(fn=>fn(item)); },
  success(msg){ this._emit({kind:'success',msg}); },
  error(msg){ this._emit({kind:'error',msg}); },
  info(msg){ this._emit({kind:'info',msg}); },
};
function Toaster(){
  const [items,setItems]=useState([]);
  useEffect(()=>{ const fn=(t)=>{ setItems(x=>[...x,t]); setTimeout(()=>setItems(x=>x.filter(i=>i.id!==t.id)), t.kind==='error'?6000:3500); }; _toastSubs.add(fn); return ()=>_toastSubs.delete(fn); },[]);
  const sty={success:['bg-success/10 border-success/30 text-success','check'],error:['bg-danger/10 border-danger/30 text-danger','triangle'],info:['bg-navy/5 border-slate-200 text-navy','info']};
  return <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-xs w-full pointer-events-none">
    {items.map(t=>{ const [cls,ic]=sty[t.kind]||sty.info; return <div key={t.id} className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border bg-white shadow-lg slidein ${cls}`}>
      <Icon name={ic} className="w-4 h-4 mt-0.5 shrink-0"/>
      <div className="text-sm text-navy flex-1 leading-snug">{t.msg}</div>
      <button onClick={()=>setItems(x=>x.filter(i=>i.id!==t.id))} className="text-slate-400 hover:text-navy"><Icon name="x" className="w-3.5 h-3.5"/></button>
    </div>; })}
  </div>;
}

/* ============================================================
   ICONS
   ============================================================ */
const ICONS = {
  activity:[['path','M22 12h-4l-3 9L9 3l-3 9H2']],
  radio:[['circle',12,12,2],['path','M4.93 19.07a10 10 0 0 1 0-14.14'],['path','M7.76 16.24a6 6 0 0 1 0-8.48'],['path','M16.24 7.76a6 6 0 0 1 0 8.48'],['path','M19.07 4.93a10 10 0 0 1 0 14.14']],
  briefcase:[['path','M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z'],['path','M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16']],
  list:[['path','M8 6h13M8 12h13M8 18h13'],['path','M3 6h.01M3 12h.01M3 18h.01']],
  users:[['path','M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'],['circle',9,7,4],['path','M23 21v-2a4 4 0 0 0-3-3.87'],['path','M16 3.13a4 4 0 0 1 0 7.75']],
  link:[['path','M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'],['path','M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71']],
  msg:[['path','M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z']],
  layers:[['path','M12 2 2 7l10 5 10-5-10-5z'],['path','M2 17l10 5 10-5'],['path','M2 12l10 5 10-5']],
  usercircle:[['circle',12,12,10],['path','M18 20a6 6 0 0 0-12 0'],['circle',12,10,3]],
  lifebuoy:[['circle',12,12,10],['circle',12,12,4],['path','M4.93 4.93l4.24 4.24'],['path','M14.83 14.83l4.24 4.24'],['path','M14.83 9.17l4.24-4.24'],['path','M9.17 14.83l-4.24 4.24']],
  search:[['circle',11,11,8],['path','M21 21l-4.35-4.35']],
  bell:[['path','M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9'],['path','M13.73 21a2 2 0 0 1-3.46 0']],
  menu:[['path','M3 12h18M3 6h18M3 18h18']],
  eye:[['path','M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'],['circle',12,12,3]],
  eyeoff:[['path','M17.94 17.94A10 10 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94'],['path','M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19'],['path','M1 1l22 22']],
  pencil:[['path','M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'],['path','M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z']],
  trash:[['path','M3 6h18'],['path','M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2']],
  plus:[['path','M12 5v14M5 12h14']],
  pin:[['path','M12 17v5'],['path','M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z']],
  back:[['path','M19 12H5M12 19l-7-7 7-7']],
  check:[['path','M20 6 9 17l-5-5']],
  x:[['path','M18 6 6 18M6 6l12 12']],
  chevdown:[['path','M6 9l6 6 6-6']],
  chevleft:[['path','M15 18l-6-6 6-6']],
  chevright:[['path','M9 18l6-6-6-6']],
  download:[['path','M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'],['path','M7 10l5 5 5-5'],['path','M12 15V3']],
  camera:[['path','M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z'],['circle',12,13,4]],
  triangle:[['path','M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'],['path','M12 9v4'],['path','M12 17h.01']],
  info:[['circle',12,12,10],['path','M12 16v-4'],['path','M12 8h.01']],
  logout:[['path','M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'],['path','M16 17l5-5-5-5'],['path','M21 12H9']],
  sort:[['path','M11 5h10'],['path','M11 9h7'],['path','M11 13h4'],['path','M3 17l3 3 3-3'],['path','M6 18V4']],
  filter:[['path','M22 3H2l8 9.46V19l4 2v-8.54L22 3z']],
  mail:[['path','M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],['path','M22 6l-10 7L2 6']],
  clock:[['circle',12,12,10],['path','M12 6v6l4 2']],
  shield:[['path','M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z']],
  dollar:[['path','M12 1v22'],['path','M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6']],
  trendup:[['path','M23 6l-9.5 9.5-5-5L1 18'],['path','M17 6h6v6']],
  power:[['path','M18.36 6.64a9 9 0 1 1-12.73 0'],['path','M12 2v10']],
  star:[['path','M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01z']],
  keyboard:[['rect',2,6,20,12,2],['path','M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8']],
  columns:[['rect',4,4,6,16,1],['rect',14,4,6,16,1]],
  save:[['path','M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z'],['path','M17 21v-8H7v8M7 3v5h8']],
  refresh:[['path','M23 4v6h-6M1 20v-6h6'],['path','M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15']],
  filetext:[['path','M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'],['path','M14 2v6h6M16 13H8M16 17H8M10 9H8']],
  database:[['path','M12 2C7.58 2 4 3.79 4 6s3.58 4 8 4 8-1.79 8-4-3.58-4-8-4z'],['path','M4 6v6c0 2.21 3.58 4 8 4s8-1.79 8-4V6'],['path','M4 12v6c0 2.21 3.58 4 8 4s8-1.79 8-4v-6']],
  zap:[['path','M13 2L3 14h9l-1 8 10-12h-9l1-8z']],
};
function Icon({name,className='w-5 h-5',sw=2,fill='none'}){
  const items=ICONS[name]||[];
  return <svg className={className} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {items.map((it,i)=> it[0]==='circle'? <circle key={i} cx={it[1]} cy={it[2]} r={it[3]}/> : it[0]==='line'? <line key={i} x1={it[1]} y1={it[2]} x2={it[3]} y2={it[4]}/> : it[0]==='rect'? <rect key={i} x={it[1]} y={it[2]} width={it[3]} height={it[4]} rx={it[5]||0}/> : <path key={i} d={it[1]}/>)}
  </svg>;
}
// Official LNO logo (from LNO logo v2.svg): chart bars + trend line + Anurati
// "LNO" wordmark outlined to a path. Navy parts use currentColor so it adapts —
// navy on light backgrounds (header/loading), white on the navy sidebar/login —
// while the gold accents (#C9A24D) stay gold. Shape is identical to the source file.
const GOLD='#C9A24D';
const LNO_PATH='M330.156 162.232L302 190.600L414.836 190.600L414.836 162.232ZM302 21.240L302 25.897L302 152.282L330.156 123.914L330.156 25.897L330.156 21.240Z M566.202 21.240L566.202 122.644L453.577 21.240L453.577 64.003L594.358 190.600L594.358 190.388L594.358 190.177L594.358 21.240Z M732.598 21.240C709.099 21.240 689.199 29.708 672.898 46.221C656.386 62.733 647.918 82.633 647.918 105.920C647.918 129.419 656.386 149.107 672.898 165.619C689.411 182.132 709.099 190.600 732.598 190.600C756.096 190.600 775.785 182.132 792.297 165.619C809.021 149.319 817.489 129.419 817.489 105.920C817.489 82.633 809.021 62.733 792.297 46.221C775.785 29.708 756.096 21.240 732.598 21.240ZM732.598 49.608C748.052 49.608 761.389 55.112 772.397 66.120C783.406 77.129 788.910 90.466 788.910 105.920C788.910 121.374 783.617 134.711 772.397 145.931C761.389 156.940 748.052 162.232 732.598 162.232C717.144 162.232 703.595 156.940 692.586 145.931C681.578 134.923 676.286 121.374 676.286 105.920C676.286 90.466 681.578 77.129 692.586 66.120C703.807 54.900 717.144 49.608 732.598 49.608Z';
function Logo({className='h-7'}){
  return <svg viewBox="0 0 824 190.6" className={className} fill="none" role="img" aria-label="LNO Control Center">
    <rect fill={GOLD} x="17" y="110.6" width="36" height="80"/>
    <rect fill="currentColor" x="77" y="80.6" width="36" height="110"/>
    <rect fill="currentColor" x="137" y="50.6" width="36" height="140"/>
    <rect fill="currentColor" x="197" y="20.6" width="36" height="170"/>
    <polyline fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" points="7 150.6 35 140.6 95 110.6 155 130.6 215 80.6 255 40.6"/>
    <circle fill="currentColor" cx="7" cy="150.6" r="7"/>
    <circle fill={GOLD} cx="255" cy="40.6" r="7"/>
    <path fill="currentColor" d={LNO_PATH}/>
  </svg>;
}

/* ============================================================
   PRIMITIVES
   ============================================================ */
function Card({className='',children,...p}){ return <div className={'bg-white rounded-xl border border-slate-200/80 shadow-sm '+className} {...p}>{children}</div>; }
function SectionTitle({children,right}){ return <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-navy tracking-tight">{children}</h3>{right}</div>; }

function Btn({variant='primary',size='md',className='',children,...p}){
  const base='inline-flex items-center justify-center gap-2 font-medium rounded-lg transition active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none';
  const sz= size==='sm'?'text-xs px-2.5 py-1.5':size==='icon'?'p-2':'text-sm px-3.5 py-2';
  const v={
    primary:'bg-navy text-white hover:bg-navy2',
    gold:'bg-gold text-navy hover:brightness-105',
    ghost:'text-slate-600 hover:bg-slate-100',
    outline:'border border-slate-300 text-navy hover:bg-slate-50 bg-white',
    danger:'bg-danger text-white hover:brightness-110',
    subtle:'bg-slate-100 text-navy hover:bg-slate-200',
  }[variant];
  return <button className={`${base} ${sz} ${v} ${className}`} {...p}>{children}</button>;
}
function Badge({color,children,className='',onClick,dot}){
  return <span onClick={onClick} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${onClick?'cursor-pointer hover:ring-2 hover:ring-offset-1 ring-slate-200':''} ${className}`} style={color?{background:color+'1A',color:darken(color)}:undefined}>
    {dot&&<span className="w-1.5 h-1.5 rounded-full" style={{background:color}}/>}{children}
  </span>;
}
function darken(hex){ return hex; }

function StatusPill({status}){
  const map={
    active:['bg-success/10 text-success','active'], connected:['bg-success/10 text-success','Connected'],
    paused:['bg-warn/10 text-amber-600','paused'], pending:['bg-slate-200 text-slate-600','Pending'],
    error:['bg-danger/10 text-danger','error'], degraded:['bg-warn/10 text-amber-600','degraded'],
    down:['bg-danger/10 text-danger','down'], inactive:['bg-slate-200 text-slate-500','inactive'],
    Open:['bg-blue-100 text-blue-700','Open'], Closed:['bg-slate-100 text-slate-600','Closed'],
  };
  const [c,l]=map[status]||['bg-slate-100 text-slate-600',status];
  return <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${c}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${status==='active'||status==='connected'?'bg-success':status==='error'||status==='down'?'bg-danger':status==='paused'||status==='degraded'?'bg-amber-500':'bg-slate-400'}`}/>{l}
  </span>;
}

function Toggle({on,onChange,size='md'}){
  const w=size==='sm'?'w-9 h-5':'w-11 h-6'; const k=size==='sm'?'w-3.5 h-3.5':'w-4 h-4'; const tr=size==='sm'?(on?'translate-x-4':'translate-x-0.5'):(on?'translate-x-5':'translate-x-1');
  return <button onClick={()=>onChange(!on)} className={`${w} rounded-full transition relative flex items-center ${on?'bg-success':'bg-slate-300'}`}>
    <span className={`${k} bg-white rounded-full shadow transition transform ${tr}`}/>
  </button>;
}

function Select({value,onChange,options,className=''}){
  return <div className={`relative ${className}`}>
    <select value={value} onChange={e=>onChange(e.target.value)} className="appearance-none w-full bg-white border border-slate-300 rounded-lg pl-3 pr-8 py-2 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-gold/40 cursor-pointer">
      {options.map(o=> typeof o==='string'? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
    <Icon name="chevdown" className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
  </div>;
}
function Field({label,children,hint,className=''}){ return <label className={`block ${className}`}><span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>{children}{hint&&<span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}</label>; }
function Input(p){ return <input {...p} className={'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-gold/40 '+(p.className||'')}/>; }

// Export-as menu (CSV / Excel). getRows() returns array-of-arrays aligned to headers,
// resolved lazily on click so it always reflects the current filters/sort.
function ExportMenu({getRows,headers,filename,disabled,label='Export',size='sm',variant='gold'}){
  const [open,setOpen]=useState(false); const ref=useRef();
  useEffect(()=>{ const h=e=>{ if(ref.current&&!ref.current.contains(e.target))setOpen(false); }; document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h); },[]);
  const run=async(format)=>{ setOpen(false); try{ const rows=getRows(); if(!rows.length){ toast.info('Nothing to export with the current filters.'); return; } await exportRows({filename,headers,rows,format}); toast.success(`Exported ${rows.length} row${rows.length===1?'':'s'} as ${format.toUpperCase()}`); }catch(e){ toast.error('Export failed: '+e.message); } };
  return <div ref={ref} className="relative">
    <Btn variant={variant} size={size} disabled={disabled} onClick={()=>setOpen(o=>!o)}><Icon name="download" className="w-4 h-4"/>{label}<Icon name="chevdown" className={`w-3 h-3 transition ${open?'rotate-180':''}`}/></Btn>
    {open&&<div className="absolute right-0 mt-1 w-44 bg-white rounded-lg shadow-xl border border-slate-200 p-1 z-40 fadein">
      <button onClick={()=>run('csv')} className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-slate-50 text-sm flex items-center gap-2 text-navy"><Icon name="filetext" className="w-4 h-4 text-slate-400"/>CSV (.csv)</button>
      <button onClick={()=>run('xlsx')} className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-slate-50 text-sm flex items-center gap-2 text-navy"><Icon name="briefcase" className="w-4 h-4 text-slate-400"/>Excel (.xlsx)</button>
    </div>}
  </div>;
}

function Modal({open,onClose,title,children,wide}){
  if(!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
    <div className="absolute inset-0 bg-navy/40 backdrop-blur-sm"/>
    <div onClick={e=>e.stopPropagation()} className={`relative bg-white rounded-2xl shadow-2xl w-full ${wide?'max-w-2xl':'max-w-md'} slidein`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <h3 className="font-semibold text-navy">{title}</h3>
        <Btn variant="ghost" size="icon" onClick={onClose}><Icon name="x" className="w-4 h-4"/></Btn>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>;
}
function Confirm({open,title,message,onConfirm,onCancel,danger=true,confirmLabel='Delete'}){
  return <Modal open={open} onClose={onCancel} title={title}>
    <p className="text-sm text-slate-600 mb-5">{message}</p>
    <div className="flex justify-end gap-2">
      <Btn variant="outline" onClick={onCancel}>Cancel</Btn>
      <Btn variant={danger?'danger':'primary'} onClick={onConfirm}>{confirmLabel}</Btn>
    </div>
  </Modal>;
}

/* ============================================================
   CHARTS
   ============================================================ */
function AreaChart({data,positive,height=260,resetKey,benchmark}){
  const id=useId().replace(/:/g,'');
  const ref=useRef();
  const [hover,setHover]=useState(null);
  const [zoom,setZoom]=useState(null);   // {a,b} indices into full data
  const [drag,setDrag]=useState(null);
  useEffect(()=>{ setZoom(null); setHover(null); setDrag(null); },[resetKey]);
  const w=1000,h=height;
  if(!data||data.length<2) return <div style={{height}} className="grid place-items-center text-slate-300 text-sm">No data</div>;
  const base = zoom? Math.max(0,zoom.a) : 0;
  const view = zoom? data.slice(zoom.a, zoom.b+1) : data;
  const bm = benchmark&&benchmark.length===data.length ? (zoom? benchmark.slice(zoom.a,zoom.b+1): benchmark) : null;
  const n=view.length;
  const ys=view.map(d=>d.equity);
  const allY = bm? ys.concat(bm.filter(v=>isFinite(v))) : ys;
  const minY=Math.min(...allY),maxY=Math.max(...allY);
  const pad=(maxY-minY)*0.12||1; const y0=minY-pad,y1=maxY+pad;
  const X=i=>(i/(n-1))*w; const Y=v=>h-((v-y0)/(y1-y0))*h;
  const line=view.map((d,i)=>`${i?'L':'M'}${X(i).toFixed(1)} ${Y(d.equity).toFixed(1)}`).join(' ');
  const area=`${line} L ${w} ${h} L 0 ${h} Z`;
  const bline=bm? bm.map((v,i)=>`${i?'L':'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ') : null;
  const color=positive?'#10B981':'#EF4444';
  const idxFromEvent=(e)=>{ const r=ref.current.getBoundingClientRect(); const f=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)); return Math.round(f*(n-1)); };
  const onMove=(e)=>{ const i=idxFromEvent(e); setHover(i); if(drag) setDrag({...drag,b:i}); };
  const onDown=(e)=>{ const i=idxFromEvent(e); setDrag({a:i,b:i}); };
  const onUp=()=>{ if(drag){ const a=Math.min(drag.a,drag.b),b=Math.max(drag.a,drag.b); if(b-a>=2) setZoom({a:base+a,b:base+b}); } setDrag(null); };
  const onLeave=()=>{ setHover(null); setDrag(null); };
  const hv = hover!=null && hover<n ? view[hover] : null;
  const hoverPct = hover!=null ? (hover/(n-1))*100 : 0;
  return <div className="relative select-none cursor-crosshair" ref={ref} style={{height}}
      onMouseMove={onMove} onMouseDown={onDown} onMouseUp={onUp} onMouseLeave={onLeave} onDoubleClick={()=>setZoom(null)}>
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{height}}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.22"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
      {[0.25,0.5,0.75].map(g=><line key={g} x1="0" x2={w} y1={h*g} y2={h*g} stroke="#eef0f3" strokeWidth="1" vectorEffect="non-scaling-stroke"/>)}
      <path d={area} fill={`url(#${id})`}/>
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>
      {bline && <path d={bline} fill="none" stroke="#C9A24D" strokeWidth="1.75" strokeDasharray="5 4" vectorEffect="non-scaling-stroke"/>}
      {drag && <rect x={X(Math.min(drag.a,drag.b))} y="0" width={Math.abs(X(drag.b)-X(drag.a))||1} height={h} fill="#0B1F3A" fillOpacity="0.08"/>}
      {hv && <line x1={X(hover)} x2={X(hover)} y1="0" y2={h} stroke={color} strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/>}
    </svg>
    {bm && <div className="absolute top-1 left-2 flex items-center gap-3 text-[10px] z-10 pointer-events-none">
      <span className="flex items-center gap-1"><span className="w-3 h-0.5" style={{background:color}}/>Equity</span>
      <span className="flex items-center gap-1 text-gold"><span className="w-3 border-t border-dashed border-gold"/>BTC hold</span>
    </div>}
    {hv && <div className="absolute -top-1 z-10 pointer-events-none" style={{left:hoverPct+'%',transform:`translateX(${hoverPct>75?'-100%':hoverPct<25?'0':'-50%'})`}}>
      <div className="bg-navy text-white rounded-md px-2 py-1 text-[11px] shadow-lg whitespace-nowrap">
        <span className="font-semibold tnum">{fmtUSD(hv.equity)}</span>{bm&&isFinite(bm[hover])&&<span className="text-gold ml-1.5 tnum">BTC {fmtUSD(bm[hover])}</span>}<span className="text-slate-300 ml-1.5">{fmtDate(hv.t)}</span>
      </div>
    </div>}
    {zoom && <button onClick={()=>setZoom(null)} className="absolute top-1 right-1 text-[11px] bg-white/90 border border-slate-200 rounded px-1.5 py-0.5 text-slate-500 hover:text-navy z-10">reset zoom ✕</button>}
  </div>;
}

/* ============================================================
   APP CONTEXT
   ============================================================ */
const App = createContext(null);
const useApp = ()=>useContext(App);

function hasPerm(user,perm){ if(!user)return false; if(user.role==='admin')return true; return (user.permissions||[]).includes(perm); }

// helper: the fund a bot is assigned to (or undefined). Bots carry fundId; funds carry id+color.
function fundOf(funds,bot){ return bot&&bot.fundId? funds.find(f=>f.id===bot.fundId) : undefined; }
function sliceByPeriod(series,period,custom){
  if(period==='all') return series;
  if(period==='custom'&&custom&&custom.start&&custom.end){
    return series.filter(p=>p.t>=custom.start&&p.t<=custom.end);
  }
  const days={ '7':7,'30':30,'90':90,'365':365 }[period]||30;
  const cutoff=NOW-days*DAY;
  return series.filter(p=>p.t>=cutoff);
}
// Sharpe/Sortino (annualised), max drawdown depth + duration (in days) from an equity series.
function riskMetrics(series){
  const eq=series.map(p=>p.equity); const rets=[];
  for(let i=1;i<eq.length;i++) rets.push(eq[i]/eq[i-1]-1);
  const n=rets.length||1; const mean=rets.reduce((a,b)=>a+b,0)/n;
  const sd=Math.sqrt(rets.reduce((a,b)=>a+(b-mean)**2,0)/n);
  const down=rets.filter(r=>r<0); const dd=Math.sqrt(down.reduce((a,b)=>a+b*b,0)/(down.length||1));
  const ann=Math.sqrt(365);
  let peak=eq[0],peakI=0,mdd=0,ddDur=0;
  for(let i=0;i<eq.length;i++){ if(eq[i]>=peak){peak=eq[i];peakI=i;} else { const d=(eq[i]-peak)/peak; if(d<mdd)mdd=d; if(i-peakI>ddDur)ddDur=i-peakI; } }
  return { sharpe:sd?(mean/sd)*ann:0, sortino:dd?(mean/dd)*ann:0, maxDrawdownPct:mdd*100, ddDurationDays:ddDur };
}
function ExposureBars({title,items,total}){
  return <div>
    <div className="text-xs font-medium text-slate-500 mb-2">{title}</div>
    <div className="space-y-2">
      {items.map(([k,v],i)=>{ const pct=v/total*100; const color=FUND_PALETTE[i%FUND_PALETTE.length]; return <div key={k}>
        <div className="flex items-center justify-between text-xs mb-1"><span className="text-navy">{k}</span><span className="text-slate-400 tnum">{fmtUSD(v)} · {pct.toFixed(0)}%</span></div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{width:pct+'%',background:color}}/></div>
      </div>; })}
    </div>
  </div>;
}
// Risk metrics from the equity series + live exposure broken down by fund and by asset.
function RiskPanel({series,openBots,byFund}){
  const m=riskMetrics(series&&series.length?series:[{equity:0}]);
  const byAsset={};
  openBots.forEach(b=>{ const k=baseOf(b.symbol); byAsset[k]=(byAsset[k]||0)+Math.abs(b.notional||0); });
  const fundItems=byFund.filter(f=>f.notional>0).map(f=>[f.name,f.notional]).sort((a,b)=>b[1]-a[1]);
  const assetItems=Object.entries(byAsset).sort((a,b)=>b[1]-a[1]);
  const fundTotal=fundItems.reduce((a,x)=>a+x[1],0)||1;
  const assetTotal=assetItems.reduce((a,x)=>a+x[1],0)||1;
  const M=({label,value,cls,tip})=><div className="bg-slate-50 rounded-lg p-3" title={tip||undefined}>
    <div className="text-[11px] text-slate-500 flex items-center gap-1">{label}{tip&&<Icon name="info" className="w-3 h-3 text-slate-300 cursor-help"/>}</div>
    <div className={`text-lg font-bold tnum mt-0.5 ${cls||'text-navy'}`}>{value}</div>
  </div>;
  return <Card className="p-5">
    <SectionTitle right={<span className="text-[11px] text-slate-400">equity history · live exposure</span>}>Risk & Exposure</SectionTitle>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <M label="Sharpe" value={m.sharpe.toFixed(2)} tip="Risk-adjusted return: annualised mean daily return ÷ volatility of all returns. Higher is better — above 1 is solid, above 2 is excellent."/>
      <M label="Sortino" value={m.sortino.toFixed(2)} tip="Like Sharpe, but only downside (losing-day) volatility is penalised. Rewards strategies whose swings are mostly to the upside."/>
      <M label="Max Drawdown" value={fmtPctPlain(m.maxDrawdownPct)} cls="text-danger" tip="The largest peak-to-trough drop in equity over the period — your worst observed loss from a high-water mark."/>
      <M label="DD Duration" value={m.ddDurationDays+' d'} tip="Longest stretch, in days, the portfolio stayed below a previous equity peak before recovering."/>
    </div>
    {(fundItems.length||assetItems.length)? <div className="grid sm:grid-cols-2 gap-5">
      {fundItems.length>0&&<ExposureBars title="Exposure by fund" items={fundItems} total={fundTotal}/>}
      {assetItems.length>0&&<ExposureBars title="Exposure by asset" items={assetItems} total={assetTotal}/>}
    </div> : <div className="text-sm text-slate-400">No open exposure.</div>}
  </Card>;
}
// Underwater (drawdown-over-time) chart: red area from 0 down to the running drawdown.
function Underwater({series,height=120}){
  if(!series||series.length<2) return <div style={{height}} className="grid place-items-center text-slate-300 text-sm">No data</div>;
  let peak=-Infinity; const dd=series.map(p=>{ peak=Math.max(peak,p.equity); return (p.equity-peak)/peak*100; });
  const w=1000,h=height; const min=Math.min(-0.1,...dd);
  const X=i=>(i/(dd.length-1))*w; const Y=v=>h*(v/min);
  const line=dd.map((v,i)=>`${i?'L':'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  return <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{height}}>
    <line x1="0" x2={w} y1="0.5" y2="0.5" stroke="#e2e8f0" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
    <path d={`${line} L ${w} 0 L 0 0 Z`} fill="#EF4444" fillOpacity="0.12"/>
    <path d={line} fill="none" stroke="#EF4444" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
  </svg>;
}
// GitHub-style daily-PnL heatmap (columns = weeks, rows = Mon..Sun).
function PnlCalendar({series}){
  if(!series||series.length<2) return <div className="text-slate-300 text-sm">No data</div>;
  const pnls=[]; for(let i=1;i<series.length;i++) pnls.push({t:series[i].t, pnl:series[i].equity-series[i-1].equity});
  const max=Math.max(1,...pnls.map(p=>Math.abs(p.pnl)));
  const cellColor=(p)=>{ if(!p) return '#f1f5f9'; const f=0.18+Math.min(1,Math.abs(p.pnl)/max)*0.82; return (p.pnl>=0?`rgba(16,185,129,${f})`:`rgba(239,68,68,${f})`); };
  const dow=t=>{ const d=new Date(t).getUTCDay(); return (d+6)%7; };
  const cols=[]; let col=new Array(dow(pnls[0].t)).fill(null);
  pnls.forEach(p=>{ col.push(p); if(col.length===7){ cols.push(col); col=[]; } });
  if(col.length){ while(col.length<7) col.push(null); cols.push(col); }
  return <div>
    <div className="overflow-x-auto pb-1"><div className="inline-flex gap-1">
      {cols.map((c,ci)=><div key={ci} className="flex flex-col gap-1">{c.map((p,ri)=><div key={ri} className="w-3 h-3 rounded-sm" style={{background:cellColor(p)}} title={p?`${fmtDate(p.t)} · ${fmtSigned(p.pnl)}`:''}/>)}</div>)}
    </div></div>
    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-2"><span>loss</span><span className="w-3 h-3 rounded-sm" style={{background:'rgba(239,68,68,0.9)'}}/><span className="w-3 h-3 rounded-sm bg-slate-100"/><span className="w-3 h-3 rounded-sm" style={{background:'rgba(16,185,129,0.9)'}}/><span>gain</span></div>
  </div>;
}

/* ============================================================
   LIVE-DATA UI
   ============================================================ */
function LiveBadge({status}){
  if(status==='live') return <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-success" data-tip="Connected to an exchange"><span className="w-2 h-2 rounded-full bg-success pulse-dot"/>LIVE</span>;
  if(status==='partial') return <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-amber-600" data-tip="Sync error on last run"><span className="w-2 h-2 rounded-full bg-amber-500"/>PARTIAL</span>;
  if(status==='offline') return <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-slate-400" data-tip="No exchange connected"><span className="w-2 h-2 rounded-full bg-slate-400"/>OFFLINE</span>;
  return <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-slate-400"><span className="w-2 h-2 rounded-full bg-slate-300 animate-pulse"/>…</span>;
}
// Ticker tape of open positions: base asset + unrealized PnL. Hidden when there are none.
function MarketTicker(){
  const {data}=useApp(); if(!data||!data.openBots.length) return null;
  return <div className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-1 px-1">
    {data.openBots.map(b=><div key={b.id} className="shrink-0 bg-white border border-slate-200/80 rounded-lg px-3 py-2 flex items-center gap-2.5">
      <span className="font-mono text-xs font-semibold text-navy">{baseOf(b.symbol)}</span>
      <span className={`text-[11px] font-medium ${b.side==='LONG'?'text-success':'text-danger'}`}>{b.side}</span>
      <span className={`text-[11px] font-medium tnum ${clsPnl(b.unrealizedPnl)}`}>{fmtSigned(b.unrealizedPnl)}</span>
    </div>)}
  </div>;
}
function LoadingScreen(){
  return <div className="h-full grid place-items-center bg-bg">
    <div className="text-center">
      <Logo className="h-8 text-navy mx-auto mb-3"/>
      <div className="flex items-center justify-center gap-2 text-slate-500 text-sm">
        <span className="w-4 h-4 rounded-full border-2 border-slate-300 border-t-gold animate-spin"/>
        Loading your portfolio…
      </div>
    </div>
  </div>;
}

/* ============================================================
   LOGIN
   ============================================================ */
function Login(){
  const {login,loginGoogle}=useApp();
  const [u,setU]=useState(''); const [p,setP]=useState(''); const [err,setErr]=useState(''); const [warn,setWarn]=useState(false);
  const [busy,setBusy]=useState(false); const attemptsRef=useRef(0);
  const clientId=GOOGLE_CLIENT_ID;
  const [showPw,setShowPw]=useState(!clientId); // when Google is available it's the primary path
  const gref=useRef();
  useEffect(()=>{
    if(!clientId) return; let cancelled=false;
    const init=()=>{
      if(cancelled||!window.google?.accounts?.id||!gref.current) return;
      window.google.accounts.id.initialize({ client_id:clientId, callback:async(resp)=>{
        setBusy(true); setErr('');
        try{ await loginGoogle(resp.credential); }
        catch(ex){ setErr(ex.message||'Google sign-in failed'); setBusy(false); }
      }});
      window.google.accounts.id.renderButton(gref.current,{ theme:'outline', size:'large', text:'signin_with', shape:'pill', width:300 });
    };
    if(window.google?.accounts?.id) init();
    else { const s=document.createElement('script'); s.src='https://accounts.google.com/gsi/client'; s.async=true; s.defer=true; s.onload=init; document.head.appendChild(s); }
    return ()=>{ cancelled=true; };
  },[clientId]);
  async function submit(e){
    e.preventDefault(); if(busy) return; setBusy(true); setErr('');
    try{ await login(u.trim(),p); attemptsRef.current=0; }
    catch(ex){
      attemptsRef.current+=1;
      setErr(ex.message||'Invalid email or password.');
      if(attemptsRef.current>=3) setWarn(true);
    } finally{ setBusy(false); }
  }
  return <div className="min-h-full grid place-items-center bg-navy relative overflow-hidden p-4">
    <div className="absolute inset-0 opacity-[0.07]" style={{backgroundImage:'radial-gradient(circle at 20% 20%, #C9A24D 0, transparent 40%), radial-gradient(circle at 80% 70%, #3B82F6 0, transparent 40%)'}}/>
    <div className="relative w-full max-w-sm">
      <div className="text-center mb-7">
        <Logo className="h-11 text-white mx-auto"/>
        <div className="text-slate-300 text-sm mt-1">Control Center</div>
      </div>
      <div className="bg-white rounded-2xl shadow-2xl p-6 space-y-4">
        <h1 className="text-lg font-semibold text-navy">Sign in</h1>
        {clientId&&<>
          <div className="flex justify-center min-h-[44px]" ref={gref}/>
          <p className="text-[11px] text-slate-400 text-center">Use your <span className="font-medium text-slate-500">@lno.company</span> Google account.</p>
        </>}
        {err&&<div className="text-sm text-danger flex items-center gap-2"><Icon name="triangle" className="w-4 h-4 shrink-0"/>{err}</div>}
        {clientId&&!showPw&&<button onClick={()=>setShowPw(true)} className="w-full text-xs text-slate-400 hover:text-navy">Sign in with a password instead</button>}
        {showPw&&<form onSubmit={submit} className="space-y-4">
          {clientId&&<div className="flex items-center gap-2 pt-1"><div className="flex-1 border-t border-slate-200"/><span className="text-[10px] uppercase tracking-wide text-slate-400">email sign-in</span><div className="flex-1 border-t border-slate-200"/></div>}
          <Field label="Email"><Input type="email" value={u} onChange={e=>setU(e.target.value)} placeholder="you@example.com" autoFocus={!clientId}/></Field>
          <Field label="Password"><Input type="password" value={p} onChange={e=>setP(e.target.value)} placeholder="••••••"/></Field>
          <Btn className="w-full" type="submit" disabled={busy}>{busy?'Signing in…':'Sign in'}</Btn>
        </form>}
        {warn&&<div className="text-xs bg-danger/10 text-danger rounded-lg p-2.5 flex items-start gap-2"><Icon name="shield" className="w-4 h-4 mt-0.5 shrink-0"/><span>Multiple failed attempts detected. A security alert has been dispatched to the operations team.</span></div>}
        {!clientId&&<div className="text-[11px] text-slate-400 text-center">Default admin: <span className="font-mono">admin@lno.company / admin</span></div>}
      </div>
    </div>
  </div>;
}

/* ============================================================
   LAYOUT — SIDEBAR / HEADER
   ============================================================ */
// Nav entries: [icon, label, path, shortLabel, perm]. perm gates visibility (admins have all).
const MAIN_NAV=[
  ['activity','Activity Dashboard','/activity','Activity','view_activity'],
  ['radio','Live','/realtime','Live','view_realtime'],
  ['briefcase','Positions','/trades','Positions','view_trades'],
  ['trendup','Prices','/prices','Prices','view_activity'],
];
const TOOLS_NAV=[
  ['layers','Funds','/funds','Funds','view_trades'],
  ['database','System Status','/status','Status','view_activity'],
  ['filetext','Reports','/admin/reports','Reports','view_reports'],
];
const ADMIN_NAV=[
  ['list','Bots','/admin/bots'],
  ['users','Users','/admin/users'],
  ['link','Exchanges','/admin/exchanges'],
  ['msg','WhatsApp','/admin/openwa'],
];
const ACCT_NAV=[
  ['usercircle','Profile','/profile'],
  ['lifebuoy','Support','/support'],
];

function NavItem({icon,label,path,active,onClick}){
  return <button onClick={onClick} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${active?'bg-gold text-navy font-semibold':'text-slate-300 hover:bg-white/5 hover:text-white'}`}>
    <Icon name={icon} className="w-[18px] h-[18px]"/>{label}
  </button>;
}
function Sidebar(){
  const {route,navigate,user}=useApp();
  const cur='/'+route.parts.join('/');
  const isAct=(p)=> cur===p || cur.startsWith(p+'/');
  return <aside className="hidden lg:flex flex-col w-60 shrink-0 bg-navy text-white h-full">
    <div className="px-5 py-5 flex items-center gap-2">
      <Logo className="h-6 text-white"/>
      <div className="text-[10px] text-slate-400 leading-tight mt-1.5">Control<br/>Center</div>
    </div>
    <nav className="flex-1 overflow-y-auto px-3 space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 px-3 pt-2 pb-1">Main</div>
      {MAIN_NAV.filter(([i,l,p,s,perm])=>hasPerm(user,perm)).map(([i,l,p])=><NavItem key={p} icon={i} label={l} path={p} active={isAct(p)} onClick={()=>navigate(p)}/>)}
      <div className="text-[10px] uppercase tracking-wider text-slate-500 px-3 pt-4 pb-1">Tools</div>
      {TOOLS_NAV.filter(([i,l,p,s,perm])=>hasPerm(user,perm)).map(([i,l,p])=><NavItem key={p} icon={i} label={l} path={p} active={isAct(p)} onClick={()=>navigate(p)}/>)}
      {user.role==='admin'&&<>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 px-3 pt-4 pb-1">Administration</div>
        {ADMIN_NAV.map(([i,l,p])=><NavItem key={p} icon={i} label={l} path={p} active={isAct(p)} onClick={()=>navigate(p)}/>)}
      </>}
      <div className="text-[10px] uppercase tracking-wider text-slate-500 px-3 pt-4 pb-1">Account</div>
      {ACCT_NAV.map(([i,l,p])=><NavItem key={p} icon={i} label={l} path={p} active={isAct(p)} onClick={()=>navigate(p)}/>)}
    </nav>
    <div className="p-3 border-t border-white/10">
      <div className="text-[11px] text-slate-400 px-2">LNO Trading Systems<br/>Internal Use Only</div>
    </div>
  </aside>;
}

// Global search over detected bots (by symbol / exchange / assigned fund).
function GlobalSearch(){
  const {navigate,data,funds,user}=useApp();
  const [q,setQ]=useState(''); const [open,setOpen]=useState(false); const ref=useRef();
  useEffect(()=>{ const h=e=>{ if(ref.current&&!ref.current.contains(e.target))setOpen(false); }; document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h); },[]);
  const res=useMemo(()=>{
    if(!q.trim())return null; const s=q.toLowerCase();
    const bots=(data?data.bots:[]).filter(b=> b.symbol.toLowerCase().includes(s)||b.exchange.toLowerCase().includes(s)||(fundOf(funds,b)?.name||'').toLowerCase().includes(s)).slice(0,8);
    return {bots};
  },[q,data,funds]);
  const go=user&&user.role==='admin'?'/admin/bots':'/trades';
  return <div ref={ref} className="relative flex-1 max-w-md">
    <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
    <input value={q} onFocus={()=>setOpen(true)} onChange={e=>{setQ(e.target.value);setOpen(true);}} placeholder="Search positions by symbol…" className="w-full bg-slate-100 focus:bg-white border border-transparent focus:border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none"/>
    {open&&res&&<div className="absolute z-40 mt-1.5 w-full bg-white rounded-xl shadow-xl border border-slate-200 p-2 max-h-96 overflow-y-auto fadein">
      {res.bots.length===0&&<div className="text-sm text-slate-400 px-3 py-4 text-center">No results</div>}
      {res.bots.length>0&&<div><div className="text-[10px] uppercase tracking-wide text-slate-400 px-2 py-1">Positions</div>{res.bots.map(b=>{ const f=fundOf(funds,b); return <button key={b.id} onClick={()=>{navigate(go);setOpen(false);setQ('');}} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 text-sm flex items-center justify-between gap-2"><span className="flex items-center gap-2"><span className="font-mono text-xs text-navy">{b.symbol}</span>{f&&<span className="w-2 h-2 rounded-full" style={{background:f.color}}/>}<span className="text-[11px] text-slate-400">{b.exchange}</span></span><span className={'font-mono text-xs '+clsPnl(b.unrealizedPnl)}>{fmtSigned(b.unrealizedPnl)}</span></button>; })}</div>}
    </div>}
  </div>;
}

function Header(){
  const {user,navigate,logout,dataStatus}=useApp();
  const [bell,setBell]=useState(false); const [menu,setMenu]=useState(false);
  const [alerts,setAlerts]=useState([]);
  const bref=useRef(), mref=useRef();
  useEffect(()=>{ const h=e=>{ if(bref.current&&!bref.current.contains(e.target))setBell(false); if(mref.current&&!mref.current.contains(e.target))setMenu(false); }; document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h); },[]);
  const loadAlerts=()=>api('alerts').then(r=>setAlerts(r.alerts||[])).catch(()=>{});
  useEffect(()=>{ loadAlerts(); const iv=setInterval(loadAlerts,60000); return ()=>clearInterval(iv); },[]);
  const unacked=alerts.filter(a=>!a.ackedAt).length;
  async function ack(id){ try{ await api('alerts',{method:'POST',body:{id}}); loadAlerts(); }catch(e){ toast.error(e.message); } }
  return <header className="h-16 shrink-0 bg-white border-b border-slate-200 flex items-center gap-4 px-4 lg:px-6">
    <Logo className="lg:hidden h-6 text-navy"/>
    <GlobalSearch/>
    {user.firstName&&<div className="hidden md:block text-sm text-slate-500">Hello, <span className="font-semibold text-navy">{user.firstName}</span></div>}
    <LiveBadge status={dataStatus}/>
    <div ref={bref} className="relative">
      <button onClick={()=>setBell(!bell)} className="relative p-2 rounded-lg hover:bg-slate-100"><Icon name="bell" className="w-5 h-5 text-slate-600"/>{unacked>0&&<span className="absolute top-1 right-1 min-w-4 h-4 px-1 bg-danger text-white text-[10px] rounded-full grid place-items-center">{unacked}</span>}</button>
      {bell&&<div className="absolute right-0 mt-1.5 w-80 bg-white rounded-xl shadow-xl border border-slate-200 p-2 z-40 fadein max-h-96 overflow-y-auto">
        <div className="text-xs font-semibold text-navy px-2 py-1.5 flex items-center justify-between">Alerts {unacked>0&&<span className="text-[10px] text-danger font-normal">{unacked} pending ack</span>}</div>
        {alerts.length===0 && <div className="text-xs text-slate-400 px-2 py-4 text-center">No alerts.</div>}
        {alerts.map(a=><div key={a.id} className="px-2 py-2 rounded-lg hover:bg-slate-50 flex gap-2.5">
          <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${a.ackedAt?'bg-success':'bg-danger'}`}/>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-navy leading-snug">{a.summary}</div>
            <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
              <span className="font-mono">{a.code}</span><span>{fmtDT(a.createdAt)}</span>
              {a.ackedAt? <span className="text-success">✓ acked{a.ackedBy?' · '+a.ackedBy:''}</span> : (user.role==='admin'&&<button onClick={()=>ack(a.id)} className="text-gold hover:underline">acknowledge</button>)}
            </div>
          </div>
        </div>)}
      </div>}
    </div>
    <div ref={mref} className="relative">
      <button onClick={()=>setMenu(!menu)} className="flex items-center">
        {user.avatar? <img src={user.avatar} className="w-9 h-9 rounded-full object-cover"/> : <span className="w-9 h-9 rounded-full bg-navy text-white grid place-items-center text-xs font-semibold">{initialsOf(user)}</span>}
      </button>
      {menu&&<div className="absolute right-0 mt-1.5 w-52 bg-white rounded-xl shadow-xl border border-slate-200 p-1.5 z-40 fadein">
        <div className="px-2.5 py-2 border-b border-slate-100 mb-1">
          <div className="text-sm font-semibold text-navy truncate">{user.firstName||user.email}</div>
          <div className="text-xs text-slate-400 truncate">{user.email}</div>
        </div>
        <button onClick={()=>{navigate('/profile');setMenu(false);}} className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-50 text-sm flex items-center gap-2"><Icon name="usercircle" className="w-4 h-4"/>Profile</button>
        <button onClick={()=>{navigate('/support');setMenu(false);}} className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-50 text-sm flex items-center gap-2"><Icon name="lifebuoy" className="w-4 h-4"/>Support</button>
        <button onClick={logout} className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-danger/10 text-danger text-sm flex items-center gap-2"><Icon name="logout" className="w-4 h-4"/>Sign out</button>
      </div>}
    </div>
  </header>;
}

function MobileNav(){
  const {route,navigate,user}=useApp();
  const cur='/'+route.parts.join('/');
  const [more,setMore]=useState(false);
  return <>
    <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 flex z-30">
      {MAIN_NAV.filter(([i,l,p,s,perm])=>hasPerm(user,perm)).map(([i,l,p,s])=><button key={p} onClick={()=>navigate(p)} className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] ${cur===p||cur.startsWith(p+'/')?'text-gold':'text-slate-500'}`}><Icon name={i} className="w-5 h-5"/>{s||l.split(' ')[0]}</button>)}
      <button onClick={()=>setMore(!more)} className="flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] text-slate-500"><Icon name="menu" className="w-5 h-5"/>More</button>
    </nav>
    {more&&<div className="lg:hidden fixed inset-0 z-40" onClick={()=>setMore(false)}><div className="absolute bottom-14 inset-x-3 bg-white rounded-xl shadow-xl border border-slate-200 p-2" onClick={e=>e.stopPropagation()}>
      {[...TOOLS_NAV.filter(([i,l,p,s,perm])=>hasPerm(user,perm)),...(user.role==='admin'?ADMIN_NAV:[]),...ACCT_NAV].map(([i,l,p])=><button key={p} onClick={()=>{navigate(p);setMore(false);}} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 text-sm"><Icon name={i} className="w-4 h-4"/>{l}</button>)}
    </div></div>}
  </>;
}

function PageHead({title,subtitle,actions}){
  return <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
    <div><h1 className="text-xl font-bold text-navy tracking-tight">{title}</h1>{subtitle&&<p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}</div>
    {actions&&<div className="flex items-center gap-2">{actions}</div>}
  </div>;
}
function Denied(){ return <div className="grid place-items-center h-full"><Card className="p-8 text-center max-w-sm"><Icon name="shield" className="w-10 h-10 mx-auto text-slate-300"/><h2 className="font-semibold text-navy mt-3">Access denied</h2><p className="text-sm text-slate-500 mt-1">You don't have permission to view this section.</p></Card></div>; }

/* ============================================================
   KPI CARD + shared bits
   ============================================================ */
function KpiCard({label,value,badge,icon,accent}){
  return <Card className="p-4">
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {icon&&<Icon name={icon} className="w-4 h-4 text-slate-300"/>}
    </div>
    <div className="mt-2 text-2xl font-bold text-navy tnum">{value}</div>
    {badge!=null&&<div className="mt-1">{badge}</div>}
  </Card>;
}
function TrendBadge({pct}){
  const up=pct>=0;
  return <span className={`inline-flex items-center gap-1 text-xs font-medium ${up?'text-success':'text-danger'}`}>
    <Icon name="trendup" className={'w-3.5 h-3.5 '+(up?'':'rotate-180')}/>{fmtPct(pct)}
  </span>;
}
function SortHeader({label,col,sort,setSort,align='left',className=''}){
  const active=sort.col===col;
  return <th className={`px-3 py-2.5 text-${align} font-medium text-slate-500 ${className}`}>
    <button onClick={()=>setSort({col,dir:active&&sort.dir==='asc'?'desc':'asc'})} className={`inline-flex items-center gap-1 hover:text-navy ${active?'text-navy':''}`}>
      {label}<Icon name="sort" className={`w-3 h-3 ${active?'opacity-100':'opacity-30'}`}/>
    </button>
  </th>;
}
function sortRows(rows,sort,getters){
  if(!sort.col) return rows; const g=getters[sort.col]; if(!g) return rows;
  const s=[...rows].sort((a,b)=>{ const va=g(a),vb=g(b); if(typeof va==='number')return va-vb; return String(va).localeCompare(String(vb)); });
  return sort.dir==='desc'?s.reverse():s;
}

/* ============================================================
   ACTIVITY DASHBOARD
   ============================================================ */
// Reusable empty-state card shown when a list/table has no rows yet.
function EmptyState({icon='database',title,hint,action}){
  return <Card className="p-10 text-center">
    <Icon name={icon} className="w-10 h-10 mx-auto text-slate-200 mb-2"/>
    <div className="text-sm font-medium text-navy">{title}</div>
    {hint&&<div className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">{hint}</div>}
    {action&&<div className="mt-4 flex justify-center">{action}</div>}
  </Card>;
}
// Coloured side label for a position (green LONG / red SHORT).
function SideTag({side}){ return <span className={side==='LONG'?'text-success font-medium':'text-danger font-medium'}>{side}</span>; }
// A fund's colour dot + name (or a muted "Unassigned").
function FundTag({fund,onClick}){
  if(!fund) return <span className="text-xs text-slate-400">Unassigned</span>;
  return <Badge color={fund.color} dot onClick={onClick}>{fund.name}</Badge>;
}

// Period selector operating on the real equity history (data.series).
function PeriodControls({period,setPeriod,custom,setCustom}){
  return <div className="flex flex-wrap items-center gap-2">
    <Select value={period} onChange={setPeriod} className="w-40" options={[{value:'7',label:'Last 7 days'},{value:'30',label:'Last 30 days'},{value:'90',label:'Last 90 days'},{value:'365',label:'Last 365 days'},{value:'all',label:'All time'},{value:'custom',label:'Custom range'}]}/>
    {period==='custom'&&<div className="flex items-center gap-1.5">
      <input type="date" className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm" onChange={e=>setCustom({...custom,start:e.target.value?new Date(e.target.value).getTime():null})}/>
      <span className="text-slate-400 text-sm">→</span>
      <input type="date" className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm" onChange={e=>setCustom({...custom,end:e.target.value?new Date(e.target.value).getTime()+DAY:null})}/>
    </div>}
  </div>;
}

// First-run setup nudge for admins on the main dashboard. Dismissible; the OpenWA
// step is detected live, the others are reminders the admin ticks off then dismisses.
function OnboardingCard(){
  const {user,navigate}=useApp();
  const [dismissed,setDismissed]=useState(()=>PREF.get('onboarding_dismissed',false));
  const [openwaOk,setOpenwaOk]=useState(null);
  useEffect(()=>{ if(user.role!=='admin')return; api('openwa').then(r=>setOpenwaOk(!!(r.config&&r.config.enabled))).catch(()=>{}); },[]);
  if(user.role!=='admin'||dismissed) return null;
  const steps=[
    {label:'Change the default admin password', done:false, to:'/profile'},
    {label:'Connect your Binance API key', done:false, to:'/admin/exchanges'},
    {label:'Set up WhatsApp alerts (TextMeBot)', done:!!openwaOk, to:'/admin/openwa'},
  ];
  const left=steps.filter(s=>!s.done).length;
  return <Card className="p-4 mb-5 border border-gold/30 bg-gold/5">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2"><Icon name="shield" className="w-4 h-4 text-gold"/><span className="text-sm font-semibold text-navy">Finish setting up your Control Center</span><span className="text-[11px] text-slate-400">{left} step{left>1?'s':''} left</span></div>
      <button onClick={()=>{setDismissed(true);PREF.set('onboarding_dismissed',true);}} className="text-slate-400 hover:text-navy text-xs flex items-center gap-1"><Icon name="x" className="w-3.5 h-3.5"/>Dismiss</button>
    </div>
    <div className="mt-3 grid sm:grid-cols-3 gap-2">
      {steps.map((s,i)=><button key={i} onClick={()=>navigate(s.to)} className="flex items-center gap-2 text-left p-2 rounded-lg border border-transparent hover:border-slate-200 hover:bg-white transition text-sm">
        <span className={`w-4 h-4 rounded-full grid place-items-center shrink-0 ${s.done?'bg-success text-white':'border border-slate-300'}`}>{s.done&&<Icon name="check" className="w-3 h-3"/>}</span>
        <span className={s.done?'text-slate-400 line-through':'text-navy'}>{s.label}</span>
      </button>)}
    </div>
  </Card>;
}


export {
  FUND_PALETTE, PERMISSIONS, ALL_PERMS, ROLE_PERMS, ROLE_OPTIONS, WA_MSG_TYPES, WA_ROLE_COLS, fmtUSD, fmtSigned, fmtNum, fmtPct, fmtPctPlain, clsPnl, fmtPrice, fmtDate, fmtAgo, fmtTime, fmtDT, fmtDur, initialsOf, DAY, NOW, baseOf, TOKEN_KEY, getToken, setToken, PREF, GOOGLE_CLIENT_ID, downloadBlob, b64ToBlob, toCSV, exportRows, api, _toastSubs, toast, Toaster, ICONS, Icon, GOLD, LNO_PATH, Logo, Card, SectionTitle, Btn, Badge, darken, StatusPill, Toggle, Select, Field, Input, ExportMenu, Modal, Confirm, AreaChart, App, useApp, hasPerm, fundOf, sliceByPeriod, riskMetrics, ExposureBars, RiskPanel, Underwater, PnlCalendar, LiveBadge, MarketTicker, LoadingScreen, Login, MAIN_NAV, TOOLS_NAV, ADMIN_NAV, ACCT_NAV, NavItem, Sidebar, GlobalSearch, Header, MobileNav, PageHead, Denied, KpiCard, TrendBadge, SortHeader, sortRows, EmptyState, SideTag, FundTag, PeriodControls, OnboardingCard
};
