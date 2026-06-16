import React from 'react'
import * as ReactDOM from 'react-dom/client'
import './index.css'

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

/* ============================================================
   FORMATTERS
   ============================================================ */
const fmtUSD = (n,d=0)=> (n<0?'-':'')+'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtSigned = (n,d=0)=> (n>=0?'+':'-')+'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtNum = (n,d=0)=> Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtPct = (n,d=1)=> (n>=0?'+':'')+n.toFixed(d)+'%';
const fmtPctPlain = (n,d=1)=> n.toFixed(d)+'%';
const clsPnl = (n)=> n>0?'text-success':n<0?'text-danger':'text-slate-500';
const fmtPrice = (p)=>{ if(p==null||!isFinite(p))return '—'; const d=p>=1000?2:p>=1?3:p>=0.01?5:8; return '$'+p.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}); };
const fmtDate = (t)=> new Date(t).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'});
const fmtTime = (t)=> new Date(t).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
const fmtDT = (t)=> fmtDate(t)+' '+fmtTime(t);
const fmtDur = (mins)=>{ mins=Math.round(mins); if(mins<60)return mins+'m'; const h=Math.floor(mins/60),m=mins%60; if(h<24)return h+'h'+(m?' '+m+'m':''); const d=Math.floor(h/24),hh=h%24; return d+'d'+(hh?' '+hh+'h':''); };
const initialsOf = (u)=>{ const a=(u.firstName||'').trim(), b=(u.lastName||'').trim(); if(a||b) return ((a[0]||'')+(b[0]||'')).toUpperCase(); return (u.email||'?').slice(0,2).toUpperCase(); };

/* ============================================================
   SEEDED RNG + MOCK DATA
   ============================================================ */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}
function seedStr(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}

const DAY = 86400000;
const NOW = Date.now();
const FALLBACK_PRICE = {BTCUSDT:67000,ETHUSDT:3500,AVAXUSDT:38,SOLUSDT:165,BNBUSDT:600,MATICUSDT:0.72,ADAUSDT:0.45,XRPUSDT:0.62};

const BASE_BOTS = [
  {id:'b1',name:'Alpha-BTC-Momentum',exchange:'Binance',symbol:'BTCUSDT',strategy:'Momentum'},
  {id:'b2',name:'Beta-ETH-Grid',exchange:'Binance',symbol:'ETHUSDT',strategy:'Grid'},
  {id:'b3',name:'Eta-AVAX-Breakout',exchange:'Bybit',symbol:'AVAXUSDT',strategy:'Breakout'},
  {id:'b4',name:'Gamma-SOL-Mean',exchange:'Bybit',symbol:'SOLUSDT',strategy:'Mean Reversion'},
  {id:'b5',name:'Delta-BNB-Arb',exchange:'OKX',symbol:'BNBUSDT',strategy:'Arbitrage'},
  {id:'b6',name:'Theta-MATIC-Grid',exchange:'OKX',symbol:'MATICUSDT',strategy:'Grid'},
  {id:'b7',name:'Epsilon-ADA-Trend',exchange:'Binance',symbol:'ADAUSDT',strategy:'Trend'},
  {id:'b8',name:'Zeta-XRP-Scalp',exchange:'Bybit',symbol:'XRPUSDT',strategy:'Scalping'},
];
const STATUSES = ['active','active','active','active','active','paused','error','inactive'];

/* ----- Exchange API client (Binance / Bybit / OKX public market data) ----- */
const EX = {
  parse(sym){ const quote = sym.endsWith('USDT')?'USDT':(sym.endsWith('USDC')?'USDC':'USD'); let base=sym.slice(0,sym.length-quote.length); const apiBase = base==='MATIC'?'POL':base; return {base,quote,apiBase}; },
  bn(sym){ const {apiBase,quote}=EX.parse(sym); return apiBase+quote; },
  okx(sym){ const {apiBase,quote}=EX.parse(sym); return apiBase+'-'+quote; },
  async json(url){ const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error('http '+r.status); return r.json(); },
};
async function fetchTickers(exchange, syms){
  const out={};
  if(exchange==='Binance'){
    const arr='['+syms.map(s=>'"'+EX.bn(s)+'"').join(',')+']';
    const j=await EX.json('https://api.binance.com/api/v3/ticker/24hr?symbols='+encodeURIComponent(arr));
    const by={}; j.forEach(x=>by[x.symbol]={price:+x.lastPrice,changePct:+x.priceChangePercent});
    syms.forEach(s=>{ const it=by[EX.bn(s)]; if(it) out[s]=it; });
  } else if(exchange==='Bybit'){
    await Promise.all(syms.map(async s=>{ const j=await EX.json('https://api.bybit.com/v5/market/tickers?category=spot&symbol='+EX.bn(s)); const it=j.result&&j.result.list&&j.result.list[0]; if(it) out[s]={price:+it.lastPrice,changePct:+it.price24hPcnt*100}; }));
  } else if(exchange==='OKX'){
    await Promise.all(syms.map(async s=>{ const j=await EX.json('https://www.okx.com/api/v5/market/ticker?instId='+EX.okx(s)); const it=j.data&&j.data[0]; if(it){ const last=+it.last, op=+it.open24h; out[s]={price:last,changePct:op?(last-op)/op*100:0}; } }));
  }
  return out;
}
async function fetchKlines(exchange, sym, limit, interval='day'){
  const iv = interval==='hour' ? {Binance:'1h',Bybit:'60',OKX:'1H'} : {Binance:'1d',Bybit:'D',OKX:'1D'};
  let rows=[];
  const M=k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],close:+k[4]});
  if(exchange==='Binance'){ const j=await EX.json(`https://api.binance.com/api/v3/klines?symbol=${EX.bn(sym)}&interval=${iv.Binance}&limit=${limit}`); rows=j.map(M); }
  else if(exchange==='Bybit'){ const j=await EX.json(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${EX.bn(sym)}&interval=${iv.Bybit}&limit=${limit}`); rows=((j.result&&j.result.list)||[]).map(M); }
  else { const j=await EX.json(`https://www.okx.com/api/v5/market/candles?instId=${EX.okx(sym)}&bar=${iv.OKX}&limit=${Math.min(limit,300)}`); rows=(j.data||[]).map(M); }
  return rows.filter(x=>isFinite(x.close)&&x.close>0).sort((a,b)=>a.t-b.t);
}

/* ----- deterministic fallbacks (used if a fetch fails) ----- */
function strategyBeta(strat,r){ const m={Momentum:[0.8,1.2],Breakout:[0.7,1.1],Trend:[0.7,1.1],'Mean Reversion':[0.25,0.5],Grid:[0.2,0.45],Scalping:[0.15,0.4],Arbitrage:[0.03,0.12]}; const x=m[strat]||[0.4,0.8]; return x[0]+r()*(x[1]-x[0]); }
function synthCloses(botId,n){ const b=BASE_BOTS.find(x=>x.id===botId); const r=mulberry32(seedStr(botId+'syn')); let p=FALLBACK_PRICE[b.symbol]||100; const out=[]; for(let i=n-1;i>=0;i--){ const ret=(r()+r()+r()-1.5)*0.03; p=Math.max(p*(1+ret),p*0.5); out.push({t:NOW-i*DAY,close:+p.toFixed(8)}); } return out; }
function normalizeCloses(real,botId,target=365){ if(real.length>=target) return real.slice(real.length-target); const need=target-real.length; const r=mulberry32(seedStr(botId+'pad')); let p=real[0].close, t=real[0].t; const head=[]; for(let i=0;i<need;i++){ t-=DAY; const ret=(r()+r()+r()-1.5)*0.02; p=Math.max(p/(1+ret),p*0.5); head.push({t,close:+p.toFixed(8)}); } head.sort((a,b)=>a.t-b.t); return head.concat(real); }

/* ----- loaders: fetch klines + tickers for all bots, never throw ----- */
async function loadAllKlines(){ const bots={}; let fails=0; await Promise.all(BASE_BOTS.map(async b=>{ try{ const r=await fetchKlines(b.exchange,b.symbol,365); if(!r.length) throw 0; bots[b.id]={closes:normalizeCloses(r,b.id),failed:false}; }catch(e){ fails++; bots[b.id]={closes:synthCloses(b.id,365),failed:true}; } })); return {bots,fails,allFail:fails===BASE_BOTS.length}; }
async function loadAllTickers(){ const byEx={}; BASE_BOTS.forEach(b=>{(byEx[b.exchange]=byEx[b.exchange]||[]).push(b);}); const out={}; let fails=0; await Promise.all(Object.entries(byEx).map(async([ex,bots])=>{ try{ const t=await fetchTickers(ex,bots.map(b=>b.symbol)); bots.forEach(b=>{ if(t[b.symbol]) out[b.id]={...t[b.symbol],failed:false}; else { out[b.id]={failed:true}; fails++; } }); }catch(e){ bots.forEach(b=>{ out[b.id]={failed:true}; }); fails+=bots.length; } })); return {bots:out,fails,allFail:fails===BASE_BOTS.length}; }

/* ----- dataset builders: real klines -> equity, live tickers -> prices/PnL ----- */
function genTrades(params){
  const r=mulberry32(99173); const out=[];
  for(let i=0;i<150;i++){
    const b=BASE_BOTS[Math.floor(r()*BASE_BOTS.length)];
    const ref=params[b.id].lastClose;
    const ageDays=r()*360; const entry=NOW-ageDays*DAY-r()*DAY; const durMin=8+r()*r()*5200;
    const isOpen=ageDays<2&&r()<0.5; const exit=isOpen?null:entry+durMin*60000;
    const side=r()<0.55?'Long':'Short'; const lev=[1,2,3,5,10,20][Math.floor(r()*6)];
    const entryPx=ref*(0.85+r()*0.3); const dir=side==='Long'?1:-1;
    // net-winning strategy: ~68% winners, losses cut smaller than wins (good risk management)
    const win=r()<0.68; const mag=0.004+r()*0.05; const move=dir*(win?1:-1)*(win?mag:mag*0.55); const exitPx=entryPx*(1+move);
    const size=Math.round(2000+r()*22000);
    const pnlPct=move*dir*lev*100; const pnl=size*(pnlPct/100);
    out.push({id:'t'+i,botId:b.id,bot:b.name,symbol:b.symbol,exchange:b.exchange,strategy:b.strategy,side,status:isOpen?'Open':'Closed',entry,exit,entryPx,exitPx:isOpen?null:exitPx,size,leverage:lev,pnl:isOpen?size*((r()-0.28)*0.05):pnl,pnlPct:isOpen?(r()-0.28)*7:pnlPct,durMin:isOpen?(NOW-entry)/60000:durMin});
  }
  return out.sort((a,b)=>b.entry-a.entry);
}
function buildStatic(klines){
  const params={},seriesBase={};
  BASE_BOTS.forEach((b,idx)=>{
    const closes=klines.bots[b.id].closes; const r=mulberry32(seedStr(b.id));
    // alpha = dominant positive daily drift (~+900%/yr compounded); beta dampened so the
    // real price moves add texture/drawdowns around the uptrend without reversing it.
    const e0=40000+Math.floor(r()*160000); const beta=strategyBeta(b.strategy,r)*0.50; const alpha=0.0055+r()*0.0017;
    const notional=Math.round(e0*(0.08+r()*0.22)); const side=r()<0.6?'Long':'Short';
    params[b.id]={e0,beta,alpha,notional,side,statusSeed:STATUSES[idx],failed:klines.bots[b.id].failed,lastClose:closes[closes.length-1].close};
    const s=[]; let eq=e0; s.push({t:closes[0].t,equity:eq});
    for(let i=1;i<closes.length;i++){ const ret=closes[i].close/closes[i-1].close-1; eq=Math.max(eq*(1+alpha+beta*ret),e0*0.25); s.push({t:closes[i].t,equity:Math.round(eq)}); }
    seriesBase[b.id]=s;
  });
  const trades=genTrades(params);
  const stats={}; BASE_BOTS.forEach(b=>{ const ts=trades.filter(t=>t.botId===b.id); const closed=ts.filter(t=>t.status==='Closed'); const wins=closed.filter(t=>t.pnl>0).length; stats[b.id]={pnl:ts.reduce((a,t)=>a+t.pnl,0),trades:ts.length,winRate:closed.length?wins/closed.length*100:0,open:ts.filter(t=>t.status==='Open').length}; });
  return {params,seriesBase,trades,stats};
}
function foldLive(stat,tickers){
  const bots={};
  BASE_BOTS.forEach(b=>{
    const p=stat.params[b.id]; const base=stat.seriesBase[b.id]; const tk=tickers[b.id]||{};
    const price=(tk.price!=null)?tk.price:p.lastClose; const changePct=(tk.changePct!=null)?tk.changePct:0;
    const series=base.slice();
    if(price&&p.lastClose){ const ret=price/p.lastClose-1; const last=series[series.length-1]; series[series.length-1]={t:last.t,equity:Math.max(Math.round(last.equity*(1+p.beta*ret)),1)}; }
    const livePnl=(p.side==='Long'?1:-1)*changePct/100*p.notional;
    const status=(p.failed&&tk.failed)?'error':p.statusSeed;
    bots[b.id]={price,changePct,series,currentEquity:series[series.length-1].equity,livePnl,side:p.side,notional:p.notional,status,failed:!!tk.failed};
  });
  return bots;
}

// Services & incidents & logs
const SERVICE_DEFS = [
  {name:'Market Data Feed',base:35,jit:20},
  {name:'Order Execution',base:70,jit:40},
  {name:'Binance Gateway',ex:'Binance'},
  {name:'Bybit Gateway',ex:'Bybit'},
  {name:'OKX Gateway',ex:'OKX'},
  {name:'Risk Engine',base:12,jit:15},
  {name:'WhatsApp Notifier',base:90,jit:60},
  {name:'Postgres Primary',base:5,jit:8},
];
async function pingOne(url){ const t0=performance.now(); try{ await fetch(url,{cache:'no-store',mode:'cors'}); return {ms:Math.round(performance.now()-t0),ok:true}; }catch(e){ return {ms:null,ok:false}; } }
async function pingExchanges(){ const [a,b,c]=await Promise.all([pingOne('https://api.binance.com/api/v3/ping'),pingOne('https://api.bybit.com/v5/market/time'),pingOne('https://www.okx.com/api/v5/public/time')]); return {Binance:a,Bybit:b,OKX:c}; }
function genIncidents(){
  const r=mulberry32(5521);
  const sev=['critical','warning','info','info','warning','info'];
  const msgs=[
    'Bybit gateway latency above threshold (340ms)',
    'Bot Theta-MATIC-Grid paused by risk engine',
    'Equity drawdown on Gamma-SOL-Mean exceeded -4%',
    'Market data reconnected after brief outage',
    'New deployment rolled out to execution service',
    'OKX rate-limit warning on Delta-BNB-Arb',
    'Bot Eta-AVAX-Breakout entered error state',
    'Daily settlement completed successfully',
    'WhatsApp notifier token refreshed',
    'Order rejected: insufficient margin on Zeta-XRP-Scalp',
  ];
  return msgs.map((m,i)=>({id:'inc'+i,severity:sev[i%sev.length],message:m,t:NOW-Math.floor(r()*3*DAY)})).sort((a,b)=>b.t-a.t);
}
const INCIDENTS = genIncidents();

function genLogs(){
  const r=mulberry32(3391);
  const levels=['critical','error','warning','info','info','info','debug'];
  const types=['signal','trading','position','system'];
  const out=[];
  for(let i=0;i<260;i++){
    const b=BASE_BOTS[Math.floor(r()*BASE_BOTS.length)];
    const type=types[Math.floor(r()*types.length)];
    const level=levels[Math.floor(r()*levels.length)];
    const t=NOW-Math.floor(r()*30*DAY);
    let msg;
    if(type==='signal') msg=`Signal generated: ${r()<0.5?'BUY':'SELL'} ${b.symbol} @ ${(FALLBACK_PRICE[b.symbol]*(0.95+r()*0.1)).toFixed(2)}`;
    else if(type==='trading') msg=`Order ${r()<0.5?'filled':'submitted'} ${b.symbol} size ${(1000+r()*8000).toFixed(0)}`;
    else if(type==='position') msg=`Position ${r()<0.5?'opened':'closed'} on ${b.symbol} pnl ${((r()-0.4)*500).toFixed(2)}`;
    else msg=`${['Heartbeat OK','Config reloaded','Cache warmup','Reconnect attempt','Risk check passed'][Math.floor(r()*5)]}`;
    out.push({id:'l'+i, t, level, type, source:type==='system'?'infra':b.name, message:msg, botId:type==='system'?null:b.id,
      meta:{requestId:'req_'+Math.floor(r()*1e6).toString(36), exchange:b.exchange, symbol:b.symbol, latencyMs:Math.floor(r()*200)}});
  }
  return out.sort((a,b)=>b.t-a.t);
}
const LOGS = genLogs();

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
// starred items (assets/bots) kept in localStorage
function useWatchlist(key){
  const [list,setList]=useState(()=>PREF.get(key,[]));
  const has=(id)=>list.includes(id);
  const toggle=(id)=>setList(l=>{ const n=l.includes(id)?l.filter(x=>x!==id):[...l,id]; PREF.set(key,n); return n; });
  return {list,has,toggle};
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
async function api(path,{method='GET',body}={}){
  const headers={}; const tok=getToken(); if(tok) headers['Authorization']='Bearer '+tok;
  if(body!==undefined) headers['Content-Type']='application/json';
  const r=await fetch('/api/'+path,{method,headers,body:body!==undefined?JSON.stringify(body):undefined});
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
function Field({label,children,hint}){ return <label className="block"><span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>{children}{hint&&<span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}</label>; }
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
function Donut({segments,size=180,onSlice}){
  const total=segments.reduce((a,s)=>a+s.value,0)||1;
  const r=size/2,cx=r,cy=r,ir=r*0.62; let ang=-Math.PI/2;
  return <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
    {segments.map((s,i)=>{
      const frac=s.value/total; const a2=ang+frac*2*Math.PI; const large=frac>0.5?1:0;
      const x1=cx+r*Math.cos(ang),y1=cy+r*Math.sin(ang),x2=cx+r*Math.cos(a2),y2=cy+r*Math.sin(a2);
      const xi1=cx+ir*Math.cos(a2),yi1=cy+ir*Math.sin(a2),xi2=cx+ir*Math.cos(ang),yi2=cy+ir*Math.sin(ang);
      const d=`M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} L${xi1} ${yi1} A${ir} ${ir} 0 ${large} 0 ${xi2} ${yi2} Z`;
      ang=a2;
      return <path key={i} d={d} fill={s.color} className={onSlice?'cursor-pointer hover:opacity-80':''} onClick={()=>onSlice&&onSlice(s)}/>;
    })}
    <circle cx={cx} cy={cy} r={ir-1} fill="#fff"/>
  </svg>;
}

/* ============================================================
   APP CONTEXT
   ============================================================ */
const App = createContext(null);
const useApp = ()=>useContext(App);

function hasPerm(user,perm){ if(!user)return false; if(user.role==='admin')return true; return (user.permissions||[]).includes(perm); }

// helpers using funds + live data
function fundOfBot(funds,botId){ return funds.find(f=>f.bots.includes(botId)); }
function totalEquity(data){ return BASE_BOTS.reduce((a,b)=>a+data.bots[b.id].currentEquity,0); }
function fundEquity(data,fund){ return (fund.bots.length/BASE_BOTS.length)*totalEquity(data); }

// build portfolio series for a set of botIds (align by shortest series)
function portfolioSeries(data,botIds){
  const ids=botIds&&botIds.length?botIds:BASE_BOTS.map(b=>b.id);
  const minLen=Math.min(...ids.map(id=>data.bots[id].series.length));
  const out=[];
  for(let i=0;i<minLen;i++){ let sum=0,t=0; ids.forEach(id=>{ const s=data.bots[id].series; const pt=s[s.length-minLen+i]; sum+=pt.equity; t=pt.t; }); out.push({t,equity:sum}); }
  return out;
}
function sliceByPeriod(series,period,custom){
  if(period==='all') return series;
  if(period==='custom'&&custom&&custom.start&&custom.end){
    return series.filter(p=>p.t>=custom.start&&p.t<=custom.end);
  }
  const days={ '7':7,'30':30,'90':90,'365':365 }[period]||30;
  const cutoff=NOW-days*DAY;
  return series.filter(p=>p.t>=cutoff);
}
function maxDrawdown(series){ let peak=-Infinity,mdd=0; series.forEach(p=>{ peak=Math.max(peak,p.equity); mdd=Math.min(mdd,(p.equity-peak)/peak); }); return mdd*100; }
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
function RiskPanel({series,botIds,data}){
  const m=riskMetrics(series);
  const byEx={},byAsset={};
  botIds.forEach(id=>{ const b=BASE_BOTS.find(x=>x.id===id); const eq=data.bots[id].currentEquity; byEx[b.exchange]=(byEx[b.exchange]||0)+eq; const base=EX.parse(b.symbol).base; byAsset[base]=(byAsset[base]||0)+eq; });
  const total=Object.values(byEx).reduce((a,b)=>a+b,0)||1;
  const M=({label,value,cls,tip})=><div className="bg-slate-50 rounded-lg p-3" title={tip||undefined}>
    <div className="text-[11px] text-slate-500 flex items-center gap-1">{label}{tip&&<Icon name="info" className="w-3 h-3 text-slate-300 cursor-help"/>}</div>
    <div className={`text-lg font-bold tnum mt-0.5 ${cls||'text-navy'}`}>{value}</div>
  </div>;
  return <Card className="p-5">
    <SectionTitle right={<span className="text-[11px] text-slate-400">on the selected period</span>}>Risk & Exposure</SectionTitle>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <M label="Sharpe" value={m.sharpe.toFixed(2)} tip="Risk-adjusted return: annualised mean daily return ÷ volatility of all returns. Higher is better — above 1 is solid, above 2 is excellent."/>
      <M label="Sortino" value={m.sortino.toFixed(2)} tip="Like Sharpe, but only downside (losing-day) volatility is penalised. Rewards strategies whose swings are mostly to the upside."/>
      <M label="Max Drawdown" value={fmtPctPlain(m.maxDrawdownPct)} cls="text-danger" tip="The largest peak-to-trough drop in equity over the period — your worst observed loss from a high-water mark."/>
      <M label="DD Duration" value={m.ddDurationDays+' d'} tip="Longest stretch, in days, the portfolio stayed below a previous equity peak before recovering."/>
    </div>
    <div className="grid sm:grid-cols-2 gap-5">
      <ExposureBars title="Exposure by exchange" items={Object.entries(byEx).sort((a,b)=>b[1]-a[1])} total={total}/>
      <ExposureBars title="Exposure by asset" items={Object.entries(byAsset).sort((a,b)=>b[1]-a[1])} total={total}/>
    </div>
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
  if(status==='live') return <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-success" data-tip="Live market data"><span className="w-2 h-2 rounded-full bg-success pulse-dot"/>LIVE</span>;
  if(status==='partial') return <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-amber-600"><span className="w-2 h-2 rounded-full bg-amber-500"/>PARTIAL</span>;
  if(status==='sim') return <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-slate-400"><span className="w-2 h-2 rounded-full bg-slate-400"/>SIM</span>;
  return <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-slate-400"><span className="w-2 h-2 rounded-full bg-slate-300 animate-pulse"/>…</span>;
}
function MarketTicker(){
  const {data}=useApp(); if(!data) return null;
  return <div className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-1 px-1">
    {BASE_BOTS.map(b=>{ const d=data.bots[b.id]; const base=EX.parse(b.symbol).base; return <div key={b.id} className="shrink-0 bg-white border border-slate-200/80 rounded-lg px-3 py-2 flex items-center gap-2.5">
      <span className="font-mono text-xs font-semibold text-navy">{base}</span>
      <span className="font-mono text-xs text-slate-600 tnum">{fmtPrice(d.price)}</span>
      <span className={`text-[11px] font-medium tnum ${clsPnl(d.changePct)}`}>{fmtPct(d.changePct)}</span>
    </div>; })}
  </div>;
}
function LoadingScreen({status}){
  return <div className="h-full grid place-items-center bg-bg">
    <div className="text-center">
      <Logo className="h-8 text-navy mx-auto mb-3"/>
      <div className="flex items-center justify-center gap-2 text-slate-500 text-sm">
        <span className="w-4 h-4 rounded-full border-2 border-slate-300 border-t-gold animate-spin"/>
        {status==='sim'?'Live data unavailable — loading simulation…':'Connecting to live market data…'}
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
  ['radio','Real-Time','/realtime','Live','view_realtime'],
  ['dollar','Prices','/prices','Prices','view_activity'],
  ['briefcase','Trades','/trades','Trades','view_trades'],
  ['list','Activity Log','/logs','Logs','view_logs'],
];
const TOOLS_NAV=[
  ['clock','Timeline','/timeline','Timeline','view_trades'],
  ['database','System Status','/status','Status','view_activity'],
  ['filetext','Reports','/admin/reports','Reports','view_reports'],
];
const ADMIN_NAV=[
  ['users','Users','/admin/users'],
  ['link','Exchanges','/admin/exchanges'],
  ['msg','WhatsApp','/admin/openwa'],
  ['layers','Funds','/admin/funds'],
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

function GlobalSearch(){
  const {navigate,data}=useApp();
  const [q,setQ]=useState(''); const [open,setOpen]=useState(false); const ref=useRef();
  useEffect(()=>{ const h=e=>{ if(ref.current&&!ref.current.contains(e.target))setOpen(false); }; document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h); },[]);
  const res=useMemo(()=>{
    if(!q.trim())return null; const s=q.toLowerCase();
    const bots=BASE_BOTS.filter(b=>b.name.toLowerCase().includes(s)||b.symbol.toLowerCase().includes(s)).slice(0,4);
    const trades=(data?data.trades:[]).filter(t=>t.bot.toLowerCase().includes(s)||t.symbol.toLowerCase().includes(s)||t.strategy.toLowerCase().includes(s)).slice(0,4);
    const logs=LOGS.filter(l=>l.message.toLowerCase().includes(s)||l.source.toLowerCase().includes(s)).slice(0,4);
    return {bots,trades,logs};
  },[q,data]);
  return <div ref={ref} className="relative flex-1 max-w-md">
    <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
    <input value={q} onFocus={()=>setOpen(true)} onChange={e=>{setQ(e.target.value);setOpen(true);}} placeholder="Search bots, trades, logs…" className="w-full bg-slate-100 focus:bg-white border border-transparent focus:border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none"/>
    {open&&res&&<div className="absolute z-40 mt-1.5 w-full bg-white rounded-xl shadow-xl border border-slate-200 p-2 max-h-96 overflow-y-auto fadein">
      {res.bots.length===0&&res.trades.length===0&&res.logs.length===0&&<div className="text-sm text-slate-400 px-3 py-4 text-center">No results</div>}
      {res.bots.length>0&&<div><div className="text-[10px] uppercase tracking-wide text-slate-400 px-2 py-1">Bots</div>{res.bots.map(b=><button key={b.id} onClick={()=>{navigate('/activity/bot/'+b.id+'?name='+encodeURIComponent(b.name));setOpen(false);setQ('');}} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 text-sm flex items-center justify-between"><span>{b.name}</span><span className="font-mono text-xs text-slate-400">{b.symbol}</span></button>)}</div>}
      {res.trades.length>0&&<div className="mt-1"><div className="text-[10px] uppercase tracking-wide text-slate-400 px-2 py-1">Trades</div>{res.trades.map(t=><button key={t.id} onClick={()=>{navigate('/trades');setOpen(false);setQ('');}} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 text-sm flex items-center justify-between"><span>{t.bot}</span><span className={'font-mono text-xs '+clsPnl(t.pnl)}>{fmtSigned(t.pnl)}</span></button>)}</div>}
      {res.logs.length>0&&<div className="mt-1"><div className="text-[10px] uppercase tracking-wide text-slate-400 px-2 py-1">Logs</div>{res.logs.map(l=><button key={l.id} onClick={()=>{navigate('/logs');setOpen(false);setQ('');}} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 text-sm truncate">{l.message}</button>)}</div>}
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
        {alerts.length===0 && <>
          {INCIDENTS.slice(0,5).map(i=><div key={i.id} className="px-2 py-2 rounded-lg hover:bg-slate-50 flex gap-2.5">
            <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${i.severity==='critical'?'bg-danger':i.severity==='warning'?'bg-amber-500':'bg-blue-500'}`}/>
            <div><div className="text-xs text-navy leading-snug">{i.message}</div><div className="text-[10px] text-slate-400 mt-0.5">{fmtDT(i.t)}</div></div>
          </div>)}
        </>}
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
function PeriodControls({period,setPeriod,custom,setCustom,fund,setFund,funds,showFund=true}){
  return <div className="flex flex-wrap items-center gap-2">
    {showFund&&<Select value={fund} onChange={setFund} className="w-40" options={[{value:'all',label:'All Funds'},...funds.map(f=>({value:f.id,label:f.name}))]}/>}
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
  useEffect(()=>{ if(user.role!=='admin')return; api('openwa').then(r=>setOpenwaOk(!!(r.config&&r.config.enabled&&r.config.hasApiKey))).catch(()=>{}); },[]);
  if(user.role!=='admin'||dismissed) return null;
  const steps=[
    {label:'Change the default admin password', done:false, to:'/profile'},
    {label:'Connect your exchange API keys', done:false, to:'/admin/exchanges'},
    {label:'Set up WhatsApp alerts (CallMeBot)', done:!!openwaOk, to:'/admin/openwa'},
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

function ActivityPage({botId}){
  const {funds,navigate,user,data}=useApp();
  const [period,setPeriod]=useState(()=>PREF.get('activity_period2','90'));
  const [custom,setCustom]=useState({start:null,end:null});
  const [fund,setFund]=useState(()=>PREF.get('activity_fund','all'));
  useEffect(()=>{ PREF.set('activity_period2',period); },[period]);
  useEffect(()=>{ PREF.set('activity_fund',fund); },[fund]);
  // a remembered fund that no longer exists falls back to the whole portfolio
  useEffect(()=>{ if(fund!=='all'&&funds.length&&!funds.find(f=>f.id===fund)) setFund('all'); },[funds]);// eslint-disable-line
  const [sort,setSort]=useState({col:'pnl',dir:'desc'});
  const [btc,setBtc]=useState(null); const [showBench,setShowBench]=useState(false);
  useEffect(()=>{ let alive=true; fetchKlines('Binance','BTCUSDT',365,'day').then(r=>{ if(!alive)return; const m={}; r.forEach(x=>{ m[new Date(x.t).toISOString().slice(0,10)]=x.close; }); setBtc(m); }).catch(()=>{}); return ()=>{alive=false;}; },[]);
  if(!hasPerm(user,'view_activity')) return <Denied/>;

  const bot = botId? BASE_BOTS.find(b=>b.id===botId): null;
  const selFund = fund!=='all'? funds.find(f=>f.id===fund): null;

  // scope botIds
  let botIds;
  if(bot) botIds=[bot.id];
  else if(selFund) botIds=selFund.bots;
  else botIds=BASE_BOTS.map(b=>b.id);

  const full=portfolioSeries(data,botIds);
  const series=sliceByPeriod(full,period,custom);
  const periodPnl = series.length>1? series[series.length-1].equity-series[0].equity : 0;
  const periodPnlPct = series.length>1? periodPnl/series[0].equity*100 : 0;
  const positive = periodPnl>=0;
  const eqNow = full[full.length-1].equity;

  // previous period comparison
  const prevSeries = useMemo(()=>{
    if(period==='all'||period==='custom') return null;
    const days={'7':7,'30':30,'90':90,'365':365}[period];
    const start=NOW-2*days*DAY, end=NOW-days*DAY;
    return full.filter(p=>p.t>=start&&p.t<=end);
  },[period,fund,botId]);

  // BTC buy-and-hold benchmark, normalised to the period's starting equity
  const benchmark = useMemo(()=>{
    if(!showBench||!btc||series.length<2) return null;
    const day=t=>new Date(t).toISOString().slice(0,10);
    const baseBtc=btc[day(series[0].t)]; if(!baseBtc) return null;
    let last=null;
    return series.map(p=>{ const c=btc[day(p.t)]; if(c!=null) last=c; return last!=null? series[0].equity*(last/baseBtc): NaN; });
  },[showBench,btc,series]);

  // trades in range
  const rangeStart = series.length? series[0].t : NOW;
  const inScope = (t)=> botIds.includes(t.botId);
  const rangeTrades = data.trades.filter(t=>inScope(t)&&t.entry>=rangeStart);
  const closedRange = rangeTrades.filter(t=>t.status==='Closed');
  const winRate = closedRange.length? closedRange.filter(t=>t.pnl>0).length/closedRange.length*100 : 0;
  const prevTrades = prevSeries? data.trades.filter(t=>inScope(t)&&t.entry>=prevSeries[0]?.t&&t.entry<rangeStart):[];
  const prevClosed = prevTrades.filter(t=>t.status==='Closed');
  const prevWin = prevClosed.length? prevClosed.filter(t=>t.pnl>0).length/prevClosed.length*100:0;

  // KPI day/week/month from full series
  const last=full[full.length-1].equity;
  const pnlDay=last-full[full.length-2].equity;
  const pnlWeek=last-full[full.length-8].equity;
  const pnlMonth=last-full[full.length-31].equity;
  const mdd=maxDrawdown(full);
  const activeBots=botIds.filter(id=>data.bots[id].status==='active').length;

  // bot ranking
  const ranking=botIds.map(id=>{ const b=BASE_BOTS.find(x=>x.id===id); const st=data.stats[id]; const f=fundOfBot(funds,id); return {...b,...st,fund:f,status:data.bots[id].status}; });
  const sortedRank=sortRows(ranking,sort,{name:r=>r.name,fund:r=>r.fund?.name||'',exchange:r=>r.exchange,symbol:r=>r.symbol,pnl:r=>r.pnl,winRate:r=>r.winRate,trades:r=>r.trades,status:r=>r.status});

  // recent positions
  const recent = bot? data.trades.filter(t=>t.botId===bot.id) : data.trades.filter(t=>inScope(t)).slice(0,10);
  const recentList = bot? recent : recent.slice(0,10);

  const title = bot? bot.name : selFund? selFund.name : 'Activity Dashboard';
  const subtitle = bot? `Individual bot · ${bot.exchange} · ${bot.symbol}` : selFund? `Fund overview · ${selFund.bots.length} bots` : 'Portfolio performance across all funds';

  const fundKpis = selFund? [
    ['Fund Equity', fmtUSD(fundEquity(data,selFund))],
    ['Fund PnL', fmtSigned(selFund.bots.reduce((a,id)=>a+data.stats[id].pnl,0)), selFund.bots.reduce((a,id)=>a+data.stats[id].pnl,0)],
    ['Active Bots', `${selFund.bots.filter(id=>data.bots[id].status==='active').length} / ${selFund.bots.length}`],
    ['Win Rate', fmtPctPlain(selFund.bots.reduce((a,id)=>a+data.stats[id].winRate,0)/selFund.bots.length)],
    ['Best Bot', BASE_BOTS.find(b=>b.id===selFund.bots.slice().sort((a,b)=>data.stats[b].pnl-data.stats[a].pnl)[0])?.name||'—'],
    ['Fund Share', fmtPctPlain(selFund.bots.length/BASE_BOTS.length*100)],
  ]:null;

  return <div>
    <PageHead title={title} subtitle={subtitle}
      actions={ bot? <Btn variant="outline" onClick={()=>navigate('/activity')}><Icon name="back" className="w-4 h-4"/>Back to LNO overview</Btn>
        : <PeriodControls {...{period,setPeriod,custom,setCustom,fund,setFund,funds}}/> }/>

    {bot&&<div className="mb-5"><PeriodControls {...{period,setPeriod,custom,setCustom,fund,setFund,funds}} showFund={false}/></div>}

    {!bot&&!selFund&&<OnboardingCard/>}
    {!bot&&!selFund&&<MarketTicker/>}

    {/* KPI cards */}
    {fundKpis? <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-5">
        {fundKpis.map(([l,v,raw],i)=><KpiCard key={i} label={l} value={<span className={raw!=null?clsPnl(raw):''}>{v}</span>}/>)}
      </div>
    : <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-5">
        <KpiCard label="Total Equity" value={fmtUSD(eqNow)} icon="dollar"/>
        <KpiCard label="PnL Day" value={<span className={clsPnl(pnlDay)}>{fmtSigned(pnlDay)}</span>} badge={<TrendBadge pct={pnlDay/eqNow*100}/>}/>
        <KpiCard label="PnL Week" value={<span className={clsPnl(pnlWeek)}>{fmtSigned(pnlWeek)}</span>} badge={<TrendBadge pct={pnlWeek/eqNow*100}/>}/>
        <KpiCard label="PnL Month" value={<span className={clsPnl(pnlMonth)}>{fmtSigned(pnlMonth)}</span>} badge={<TrendBadge pct={pnlMonth/eqNow*100}/>}/>
        <KpiCard label="Max Drawdown" value={<span className="text-danger">{fmtPctPlain(mdd)}</span>}/>
        <KpiCard label="Active Bots" value={`${activeBots} / ${botIds.length}`} icon="power"/>
      </div>}

    {/* Equity curve */}
    <Card className="p-5 mb-5">
      <SectionTitle right={<div className="flex items-center gap-3">
        <button onClick={()=>setShowBench(v=>!v)} className={`text-xs px-2 py-1 rounded-lg border transition ${showBench?'border-gold text-gold bg-gold/5':'border-slate-200 text-slate-500 hover:text-navy'}`}>vs BTC hold</button>
        <span className={`text-sm font-semibold ${clsPnl(periodPnl)}`}>{fmtSigned(periodPnl)} <span className="tnum">({fmtPct(periodPnlPct)})</span> this period</span>
      </div>}>Equity Curve</SectionTitle>
      <AreaChart data={series} positive={positive} resetKey={`${period}|${fund}|${botId||''}|${custom.start||''}`} benchmark={benchmark}/>
      <div className="flex justify-between text-[11px] text-slate-400 mt-1"><span>{series.length?fmtDate(series[0].t):''}</span><span>{series.length?fmtDate(series[series.length-1].t):''}</span></div>
    </Card>

    {/* Period summary */}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
      <Card className="p-4"><div className="text-xs text-slate-500">Period PnL</div><div className={`text-xl font-bold mt-1 tnum ${clsPnl(periodPnl)}`}>{fmtSigned(periodPnl)}</div></Card>
      <Card className="p-4"><div className="text-xs text-slate-500">Period PnL %</div><div className={`text-xl font-bold mt-1 tnum ${clsPnl(periodPnl)}`}>{fmtPct(periodPnlPct)}</div></Card>
      <Card className="p-4"><div className="text-xs text-slate-500">Win Rate</div><div className="text-xl font-bold mt-1 text-navy">{closedRange.length?fmtPctPlain(winRate):'—'}</div><div className="text-xs text-slate-400 mt-1">prev: {prevClosed.length?fmtPctPlain(prevWin):'—'}</div></Card>
      <Card className="p-4"><div className="text-xs text-slate-500">Total Trades</div><div className="text-xl font-bold mt-1 text-navy">{rangeTrades.length}</div><div className="text-xs text-slate-400 mt-1">prev: {prevTrades.length}</div></Card>
    </div>

    {/* Risk & exposure */}
    <div className="mb-5"><RiskPanel series={series} botIds={botIds} data={data}/></div>

    {/* Drawdown + PnL calendar */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
      <Card className="p-5"><SectionTitle right={<span className="text-[11px] text-slate-400">underwater</span>}>Drawdown</SectionTitle><Underwater series={series}/></Card>
      <Card className="p-5"><SectionTitle right={<span className="text-[11px] text-slate-400">daily</span>}>PnL Calendar</SectionTitle><PnlCalendar series={series}/></Card>
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      {/* Fund repartition (global only) */}
      {!bot&&!selFund&&<Card className="p-5 xl:col-span-1">
        <SectionTitle>Fund Repartition</SectionTitle>
        <div className="flex items-center justify-center mb-4">
          <Donut segments={funds.map(f=>({label:f.name,value:f.bots.length,color:f.color}))} onSlice={s=>{const f=funds.find(x=>x.name===s.label); if(f)setFund(f.id);}}/>
        </div>
        <div className="space-y-2.5">
          {funds.map(f=>{ const share=f.bots.length/BASE_BOTS.length*100; const eq=fundEquity(data,f); return <div key={f.id}>
            <div className="flex items-center justify-between text-xs mb-1">
              <button onClick={()=>setFund(f.id)} className="flex items-center gap-1.5 font-medium text-navy hover:underline"><span className="w-2.5 h-2.5 rounded-full" style={{background:f.color}}/>{f.name}</button>
              <span className="text-slate-400">{f.bots.length} bots · {fmtUSD(eq)}</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{width:share+'%',background:f.color}}/></div>
          </div>; })}
        </div>
      </Card>}

      {/* Bot performance ranking */}
      <Card className={`overflow-hidden ${!bot&&!selFund?'xl:col-span-2':'xl:col-span-3'}`}>
        <div className="p-5 pb-0"><SectionTitle right={hasPerm(user,'export_data')&&<ExportMenu filename="lno_bot_ranking" size="sm" variant="outline" label="Export"
          headers={['Bot','Fund','Exchange','Symbol','PnL','Win %','Trades','Status']}
          getRows={()=>sortedRank.map(r=>[r.name,r.fund?.name||'',r.exchange,r.symbol,Math.round(r.pnl),Number(r.winRate.toFixed(1)),r.trades,r.status])}/>}>Bot Performance Ranking</SectionTitle></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs"><tr className="border-b border-slate-100">
              <SortHeader label="Bot" col="name" sort={sort} setSort={setSort}/>
              <SortHeader label="Fund" col="fund" sort={sort} setSort={setSort}/>
              <SortHeader label="Exchange" col="exchange" sort={sort} setSort={setSort} className="hidden md:table-cell"/>
              <SortHeader label="Symbol" col="symbol" sort={sort} setSort={setSort} className="hidden md:table-cell"/>
              <SortHeader label="PnL" col="pnl" sort={sort} setSort={setSort} align="right"/>
              <SortHeader label="Win%" col="winRate" sort={sort} setSort={setSort} align="right" className="hidden sm:table-cell"/>
              <SortHeader label="Trades" col="trades" sort={sort} setSort={setSort} align="right" className="hidden sm:table-cell"/>
              <SortHeader label="Status" col="status" sort={sort} setSort={setSort}/>
            </tr></thead>
            <tbody>
              {sortedRank.map(r=><tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                <td className="px-3 py-2.5"><button onClick={()=>navigate('/activity/bot/'+r.id+'?name='+encodeURIComponent(r.name))} className="font-medium text-navy hover:text-gold">{r.name}</button></td>
                <td className="px-3 py-2.5">{r.fund&&<Badge color={r.fund.color} dot onClick={()=>setFund(r.fund.id)}>{r.fund.name}</Badge>}</td>
                <td className="px-3 py-2.5 hidden md:table-cell text-slate-500">{r.exchange}</td>
                <td className="px-3 py-2.5 hidden md:table-cell font-mono text-xs text-slate-500">{r.symbol}</td>
                <td className={`px-3 py-2.5 text-right font-medium tnum ${clsPnl(r.pnl)}`}>{fmtSigned(r.pnl)}</td>
                <td className="px-3 py-2.5 text-right hidden sm:table-cell tnum">{fmtPctPlain(r.winRate)}</td>
                <td className="px-3 py-2.5 text-right hidden sm:table-cell tnum">{r.trades}</td>
                <td className="px-3 py-2.5"><StatusPill status={r.status}/></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </Card>
    </div>

    {/* Recent / all positions */}
    <Card className="overflow-hidden mt-5">
      <div className="p-5 pb-0"><SectionTitle>{bot?'All Positions':'Recent Positions'}</SectionTitle></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
            <th className="px-3 py-2.5 text-left font-medium">Entry</th><th className="px-3 py-2.5 text-left font-medium hidden md:table-cell">Exit</th>
            {!bot&&<th className="px-3 py-2.5 text-left font-medium">Bot</th>}{!bot&&<th className="px-3 py-2.5 text-left font-medium">Fund</th>}
            <th className="px-3 py-2.5 text-left font-medium">Symbol</th><th className="px-3 py-2.5 text-left font-medium">Side</th>
            <th className="px-3 py-2.5 text-right font-medium">PnL</th><th className="px-3 py-2.5 text-right font-medium hidden sm:table-cell">PnL%</th>
            <th className="px-3 py-2.5 text-right font-medium hidden md:table-cell">Duration</th><th className="px-3 py-2.5 text-left font-medium">Status</th>
          </tr></thead>
          <tbody>
            {recentList.map(t=>{ const f=fundOfBot(funds,t.botId); return <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50/60">
              <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{fmtDT(t.entry)}</td>
              <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap hidden md:table-cell">{t.exit?fmtDT(t.exit):'—'}</td>
              {!bot&&<td className="px-3 py-2.5 font-medium text-navy">{t.bot}</td>}
              {!bot&&<td className="px-3 py-2.5">{f&&<Badge color={f.color} dot onClick={()=>setFund(f.id)}>{f.name}</Badge>}</td>}
              <td className="px-3 py-2.5 font-mono text-xs">{t.symbol}</td>
              <td className="px-3 py-2.5"><span className={t.side==='Long'?'text-success':'text-danger'}>{t.side}</span></td>
              <td className={`px-3 py-2.5 text-right font-medium tnum ${clsPnl(t.pnl)}`}>{fmtSigned(t.pnl)}</td>
              <td className={`px-3 py-2.5 text-right hidden sm:table-cell tnum ${clsPnl(t.pnlPct)}`}>{fmtPct(t.pnlPct)}</td>
              <td className="px-3 py-2.5 text-right hidden md:table-cell text-slate-500">{fmtDur(t.durMin)}</td>
              <td className="px-3 py-2.5"><StatusPill status={t.status}/></td>
            </tr>; })}
          </tbody>
        </table>
      </div>
    </Card>
  </div>;
}

/* ============================================================
   PRICES
   ============================================================ */
const ASSET_NAMES={BTC:'Bitcoin',ETH:'Ethereum',AVAX:'Avalanche',SOL:'Solana',BNB:'BNB',MATIC:'Polygon (POL)',ADA:'Cardano',XRP:'XRP',DOT:'Polkadot',LINK:'Chainlink'};
function uniqueAssets(){
  const seen={}, out=[];
  BASE_BOTS.forEach(b=>{ const base=EX.parse(b.symbol).base; if(!seen[base]){ seen[base]=1; out.push({base, symbol:b.symbol, exchange:b.exchange, botId:b.id}); } });
  return out;
}
function Candles({data,height=64}){
  if(!data||data.length<2) return <div style={{height}} className="grid place-items-center text-[11px] text-slate-300">loading…</div>;
  const w=240,h=height; const min=Math.min(...data.map(d=>d.l)),max=Math.max(...data.map(d=>d.h)); const range=(max-min)||1;
  const Y=v=>h-((v-min)/range)*(h*0.9)-h*0.05;
  const n=data.length, cw=w/n, bw=Math.max(1.4,cw*0.62);
  return <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{height}}>
    {data.map((d,i)=>{ const x=i*cw+cw/2; const up=d.close>=d.o; const c=up?'#10B981':'#EF4444';
      const yO=Y(d.o),yC=Y(d.close); const top=Math.min(yO,yC), bh=Math.max(0.8,Math.abs(yC-yO));
      return <g key={i}>
        <line x1={x} x2={x} y1={Y(d.h)} y2={Y(d.l)} stroke={c} strokeWidth="1" vectorEffect="non-scaling-stroke"/>
        <rect x={x-bw/2} y={top} width={bw} height={bh} fill={c}/>
      </g>;
    })}
  </svg>;
}
function PricesPage(){
  const {data,user}=useApp();
  const assets=useMemo(uniqueAssets,[]);
  const [spark,setSpark]=useState({});
  const wl=useWatchlist('watchlist_assets'); const [wlOnly,setWlOnly]=useState(false);
  useEffect(()=>{
    let alive=true;
    const load=async()=>{ const res={}; await Promise.all(assets.map(async a=>{ try{ const r=await fetchKlines(a.exchange,a.symbol,24,'hour'); res[a.base]=r; }catch(e){ res[a.base]=null; } })); if(alive)setSpark(res); };
    load(); const iv=setInterval(load,60000); return ()=>{alive=false;clearInterval(iv);};
  },[]);
  if(!hasPerm(user,'view_activity')) return <Denied/>;
  const shown=[...assets].sort((a,b)=>(wl.has(b.base)?1:0)-(wl.has(a.base)?1:0)).filter(a=>!wlOnly||wl.has(a.base));
  return <div>
    <PageHead title="Prices" subtitle="Live prices for the crypto assets traded by LNO bots"
      actions={<div className="flex items-center gap-3">
        <button onClick={()=>setWlOnly(v=>!v)} className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition ${wlOnly?'border-gold text-gold bg-gold/5':'border-slate-200 text-slate-500 hover:text-navy'}`}><Icon name="star" fill={wlOnly?'currentColor':'none'} className="w-3.5 h-3.5"/>Watchlist{wl.list.length>0&&<span className="text-[10px]">{wl.list.length}</span>}</button>
        <span className="flex items-center gap-1.5 text-xs text-success font-medium"><span className="w-2 h-2 rounded-full bg-success pulse-dot"/>Live · 24h change</span>
      </div>}/>
    {wlOnly&&shown.length===0&&<Card className="p-10 text-center text-slate-400 text-sm"><Icon name="star" className="w-9 h-9 mx-auto text-slate-200 mb-2"/>Your watchlist is empty — tap the ☆ on any asset to add it.</Card>}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {shown.map(a=>{
        const d=data.bots[a.botId]; const up=d.changePct>=0;
        const sp=spark[a.base]; const hi=sp&&sp.length?Math.max(...sp.map(x=>x.h)):null; const lo=sp&&sp.length?Math.min(...sp.map(x=>x.l)):null;
        const starred=wl.has(a.base);
        return <Card key={a.base} className="p-4 relative overflow-hidden">
          <span className="absolute left-0 top-0 bottom-0 w-1" style={{background:up?'#10B981':'#EF4444'}}/>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <button onClick={()=>wl.toggle(a.base)} title={starred?'Remove from watchlist':'Add to watchlist'} className={starred?'text-gold':'text-slate-300 hover:text-gold'}><Icon name="star" fill={starred?'currentColor':'none'} className="w-4 h-4"/></button>
                <span className="font-bold text-navy text-lg">{a.base}</span><span className="text-xs text-slate-400">{ASSET_NAMES[a.base]||a.base}</span>
              </div>
              <div className="text-2xl font-bold text-navy tnum mt-1">{fmtPrice(d.price)}</div>
            </div>
            <span className={`flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-semibold tnum ${up?'bg-success/10 text-success':'bg-danger/10 text-danger'}`}>
              <Icon name="trendup" className={'w-4 h-4 '+(up?'':'rotate-180')}/>{fmtPct(d.changePct)}
            </span>
          </div>
          <div className="mt-3"><Candles data={sp}/></div>
          <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2">
            <span>24h low <span className="tnum text-slate-500">{lo!=null?fmtPrice(lo):'—'}</span></span>
            <span className="font-mono text-slate-300">{a.exchange}</span>
            <span>24h high <span className="tnum text-slate-500">{hi!=null?fmtPrice(hi):'—'}</span></span>
          </div>
        </Card>;
      })}
    </div>
  </div>;
}

/* ============================================================
   REAL-TIME OPERATIONS
   ============================================================ */
function RealtimePage(){
  const {funds,user,data}=useApp();
  const [fund,setFund]=useState('all');
  const [alertsOn,setAlertsOn]=useState(true);
  const [tick,setTick]=useState(0);
  const [pins,setPins]=useState([]);
  const [perBot,setPerBot]=useState(()=>Object.fromEntries(BASE_BOTS.map(b=>[b.id,true])));
  const [sort,setSort]=useState({col:'',dir:'asc'});
  const services=useServiceHealth();
  useEffect(()=>{ const a=setInterval(()=>setTick(t=>t+1),5000); return ()=>clearInterval(a); },[]);
  if(!hasPerm(user,'view_realtime')) return <Denied/>;

  const selFund=fund!=='all'?funds.find(f=>f.id===fund):null;
  const botIds = selFund? selFund.bots : BASE_BOTS.map(b=>b.id);
  // live values derived from real tickers (refreshed every 5s)
  const activeBots=botIds.filter(id=>data.bots[id].status==='active').length;
  const livePnl=botIds.reduce((a,id)=>a+data.bots[id].livePnl,0);
  const openPos=botIds.reduce((a,id)=>a+data.stats[id].open,0)+3;

  let rows=botIds.map(id=>{ const b=BASE_BOTS.find(x=>x.id===id); const f=fundOfBot(funds,id); const d=data.bots[id]; return {...b,fund:f,status:d.status,live:d.livePnl,price:d.price,changePct:d.changePct,pos:data.stats[id].open>0?(d.side+' '+EX.parse(b.symbol).base):'—'}; });
  rows=sortRows(rows,sort,{bot:r=>r.name,fund:r=>r.fund?.name||'',symbol:r=>r.symbol,status:r=>r.status,live:r=>r.live,price:r=>r.price});
  rows.sort((a,b)=>(pins.includes(b.id)?1:0)-(pins.includes(a.id)?1:0));

  const sevBorder={critical:'border-danger',warning:'border-amber-500',info:'border-blue-500'};
  const sevIcon={critical:'triangle',warning:'triangle',info:'info'};

  return <div>
    <PageHead title="Real-Time Operations" subtitle={selFund?`Live view · ${selFund.name}`:'Live view of all bots · refreshing every 5s'}
      actions={<div className="flex items-center gap-3">
        <Select value={fund} onChange={setFund} className="w-40" options={[{value:'all',label:'All Funds'},...funds.map(f=>({value:f.id,label:f.name}))]}/>
        <div className="flex items-center gap-2 text-sm"><span className="text-slate-500">Alerts</span><Toggle on={alertsOn} onChange={setAlertsOn}/></div>
        <span className="flex items-center gap-1.5 text-xs text-success font-medium"><span className="w-2 h-2 rounded-full bg-success pulse-dot"/>Live</span>
      </div>}/>

    <MarketTicker/>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      <KpiCard label="Active Bots" value={`${activeBots} / ${botIds.length}`} icon="power"/>
      <KpiCard label="Live PnL" value={<span className={clsPnl(livePnl)}>{fmtSigned(livePnl)}</span>} badge={<span className="text-[11px] text-slate-400">updates every 5s</span>}/>
      <KpiCard label="Open Positions" value={openPos} icon="briefcase"/>
      <KpiCard label="System Alerts" value={INCIDENTS.filter(i=>i.severity!=='info').length} icon="bell"/>
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-5">
      <Card className="p-5">
        <SectionTitle right={<span className="text-[11px] text-slate-400">live ping · 10s</span>}>Service Health</SectionTitle>
        <div className="space-y-2">
          {services.map(s=><div key={s.name} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${s.status==='active'?'bg-success':s.status==='degraded'?'bg-amber-500':s.status==='pending'?'bg-slate-300 animate-pulse':'bg-danger'}`}/>{s.name}{s.ex&&<span className="text-[10px] text-slate-300">●</span>}</span>
            <span className={`font-mono text-xs ${s.latency==null?'text-slate-300':s.latency>250?'text-amber-600':'text-slate-400'}`}>{s.latency==null?(s.status==='down'?'down':'—'):s.latency+'ms'}</span>
          </div>)}
        </div>
      </Card>
      <Card className="p-5 xl:col-span-2">
        <SectionTitle right={<span className="text-[11px] text-slate-400">latest</span>}>Recent Incidents</SectionTitle>
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {INCIDENTS.map(i=><div key={i.id} className={`border-l-4 ${sevBorder[i.severity]} bg-slate-50/70 rounded-r-lg px-3 py-2 flex items-start gap-2`}>
            <Icon name={sevIcon[i.severity]} className={`w-4 h-4 mt-0.5 shrink-0 ${i.severity==='critical'?'text-danger':i.severity==='warning'?'text-amber-500':'text-blue-500'}`}/>
            <div className="flex-1"><div className="text-sm text-navy leading-snug">{i.message}</div><div className="text-[11px] text-slate-400 mt-0.5">{fmtDT(i.t)}</div></div>
          </div>)}
        </div>
      </Card>
    </div>

    <Card className="overflow-hidden">
      <div className="p-5 pb-0"><SectionTitle right={<span className="flex items-center gap-1.5 text-xs text-success"><span className="w-1.5 h-1.5 rounded-full bg-success pulse-dot"/>updating</span>}>Live Bot Status</SectionTitle></div>
      {/* desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
            <th className="px-3 py-2.5 w-8"></th>
            <SortHeader label="Bot" col="bot" sort={sort} setSort={setSort}/>
            <SortHeader label="Fund" col="fund" sort={sort} setSort={setSort}/>
            <SortHeader label="Symbol" col="symbol" sort={sort} setSort={setSort}/>
            <SortHeader label="Last Price" col="price" sort={sort} setSort={setSort} align="right"/>
            <SortHeader label="Status" col="status" sort={sort} setSort={setSort}/>
            <th className="px-3 py-2.5 text-left font-medium">Position</th>
            <SortHeader label="Live PnL" col="live" sort={sort} setSort={setSort} align="right"/>
            <th className="px-3 py-2.5 text-left font-medium">Last Action</th>
            <th className="px-3 py-2.5 w-10"></th>
          </tr></thead>
          <tbody>
            {rows.map(r=><tr key={r.id} className={`border-b border-slate-50 hover:bg-slate-50/60 ${pins.includes(r.id)?'bg-gold/5':''}`}>
              <td className="px-3 py-2.5"><button onClick={()=>setPins(p=>p.includes(r.id)?p.filter(x=>x!==r.id):[...p,r.id])} className={pins.includes(r.id)?'text-gold':'text-slate-300 hover:text-slate-500'}><Icon name="pin" className="w-4 h-4"/></button></td>
              <td className="px-3 py-2.5"><div className="font-medium text-navy">{r.name}</div><div className="text-[11px] text-slate-400">{r.exchange}</div></td>
              <td className="px-3 py-2.5">{r.fund&&<Badge color={r.fund.color} dot onClick={()=>setFund(r.fund.id)}>{r.fund.name}</Badge>}</td>
              <td className="px-3 py-2.5 font-mono text-xs">{r.symbol}</td>
              <td className="px-3 py-2.5 text-right"><div className="font-mono text-xs text-navy tnum">{fmtPrice(r.price)}</div><div className={`text-[10px] tnum ${clsPnl(r.changePct)}`}>{fmtPct(r.changePct)}</div></td>
              <td className="px-3 py-2.5"><StatusPill status={r.status}/></td>
              <td className="px-3 py-2.5 text-slate-500">{r.pos}</td>
              <td className={`px-3 py-2.5 text-right font-medium tnum ${clsPnl(r.live)}`}>{fmtSigned(r.live)}</td>
              <td className="px-3 py-2.5 text-slate-500 text-xs">{['Order filled','Signal check','Position sync','Heartbeat'][r.id.charCodeAt(1)%4]}<br/><span className="text-slate-400">{fmtTime(NOW-((tick%6)+1)*60000)}</span></td>
              <td className="px-3 py-2.5"><button onClick={()=>setPerBot(s=>({...s,[r.id]:!s[r.id]}))} className={perBot[r.id]&&alertsOn?'text-gold':'text-slate-300 hover:text-slate-500'}><Icon name="bell" className="w-4 h-4"/></button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {/* mobile cards */}
      <div className="md:hidden p-3 space-y-2">
        {rows.map(r=><div key={r.id} className="border border-slate-100 rounded-lg p-3">
          <div className="flex items-center justify-between"><div className="font-medium text-navy">{r.name}</div><StatusPill status={r.status}/></div>
          <div className="flex items-center justify-between mt-2">{r.fund&&<Badge color={r.fund.color} dot>{r.fund.name}</Badge>}<span className={`font-medium tnum ${clsPnl(r.live)}`}>{fmtSigned(r.live)}</span></div>
        </div>)}
      </div>
    </Card>
  </div>;
}

/* ============================================================
   TABLE PRODUCTIVITY HELPERS — virtual rows, column picker, presets
   ============================================================ */
// Windowed row virtualization for a fixed-row-height scroll container.
function useVirtual({count,rowH,overscan=10,resetKey}){
  const ref=useRef(null);
  const [scrollTop,setScrollTop]=useState(0);
  const [h,setH]=useState(640);
  useEffect(()=>{ const el=ref.current; if(!el)return; const onScroll=()=>setScrollTop(el.scrollTop); const measure=()=>setH(el.clientHeight||640); measure(); el.addEventListener('scroll',onScroll,{passive:true}); window.addEventListener('resize',measure); return ()=>{ el.removeEventListener('scroll',onScroll); window.removeEventListener('resize',measure); }; },[]);
  useEffect(()=>{ const el=ref.current; if(el) el.scrollTop=0; setScrollTop(0); },[resetKey]);
  const start=Math.max(0,Math.floor(scrollTop/rowH)-overscan);
  const end=Math.min(count,Math.ceil((scrollTop+h)/rowH)+overscan);
  return {ref,start,end,padTop:start*rowH,padBottom:Math.max(0,(count-end)*rowH)};
}
// Show/hide columns; order always follows the canonical `columns` array.
function ColumnPicker({columns,visible,onChange}){
  const [open,setOpen]=useState(false); const ref=useRef();
  useEffect(()=>{ const h=e=>{ if(ref.current&&!ref.current.contains(e.target))setOpen(false); }; document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h); },[]);
  const toggle=(k)=>{ const set=new Set(visible); set.has(k)?set.delete(k):set.add(k); if(set.size===0)return; onChange(columns.filter(c=>set.has(c.key)).map(c=>c.key)); };
  return <div ref={ref} className="relative">
    <Btn variant="outline" size="sm" onClick={()=>setOpen(o=>!o)}><Icon name="columns" className="w-4 h-4"/>Columns</Btn>
    {open&&<div className="absolute right-0 mt-1 w-52 bg-white rounded-lg shadow-xl border border-slate-200 p-2 z-40 fadein max-h-72 overflow-y-auto">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 px-1 pb-1">Visible columns</div>
      {columns.map(c=><label key={c.key} className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-slate-50 text-sm cursor-pointer text-navy">
        <input type="checkbox" checked={visible.includes(c.key)} onChange={()=>toggle(c.key)} className="accent-navy w-4 h-4"/>{c.label}
      </label>)}
    </div>}
  </div>;
}
// Saved views: persists named snapshots (filters/sort/columns) to localStorage.
function PresetMenu({storeKey,current,onApply}){
  const [presets,setPresets]=useState(()=>PREF.get(storeKey,[]));
  const [open,setOpen]=useState(false); const [name,setName]=useState(''); const ref=useRef();
  useEffect(()=>{ const h=e=>{ if(ref.current&&!ref.current.contains(e.target))setOpen(false); }; document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h); },[]);
  const persist=(next)=>{ setPresets(next); PREF.set(storeKey,next); };
  const save=()=>{ const n=name.trim(); if(!n)return; persist([...presets.filter(p=>p.name!==n),{name:n,state:current}]); setName(''); toast.success(`View “${n}” saved`); };
  return <div ref={ref} className="relative">
    <Btn variant="outline" size="sm" onClick={()=>setOpen(o=>!o)}><Icon name="save" className="w-4 h-4"/>Views{presets.length>0&&<span className="text-[10px] text-slate-400">{presets.length}</span>}</Btn>
    {open&&<div className="absolute right-0 mt-1 w-60 bg-white rounded-lg shadow-xl border border-slate-200 p-2 z-40 fadein">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 px-1 pb-1">Saved views</div>
      {presets.length===0&&<div className="text-xs text-slate-400 px-1 py-2">No saved views yet — set up filters and columns, then save.</div>}
      {presets.map(p=><div key={p.name} className="flex items-center gap-1">
        <button onClick={()=>{onApply(p.state);setOpen(false);}} className="flex-1 text-left px-2 py-1.5 rounded-md hover:bg-slate-50 text-sm text-navy truncate">{p.name}</button>
        <button onClick={()=>persist(presets.filter(x=>x.name!==p.name))} className="text-slate-300 hover:text-danger px-1" title="Delete view"><Icon name="trash" className="w-3.5 h-3.5"/></button>
      </div>)}
      <div className="flex items-center gap-1 mt-2 pt-2 border-t border-slate-100">
        <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')save();}} placeholder="Save current view…" className="flex-1 min-w-0 bg-slate-100 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"/>
        <Btn size="sm" onClick={save} disabled={!name.trim()}>Save</Btn>
      </div>
    </div>}
  </div>;
}

/* ============================================================
   TRADES
   ============================================================ */
const TRADE_COLS=[
  {key:'entry',label:'Entry',cell:t=>fmtDT(t.entry),csv:t=>fmtDT(t.entry),cls:'text-slate-500',def:true},
  {key:'exit',label:'Exit',cell:t=>t.exit?fmtDT(t.exit):'—',csv:t=>t.exit?fmtDT(t.exit):'',cls:'text-slate-500',def:true},
  {key:'bot',label:'Bot',cell:t=><span className="font-medium text-navy">{t.bot}</span>,csv:t=>t.bot,def:true},
  {key:'symbol',label:'Symbol',cell:t=><span className="font-mono text-xs">{t.symbol}</span>,csv:t=>t.symbol,def:true},
  {key:'exchange',label:'Exchange',cell:t=><span className="text-slate-500">{t.exchange}</span>,csv:t=>t.exchange,def:true},
  {key:'side',label:'Side',cell:t=><span className={t.side==='Long'?'text-success':'text-danger'}>{t.side}</span>,csv:t=>t.side,def:true},
  {key:'status',label:'Status',cell:t=><StatusPill status={t.status}/>,csv:t=>t.status,def:true},
  {key:'pnl',label:'PnL',align:'right',cell:t=><span className={`font-medium tnum ${clsPnl(t.pnl)}`}>{fmtSigned(t.pnl)}</span>,csv:t=>Number(t.pnl.toFixed(2)),def:true},
  {key:'pnlPct',label:'PnL%',align:'right',cell:t=><span className={`tnum ${clsPnl(t.pnlPct)}`}>{fmtPct(t.pnlPct)}</span>,csv:t=>Number(t.pnlPct.toFixed(2)),def:true},
  {key:'size',label:'Size',align:'right',cell:t=><span className="tnum text-slate-500">{fmtUSD(t.size)}</span>,csv:t=>Math.round(t.size),def:true},
  {key:'leverage',label:'Lev',align:'right',cell:t=><span className="tnum text-slate-500">{t.leverage}×</span>,csv:t=>t.leverage,def:false},
  {key:'strategy',label:'Strategy',cell:t=><span className="text-slate-500">{t.strategy}</span>,csv:t=>t.strategy,def:true},
  {key:'durMin',label:'Duration',align:'right',cell:t=><span className="text-slate-500">{fmtDur(t.durMin)}</span>,csv:t=>fmtDur(t.durMin),def:true},
];
const TRADE_GETTERS={entry:r=>r.entry,exit:r=>r.exit||0,bot:r=>r.bot,symbol:r=>r.symbol,exchange:r=>r.exchange,side:r=>r.side,status:r=>r.status,pnl:r=>r.pnl,pnlPct:r=>r.pnlPct,size:r=>r.size,leverage:r=>r.leverage,strategy:r=>r.strategy,durMin:r=>r.durMin};

function TradesPage(){
  const {user,data}=useApp();
  const [f,setF]=useState(()=>PREF.get('trades_filter',{bot:'all',exchange:'All',side:'All',status:'All',q:''}));
  const [sort,setSort]=useState(()=>PREF.get('trades_sort',{col:'entry',dir:'desc'}));
  const [colKeys,setColKeys]=useState(()=>PREF.get('trades_cols',TRADE_COLS.filter(c=>c.def).map(c=>c.key)));
  useEffect(()=>{ PREF.set('trades_filter',f); },[f]);
  useEffect(()=>{ PREF.set('trades_sort',sort); },[sort]);
  useEffect(()=>{ PREF.set('trades_cols',colKeys); },[colKeys]);

  const cols=colKeys.map(k=>TRADE_COLS.find(c=>c.key===k)).filter(Boolean);
  let rows=data.trades.filter(t=>
    (f.bot==='all'||t.botId===f.bot)&&
    (f.exchange==='All'||t.exchange===f.exchange)&&
    (f.side==='All'||t.side===f.side)&&
    (f.status==='All'||t.status===f.status)&&
    (!f.q|| (t.bot+t.symbol+t.strategy).toLowerCase().includes(f.q.toLowerCase()))
  );
  rows=sortRows(rows,sort,TRADE_GETTERS);
  const vt=useVirtual({count:rows.length,rowH:41,resetKey:JSON.stringify(f)+sort.col+sort.dir});

  if(!hasPerm(user,'view_trades')) return <Denied/>;
  const clear=()=>setF({bot:'all',exchange:'All',side:'All',status:'All',q:''});
  const active = f.bot!=='all'||f.exchange!=='All'||f.side!=='All'||f.status!=='All'||f.q;
  const exportHeaders=cols.map(c=>c.label);
  const getExportRows=()=>rows.map(t=>cols.map(c=>c.csv(t)));

  return <div>
    <PageHead title="Trades" subtitle={`${rows.length} of ${data.trades.length} trades`}
      actions={<div className="flex items-center gap-2">
        <PresetMenu storeKey="trades_presets" current={{f,sort,colKeys}} onApply={s=>{ if(s.f)setF(s.f); if(s.sort)setSort(s.sort); if(s.colKeys)setColKeys(s.colKeys); }}/>
        <ColumnPicker columns={TRADE_COLS} visible={colKeys} onChange={setColKeys}/>
        {hasPerm(user,'export_data')&&<ExportMenu filename="lno_trades" headers={exportHeaders} getRows={getExportRows}/>}
      </div>}/>
    <Card className="p-3 mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={f.bot} onChange={v=>setF({...f,bot:v})} className="w-44" options={[{value:'all',label:'All bots'},...BASE_BOTS.map(b=>({value:b.id,label:b.name}))]}/>
        <Select value={f.exchange} onChange={v=>setF({...f,exchange:v})} className="w-36" options={['All','Binance','Bybit','OKX']}/>
        <Select value={f.side} onChange={v=>setF({...f,side:v})} className="w-28" options={['All','Long','Short']}/>
        <Select value={f.status} onChange={v=>setF({...f,status:v})} className="w-32" options={['All','Open','Closed']}/>
        <div className="relative flex-1 min-w-[160px]"><Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={f.q} onChange={e=>setF({...f,q:e.target.value})} placeholder="Search bot, symbol, strategy…" className="w-full bg-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"/></div>
        {active&&<Btn variant="ghost" size="sm" onClick={clear}><Icon name="x" className="w-3.5 h-3.5"/>Clear filters</Btn>}
      </div>
    </Card>
    <Card className="overflow-hidden">
      <div ref={vt.ref} className="overflow-auto" style={{maxHeight:'68vh'}}>
        <table className="w-full text-sm">
          <thead className="text-xs sticky top-0 z-10"><tr className="bg-white border-b border-slate-200 shadow-sm">
            {cols.map(c=><SortHeader key={c.key} label={c.label} col={c.key} sort={sort} setSort={setSort} align={c.align||'left'}/>)}
          </tr></thead>
          <tbody>
            {vt.padTop>0&&<tr style={{height:vt.padTop}}><td colSpan={cols.length}/></tr>}
            {rows.slice(vt.start,vt.end).map(t=><tr key={t.id} style={{height:41}} className="border-b border-slate-50 hover:bg-slate-50/60">
              {cols.map(c=><td key={c.key} className={`px-3 py-2.5 whitespace-nowrap ${c.align==='right'?'text-right':''} ${c.cls||''}`}>{c.cell(t)}</td>)}
            </tr>)}
            {vt.padBottom>0&&<tr style={{height:vt.padBottom}}><td colSpan={cols.length}/></tr>}
          </tbody>
        </table>
      </div>
      {rows.length===0&&<div className="p-10 text-center text-slate-400 text-sm">No trades match the current filters.</div>}
    </Card>
  </div>;
}

/* ============================================================
   ACTIVITY LOG
   ============================================================ */
function LogsPage(){
  const {funds,user}=useApp();
  const [sev,setSev]=useState('All'); const [type,setType]=useState('All'); const [page,setPage]=useState(0); const [sel,setSel]=useState(null);
  if(!hasPerm(user,'view_logs')) return <Denied/>;
  const rows=LOGS.filter(l=>(sev==='All'||l.level===sev.toLowerCase())&&(type==='All'||l.type===type.toLowerCase()));
  const PER=50; const pages=Math.ceil(rows.length/PER); const slice=rows.slice(page*PER,page*PER+PER);
  const lvlColor={critical:'text-danger bg-danger/10',error:'text-danger bg-danger/10',warning:'text-amber-600 bg-warn/10',info:'text-blue-600 bg-blue-50',debug:'text-slate-500 bg-slate-100'};
  return <div>
    <PageHead title="Activity Log" subtitle={`${rows.length} events`}
      actions={hasPerm(user,'export_data')&&<ExportMenu filename="lno_logs" headers={['Timestamp','Level','Type','Source','Message']}
        getRows={()=>rows.map(l=>[fmtDT(l.t),l.level,l.type,l.source,l.message])}/>}/>
    <Card className="p-3 mb-4"><div className="flex flex-wrap items-center gap-2">
      <Select value={sev} onChange={v=>{setSev(v);setPage(0);}} className="w-40" options={['All','Critical','Error','Warning','Info','Debug']}/>
      <Select value={type} onChange={v=>{setType(v);setPage(0);}} className="w-40" options={['All','Signal','Trading','Position','System']}/>
    </div></Card>
    <div className="flex gap-5">
      <Card className="overflow-hidden flex-1">
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
            <th className="px-3 py-2.5 text-left font-medium">Timestamp</th><th className="px-3 py-2.5 text-left font-medium">Level</th>
            <th className="px-3 py-2.5 text-left font-medium hidden sm:table-cell">Type</th><th className="px-3 py-2.5 text-left font-medium hidden md:table-cell">Source</th>
            <th className="px-3 py-2.5 text-left font-medium">Message</th>
          </tr></thead>
          <tbody>
            {slice.map(l=><tr key={l.id} onClick={()=>setSel(l)} className={`border-b border-slate-50 cursor-pointer hover:bg-slate-50/60 ${sel?.id===l.id?'bg-gold/5':''}`}>
              <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap font-mono text-xs">{fmtDT(l.t)}</td>
              <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full text-[11px] font-medium uppercase ${lvlColor[l.level]}`}>{l.level}</span></td>
              <td className="px-3 py-2.5 hidden sm:table-cell capitalize text-slate-500">{l.type}</td>
              <td className="px-3 py-2.5 hidden md:table-cell text-slate-500">{l.source}</td>
              <td className="px-3 py-2.5 text-navy max-w-md truncate">{l.message}</td>
            </tr>)}
          </tbody>
        </table></div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm">
          <span className="text-slate-400">Page {page+1} of {pages}</span>
          <div className="flex gap-2">
            <Btn variant="outline" size="sm" disabled={page===0} onClick={()=>setPage(p=>p-1)}><Icon name="chevleft" className="w-4 h-4"/>Previous</Btn>
            <Btn variant="outline" size="sm" disabled={page>=pages-1} onClick={()=>setPage(p=>p+1)}>Next<Icon name="chevright" className="w-4 h-4"/></Btn>
          </div>
        </div>
      </Card>
      {sel&&<Card className="w-80 shrink-0 p-5 h-fit slidein hidden lg:block">
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-navy">Log detail</h3><button onClick={()=>setSel(null)} className="text-slate-400 hover:text-navy"><Icon name="x" className="w-4 h-4"/></button></div>
        <div className="space-y-3 text-sm">
          <div><div className="text-xs text-slate-400">Message</div><div className="text-navy">{sel.message}</div></div>
          <div className="grid grid-cols-2 gap-3">
            <div><div className="text-xs text-slate-400">Level</div><span className={`px-2 py-0.5 rounded-full text-[11px] font-medium uppercase ${lvlColor[sel.level]}`}>{sel.level}</span></div>
            <div><div className="text-xs text-slate-400">Type</div><div className="capitalize text-navy">{sel.type}</div></div>
            <div><div className="text-xs text-slate-400">Source</div><div className="text-navy">{sel.source}</div></div>
            <div><div className="text-xs text-slate-400">Timestamp</div><div className="text-navy font-mono text-xs">{fmtDT(sel.t)}</div></div>
          </div>
          <div><div className="text-xs text-slate-400 mb-1">Metadata</div><pre className="bg-slate-50 rounded-lg p-3 text-[11px] font-mono text-slate-600 overflow-x-auto">{JSON.stringify(sel.meta,null,2)}</pre></div>
          {sel.botId&&<div><div className="text-xs text-slate-400">Associated bot</div><div className="text-navy">{BASE_BOTS.find(b=>b.id===sel.botId)?.name}</div></div>}
        </div>
      </Card>}
    </div>
  </div>;
}

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
const PW_RULES=[
  ['At least 12 characters', pw=>pw.length>=12],
  ['An uppercase letter', pw=>/[A-Z]/.test(pw)],
  ['A lowercase letter', pw=>/[a-z]/.test(pw)],
  ['A number', pw=>/[0-9]/.test(pw)],
  ['A special character', pw=>/[^A-Za-z0-9]/.test(pw)],
];
const passwordOk=(pw)=>PW_RULES.every(([,fn])=>fn(pw||''));
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

/* ============================================================
   ADMIN — EXCHANGES
   ============================================================ */
function AdminExchanges(){
  const {user}=useApp();
  const [exchanges,setExchanges]=useState([]);
  const [modal,setModal]=useState(null); const [del,setDel]=useState(null);
  const reload=()=>api('exchanges').then(r=>setExchanges(r.exchanges||[])).catch(()=>{});
  useEffect(()=>{ if(user.role==='admin') reload(); },[]);
  if(user.role!=='admin') return <Denied/>;
  const mask=(s)=> s? s.slice(0,6)+'••••••••'+s.slice(-4) : '';
  return <div>
    <PageHead title="Exchanges" subtitle="Exchange API connections" actions={<Btn onClick={()=>setModal({mode:'add',data:{name:'',label:'',apiKey:'',secret:'',note:''}})}><Icon name="plus" className="w-4 h-4"/>Add Exchange</Btn>}/>
    <div className="grid md:grid-cols-2 gap-4">
      {exchanges.map(e=><Card key={e.id} className="p-5">
        <div className="flex items-start justify-between">
          <div><div className="font-semibold text-navy">{e.label}</div><div className="text-xs text-slate-400 font-mono">{e.name}</div></div>
          <StatusPill status={e.status}/>
        </div>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-400">API Key</span><span className="font-mono text-xs">{mask(e.apiKey)}</span></div>
          <div className="flex justify-between items-center"><span className="text-slate-400">API Secret</span>
            <span className="flex items-center gap-1.5 font-mono text-xs">{e.hasSecret? e.secretMasked : <span className="text-slate-300">none</span>}<Icon name="shield" className="w-3.5 h-3.5 text-success" data-tip="Encrypted at rest"/></span>
          </div>
          <div className="flex justify-between"><span className="text-slate-400">Last sync</span><span className="text-xs">{e.lastSync?fmtDT(e.lastSync):'—'}</span></div>
          {e.note&&<div className="text-xs text-slate-400 pt-1">{e.note}</div>}
        </div>
        <div className="flex gap-2 mt-4">
          <Btn variant="outline" size="sm" onClick={()=>setModal({mode:'edit',data:{...e,secret:''}})}><Icon name="pencil" className="w-3.5 h-3.5"/>Edit</Btn>
          <Btn variant="ghost" size="sm" className="text-danger" onClick={()=>setDel(e)}><Icon name="trash" className="w-3.5 h-3.5"/>Delete</Btn>
        </div>
      </Card>)}
    </div>
    <ExchangeModal modal={modal} onClose={()=>setModal(null)} onSave={async(d)=>{
      try{
        const body={name:d.name,label:d.label,apiKey:d.apiKey,note:d.note}; if(d.secret) body.apiSecret=d.secret;
        if(modal.mode==='add') await api('exchanges',{method:'POST',body});
        else await api('exchanges',{method:'PATCH',body:{id:d.id,...body}});
        await reload(); setModal(null);
      }catch(e){ toast.error(e.message); }
    }}/>
    <Confirm open={!!del} title="Delete exchange" message={`Remove ${del?.label}? Bots using this connection will lose API access.`} onCancel={()=>setDel(null)} onConfirm={async()=>{try{await api('exchanges',{method:'DELETE',body:{id:del.id}});await reload();toast.success('Exchange removed');}catch(e){toast.error(e.message);}setDel(null);}}/>
  </div>;
}
function ExchangeModal({modal,onClose,onSave}){
  const [v,setV]=useState({}); useEffect(()=>{ if(modal)setV(modal.data); },[modal]);
  if(!modal)return null;
  return <Modal open={true} onClose={onClose} title={modal.mode==='add'?'Add Exchange':'Edit Exchange'}>
    <div className="space-y-3">
      <Field label="Exchange name"><Input value={v.name||''} onChange={e=>setV({...v,name:e.target.value})} placeholder="binance"/></Field>
      <Field label="Label"><Input value={v.label||''} onChange={e=>setV({...v,label:e.target.value})} placeholder="Binance Main"/></Field>
      <Field label="API Key"><Input value={v.apiKey||''} onChange={e=>setV({...v,apiKey:e.target.value})}/></Field>
      <Field label="API Secret" hint={modal.mode==='edit'?'Leave blank to keep the existing secret':undefined}><Input type="password" value={v.secret||''} onChange={e=>setV({...v,secret:e.target.value})}/></Field>
      <Field label="Note (optional)"><Input value={v.note||''} onChange={e=>setV({...v,note:e.target.value})}/></Field>
      <div className="flex justify-end gap-2 pt-1"><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn onClick={()=>onSave(v)}>Save</Btn></div>
    </div>
  </Modal>;
}

/* ============================================================
   ADMIN — WHATSAPP
   ============================================================ */
function AdminOpenWA(){
  const {user,funds}=useApp();
  const [cfg,setCfg]=useState(null);
  const [apiKey,setApiKey]=useState(''); const [defaultSender,setDefaultSender]=useState(''); const [enabled,setEnabled]=useState(false);
  const [ddPct,setDdPct]=useState(10); const [pnlThr,setPnlThr]=useState(-5000); const [dailyReport,setDailyReport]=useState(true);
  const [rules,setRules]=useState([]);
  const [saved,setSaved]=useState(false); const [busy,setBusy]=useState(false); const [test,setTest]=useState(null); const [report,setReport]=useState(null);
  const [log,setLog]=useState(null);
  const loadLog=()=>api('openwa?log=1').then(r=>setLog(r.log||[])).catch(()=>setLog([]));
  useEffect(()=>{ if(user.role!=='admin')return; api('openwa').then(r=>{ const c=r.config; setCfg(c); setDefaultSender(c.defaultSender); setEnabled(c.enabled); setDdPct(c.drawdownPct??10); setPnlThr(c.pnlDayThreshold??-5000); setDailyReport(c.dailyReport??true); setRules(c.alertRules||[]); }).catch(()=>{}); loadLog(); },[]);
  if(user.role!=='admin') return <Denied/>;
  const scopeOpts=[{value:'portfolio',label:'Portfolio'},...funds.map(f=>({value:'fund:'+f.id,label:'Fund · '+f.name})),...BASE_BOTS.map(b=>({value:'bot:'+b.id,label:'Bot · '+b.name}))];
  const metricOpts=[{value:'drawdown',label:'Max drawdown (%)'},{value:'pnlDay',label:'Daily PnL ($)'}];
  const updateRule=(i,patch)=>setRules(rs=>rs.map((r,j)=>j===i?{...r,...patch}:r));
  const addRule=()=>setRules(rs=>[...rs,{id:'r'+Date.now(),scope:'portfolio',metric:'drawdown',value:10,enabled:true}]);
  async function save(){ setBusy(true); try{ const body={defaultSender,enabled,drawdownPct:Number(ddPct),pnlDayThreshold:Number(pnlThr),dailyReport,alertRules:rules.map(r=>({...r,value:Number(r.value)}))}; if(apiKey) body.apiKey=apiKey; const r=await api('openwa',{method:'PUT',body}); setCfg(r.config); setApiKey(''); setSaved(true); setTimeout(()=>setSaved(false),1800); }catch(e){ toast.error(e.message); } finally{ setBusy(false); } }
  async function sendTest(){ setTest({state:'sending'}); try{ const r=await api('openwa',{method:'POST',body:{action:'test'}}); setTest({state:r.ok?'ok':'err', msg:r.ok?'Message sent ✓':('Failed (HTTP '+(r.status||'?')+')')}); }catch(e){ setTest({state:'err',msg:e.message}); } loadLog(); }
  async function runReport(){ setReport({state:'sending'}); try{ const r=await api('cron/daily',{method:'POST'}); const n=(r.sent||[]).reduce((a,s)=>a+(s.sent||0),0); setReport({state:'ok',msg:`Ran ✓ — ${n} message(s) delivered`}); }catch(e){ setReport({state:'err',msg:e.message}); } loadLog(); }
  return <div className="max-w-2xl">
    <PageHead title="WhatsApp Alerts" subtitle="Send alerts to WhatsApp via CallMeBot — no server to host"/>
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div><div className="font-medium text-navy">Enable notifications</div><div className="text-xs text-slate-400">Master toggle for all WhatsApp alerts</div></div>
        <Toggle on={enabled} onChange={setEnabled}/>
      </div>
      <div className="border-t border-slate-100 pt-4 space-y-3">
        <div className="text-xs bg-navy/5 border border-slate-200 rounded-lg p-3 text-slate-600 space-y-1">
          <div className="font-medium text-navy">Activate alerts for the recipient below (once):</div>
          <div><span className="font-semibold">1.</span> Add <span className="font-mono">+34 611 021 695</span> to the phone's contacts (name it however you like).</div>
          <div><span className="font-semibold">2.</span> On WhatsApp, send <span className="font-mono bg-white px-1 rounded border border-slate-200">I allow callmebot to send me messages</span> to that contact.</div>
          <div><span className="font-semibold">3.</span> Enter the number + the API key it replies with below, then Save. <a href="https://www.callmebot.com/blog/free-api-whatsapp-messages/" target="_blank" rel="noopener" className="text-gold hover:underline">More →</a></div>
        </div>
        <Field label="Your WhatsApp number" hint="The number that receives alerts (international format)"><Input value={defaultSender} onChange={e=>setDefaultSender(e.target.value)} placeholder="+33 6 12 34 56 78"/></Field>
        <Field label="CallMeBot API key" hint={cfg&&cfg.hasApiKey? `Encrypted in DB (${cfg.apiKeyMasked}). Leave blank to keep.` : 'Stored encrypted in the database — never shown again'}><Input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={cfg&&cfg.hasApiKey?'•••••• (unchanged)':'e.g. 1234567'}/></Field>
      </div>
      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <Btn onClick={save} disabled={busy}>{busy?'Saving…':'Save settings'}</Btn>
        <Btn variant="outline" onClick={sendTest} disabled={!cfg||(!cfg.hasApiKey&&!apiKey)}><Icon name="msg" className="w-4 h-4"/>Send test message</Btn>
        {saved&&<span className="text-sm text-success flex items-center gap-1 fadein"><Icon name="check" className="w-4 h-4"/>Saved</span>}
        {test&&<span className={`text-sm flex items-center gap-1 ${test.state==='ok'?'text-success':test.state==='err'?'text-danger':'text-slate-400'}`}>{test.state==='sending'?'Sending…':test.msg}</span>}
      </div>
    </Card>

    <Card className="p-5 mt-4 space-y-4">
      <SectionTitle right={<span className="text-[11px] text-slate-400">checked daily · 08:00 UTC</span>}>Alert rules</SectionTitle>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Max drawdown alert (%)" hint="Alert when portfolio drawdown exceeds this"><Input type="number" value={ddPct} onChange={e=>setDdPct(e.target.value)} placeholder="10"/></Field>
        <Field label="Daily PnL alert ($)" hint="Alert when the day's PnL falls below this (e.g. -5000)"><Input type="number" value={pnlThr} onChange={e=>setPnlThr(e.target.value)} placeholder="-5000"/></Field>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 pt-4">
        <div><div className="text-sm font-medium text-navy">Daily portfolio report</div><div className="text-xs text-slate-400">Automatic WhatsApp summary every day at 08:00 UTC</div></div>
        <Toggle on={dailyReport} onChange={setDailyReport}/>
      </div>
      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <Btn onClick={save} disabled={busy}>{busy?'Saving…':'Save rules'}</Btn>
        <Btn variant="outline" onClick={runReport} disabled={!cfg||!cfg.enabled}><Icon name="trendup" className="w-4 h-4"/>Run report now</Btn>
        {report&&<span className={`text-sm flex items-center gap-1 ${report.state==='ok'?'text-success':report.state==='err'?'text-danger':'text-slate-400'}`}>{report.state==='sending'?'Running…':report.msg}</span>}
      </div>
    </Card>

    <Card className="p-5 mt-4 space-y-3">
      <SectionTitle right={<Btn variant="outline" size="sm" onClick={addRule}><Icon name="plus" className="w-3.5 h-3.5"/>Add rule</Btn>}>Scoped rules (per fund / bot)</SectionTitle>
      {rules.length===0&&<div className="text-sm text-slate-400 py-2">No scoped rules. The global thresholds above still apply to the whole portfolio.</div>}
      {rules.map((r,i)=><div key={r.id} className="flex flex-wrap items-center gap-2">
        <Select className="w-48" value={r.scope} onChange={v=>updateRule(i,{scope:v})} options={scopeOpts}/>
        <Select className="w-40" value={r.metric} onChange={v=>updateRule(i,{metric:v})} options={metricOpts}/>
        <Input type="number" className="w-24" value={r.value} onChange={e=>updateRule(i,{value:e.target.value})}/>
        <div data-tip="Enabled"><Toggle on={r.enabled} onChange={v=>updateRule(i,{enabled:v})} size="sm"/></div>
        <button onClick={()=>setRules(rs=>rs.filter((_,j)=>j!==i))} className="text-slate-400 hover:text-danger p-1"><Icon name="trash" className="w-4 h-4"/></button>
      </div>)}
      <div className="flex items-center gap-3 pt-1"><Btn onClick={save} disabled={busy}>{busy?'Saving…':'Save rules'}</Btn><span className="text-[11px] text-slate-400">Drawdown alerts when the scope's drawdown exceeds the % · PnL alerts when the day's PnL falls below the $ value · evaluated daily.</span></div>
    </Card>

    <Card className="p-5 mt-4">
      <SectionTitle>How it works</SectionTitle>
      <p className="text-sm text-slate-600 mb-4"><span className="font-mono text-xs bg-slate-100 px-1 rounded">CallMeBot</span> is a free hosted WhatsApp relay — <span className="font-medium">no server to run</span>. Each recipient opts in once and gets a personal API key; the Control Center backend sends a simple HTTPS request. Keys are <span className="font-medium">encrypted at rest</span> and never exposed to the browser. Alerts route to the recipient above plus every user who added their own number + key in their profile. <span className="text-slate-400">(Send-only: acknowledge alerts from the bell; the monthly PDF stays downloadable under Reports.)</span></p>
      <SectionTitle>Active alerts</SectionTitle>
      <ul className="text-sm text-slate-600 space-y-2">
        <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-success mt-0.5"/>Login-failure alerts to admins (after 3 failed attempts)</li>
        <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-success mt-0.5"/>Drawdown &amp; daily-PnL breaches — portfolio, per fund, or per bot</li>
        <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-success mt-0.5"/>Daily report, plus weekly (Mondays) &amp; monthly (1st) summaries</li>
      </ul>
    </Card>

    <Card className="p-5 mt-4">
      <SectionTitle right={<button onClick={loadLog} className="text-xs text-slate-400 hover:text-navy flex items-center gap-1"><Icon name="refresh" className="w-3.5 h-3.5"/>Refresh</button>}>Sent messages</SectionTitle>
      {log===null? <div className="text-sm text-slate-400">Loading…</div>
        : log.length===0? <div className="text-sm text-slate-400">No WhatsApp messages sent yet.</div>
        : <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {log.map(l=><div key={l.id} className="flex items-start gap-2.5 border-b border-slate-50 pb-2 last:border-0">
              <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${l.ok?'bg-success':'bg-danger'}`} title={l.ok?'Sent':'Failed'}/>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-navy whitespace-pre-wrap break-words line-clamp-2">{l.message}</div>
                <div className="text-[11px] text-slate-400 mt-0.5"><span className="font-mono">{l.phone}</span> · {fmtDT(l.createdAt)}{l.ok?'':' · failed'}</div>
                {!l.ok&&l.response&&<div className="text-[11px] text-danger mt-0.5 truncate" title={l.response}>{l.response}</div>}
              </div>
            </div>)}
          </div>}
    </Card>
  </div>;
}

/* ============================================================
   ADMIN — FUNDS
   ============================================================ */
function AdminFunds(){
  const {funds,saveFunds,user}=useApp();
  const [newName,setNewName]=useState(''); const [edit,setEdit]=useState(null); const [editVal,setEditVal]=useState(''); const [editColor,setEditColor]=useState('#C9A24D'); const [del,setDel]=useState(null); const [reassignTo,setReassignTo]=useState('');
  if(user.role!=='admin') return <Denied/>;
  const usedColors=funds.map(f=>f.color); const freeColor=FUND_PALETTE.find(c=>!usedColors.includes(c))||FUND_PALETTE[funds.length%8];
  const persist=(next)=>{ saveFunds(next).catch(e=>toast.error(e.message)); };
  function create(){ if(!newName.trim())return; persist([...funds,{id:'f'+Date.now(),name:newName.trim(),color:freeColor,bots:[]}]); setNewName(''); }
  function reassign(botId,toId){ persist(funds.map(f=>({...f,bots: f.id===toId? [...f.bots.filter(b=>b!==botId),botId] : f.bots.filter(b=>b!==botId)}))); }
  function saveEdit(id){ persist(funds.map(x=>x.id===id?{...x,name:editVal,color:editColor}:x)); setEdit(null); }
  function doDelete(){ const victim=del; persist(funds.filter(f=>f.id!==victim.id).map(f=>f.id===reassignTo?{...f,bots:[...f.bots,...victim.bots]}:f)); setDel(null); setReassignTo(''); }
  return <div>
    <PageHead title="Funds" subtitle="Create funds and manage bot-to-fund assignments"/>
    <Card className="p-4 mb-5">
      <div className="flex items-end gap-2">
        <div className="flex-1 max-w-xs"><Field label="Create a new fund"><Input value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&create()} placeholder="Delta Fund"/></Field></div>
        <Btn onClick={create}><Icon name="plus" className="w-4 h-4"/>Create</Btn>
        <div className="flex items-center gap-1.5 text-xs text-slate-400 pb-2">next color <span className="w-4 h-4 rounded-full" style={{background:freeColor}}/></div>
      </div>
    </Card>

    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
      {funds.map(f=><Card key={f.id} className="p-5">
        <div className="flex items-center justify-between mb-3">
          {edit===f.id? <div className="flex items-center gap-2 flex-1">
            <input type="color" value={editColor} onChange={e=>setEditColor(e.target.value)} className="w-7 h-7 rounded cursor-pointer border border-slate-200"/>
            <Input value={editVal} autoFocus onChange={e=>setEditVal(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')saveEdit(f.id);}}/>
            <Btn size="icon" variant="subtle" onClick={()=>saveEdit(f.id)}><Icon name="check" className="w-4 h-4"/></Btn>
          </div> : <div className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded-full" style={{background:f.color}}/><span className="font-semibold text-navy">{f.name}</span><span className="text-xs text-slate-400">{f.bots.length} bots</span></div>}
          {edit!==f.id&&<div className="flex gap-1">
            <button onClick={()=>{setEdit(f.id);setEditVal(f.name);setEditColor(f.color);}} className="text-slate-400 hover:text-navy p-1" data-tip="Edit name"><Icon name="pencil" className="w-4 h-4"/></button>
            <button onClick={()=>{setDel(f);setReassignTo(funds.find(x=>x.id!==f.id)?.id||'');}} disabled={funds.length<=1} className="text-slate-400 hover:text-danger p-1 disabled:opacity-30"><Icon name="trash" className="w-4 h-4"/></button>
          </div>}
        </div>
        <div className="space-y-1.5">
          {f.bots.length===0&&<div className="text-xs text-slate-400 py-2">No bots assigned</div>}
          {f.bots.map(bid=>{ const b=BASE_BOTS.find(x=>x.id===bid); return <div key={bid} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-navy truncate">{b.name}</span>
            <select value={f.id} onChange={e=>reassign(bid,e.target.value)} className="text-xs border border-slate-200 rounded-md px-1.5 py-1 bg-white cursor-pointer shrink-0">
              {funds.map(ff=><option key={ff.id} value={ff.id}>{ff.name}</option>)}
            </select>
          </div>; })}
        </div>
      </Card>)}
    </div>

    <Card className="overflow-hidden">
      <div className="p-5 pb-0"><SectionTitle>All Bots</SectionTitle></div>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
          <th className="px-4 py-2.5 text-left font-medium">Bot</th><th className="px-4 py-2.5 text-left font-medium hidden sm:table-cell">Exchange</th>
          <th className="px-4 py-2.5 text-left font-medium hidden sm:table-cell">Symbol</th><th className="px-4 py-2.5 text-left font-medium">Fund</th>
        </tr></thead>
        <tbody>
          {BASE_BOTS.map(b=>{ const f=fundOfBot(funds,b.id); return <tr key={b.id} className="border-b border-slate-50">
            <td className="px-4 py-2.5 font-medium text-navy">{b.name}</td>
            <td className="px-4 py-2.5 text-slate-500 hidden sm:table-cell">{b.exchange}</td>
            <td className="px-4 py-2.5 font-mono text-xs hidden sm:table-cell">{b.symbol}</td>
            <td className="px-4 py-2.5"><select value={f?.id||''} onChange={e=>reassign(b.id,e.target.value)} className="text-sm border border-slate-200 rounded-md px-2 py-1 bg-white cursor-pointer">
              {funds.map(ff=><option key={ff.id} value={ff.id}>{ff.name}</option>)}
            </select></td>
          </tr>; })}
        </tbody>
      </table></div>
    </Card>

    <Modal open={!!del} onClose={()=>setDel(null)} title="Delete fund">
      <p className="text-sm text-slate-600 mb-3">Every bot must belong to a fund. Choose which fund will receive the <span className="font-semibold">{del?.bots.length}</span> bot(s) from <span className="font-semibold">{del?.name}</span>.</p>
      <Field label="Reassign bots to"><Select value={reassignTo} onChange={setReassignTo} options={funds.filter(f=>f.id!==del?.id).map(f=>({value:f.id,label:f.name}))}/></Field>
      <div className="flex justify-end gap-2 mt-5"><Btn variant="outline" onClick={()=>setDel(null)}>Cancel</Btn><Btn variant="danger" onClick={doDelete}>Delete fund</Btn></div>
    </Modal>
  </div>;
}

/* ============================================================
   PROFILE
   ============================================================ */
function ProfilePage(){
  const {user,setUser}=useApp();
  const [v,setV]=useState({firstName:user.firstName,lastName:user.lastName}); const [saved,setSaved]=useState(false);
  const [pw,setPw]=useState({cur:'',n1:'',n2:''}); const [pwMsg,setPwMsg]=useState(null);
  const [notify,setNotify]=useState(user.notify); const [phone,setPhone]=useState(user.phone||''); const [waKey,setWaKey]=useState('');
  const fileRef=useRef();
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
        <Field label="Email" hint="Contact an admin to change your email"><Input value={user.email} disabled className="bg-slate-50 text-slate-400"/></Field>
        <Field label="First name"><Input value={v.firstName} onChange={e=>setV({...v,firstName:e.target.value})}/></Field>
        <Field label="Last name"><Input value={v.lastName} onChange={e=>setV({...v,lastName:e.target.value})}/></Field>
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
        <div><div className="text-sm font-medium text-navy">Receive notifications</div><div className="text-xs text-slate-400">WhatsApp alerts must also be enabled by an admin to deliver</div></div>
        <Toggle on={notify} onChange={x=>{setNotify(x);patchSelf({notify:x});}}/>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Your phone number"><Input value={phone} onChange={e=>setPhone(e.target.value)} onBlur={()=>patchSelf({phone})} placeholder="+33 6 12 34 56 78"/></Field>
        <Field label="Your CallMeBot API key" hint={user.hasWaApikey?'Saved (encrypted). Leave blank to keep.':'Get it once via WhatsApp — see below'}><Input type="password" value={waKey} onChange={e=>setWaKey(e.target.value)} onBlur={async()=>{ if(waKey){ const okp=await patchSelf({waApikey:waKey}); if(okp){ setNotify(true); setWaKey(''); toast.success('WhatsApp alerts enabled — check your phone'); } } }} placeholder={user.hasWaApikey?'•••••• (unchanged)':'e.g. 1234567'}/></Field>
      </div>
      <div className="text-[11px] text-slate-500 mt-2 space-y-1 bg-navy/5 border border-slate-200 rounded-lg p-3">
        <div className="font-medium text-slate-600">Activate your WhatsApp alerts (once):</div>
        <div><span className="font-semibold">1.</span> Add <span className="font-mono">+34 611 021 695</span> to your phone contacts (name it however you like).</div>
        <div><span className="font-semibold">2.</span> On WhatsApp, send <span className="font-mono bg-white px-1 rounded border border-slate-200">I allow callmebot to send me messages</span> to that contact.</div>
        <div><span className="font-semibold">3.</span> Paste the API key it replies with into the field above — you'll then get a welcome message confirming it works.</div>
      </div>
    </Card>
  </div>;
}

/* ============================================================
   SUPPORT
   ============================================================ */
function SupportPage(){
  return <div className="max-w-2xl">
    <PageHead title="Support" subtitle="Contact LNO support for technical issues or production incidents"/>
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-5"><span className="w-12 h-12 rounded-xl bg-gold/15 text-gold grid place-items-center"><Icon name="lifebuoy" className="w-6 h-6"/></span>
        <div><div className="font-semibold text-navy">LNO Support</div><div className="text-sm text-slate-400">Technical issues · account questions · incidents</div></div></div>
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-3"><Icon name="mail" className="w-4 h-4 text-slate-400"/><a href="mailto:support@lno.company" className="text-navy hover:text-gold font-medium">support@lno.company</a></div>
        <div className="flex items-center gap-3"><Icon name="clock" className="w-4 h-4 text-slate-400"/><span className="text-slate-600">Response time: within 4 business hours</span></div>
        <div className="flex items-start gap-3"><Icon name="triangle" className="w-4 h-4 text-amber-500 mt-0.5"/><span className="text-slate-600">For urgent incidents, include <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">[URGENT]</span> in the email subject line for priority handling.</span></div>
      </div>
    </Card>
  </div>;
}

/* ============================================================
   SYSTEM STATUS
   ============================================================ */
const fmtAgo=(t)=>{ if(t==null)return '—'; const min=Math.round((NOW-new Date(t).getTime())/60000); if(min<1)return 'just now'; if(min<60)return min+'m ago'; const h=Math.floor(min/60); if(h<24)return h+'h ago'; return Math.floor(h/24)+'d ago'; };
function StatusPage(){
  const {user,data,dataStatus}=useApp();
  const services=useServiceHealth();
  const [snaps,setSnaps]=useState(null); const [alerts,setAlerts]=useState(null); const [openwa,setOpenwa]=useState(undefined); const [dbErr,setDbErr]=useState(null);
  useEffect(()=>{
    api('snapshots?limit=3').then(r=>setSnaps(r.snapshots||[])).catch(e=>{ setSnaps([]); setDbErr(e.message); });
    api('alerts').then(r=>setAlerts(r.alerts||[])).catch(()=>setAlerts([]));
    if(user.role==='admin') api('openwa').then(r=>setOpenwa(r.config)).catch(()=>setOpenwa(null));
  },[]);
  if(!hasPerm(user,'view_activity')) return <Denied/>;

  const exDown=services.filter(s=>s.ex&&s.status==='down');
  const exDegraded=services.filter(s=>s.status==='degraded');
  const lastSnap=snaps&&snaps.length? snaps[snaps.length-1] : null;
  const dbOk=dbErr==null;
  const unacked=(alerts||[]).filter(a=>!a.ackedAt);
  const acked=(alerts||[]).filter(a=>a.ackedAt);
  const mttaMin=acked.length? acked.reduce((s,a)=>s+(new Date(a.ackedAt)-new Date(a.createdAt)),0)/acked.length/60000 : null;
  const ackRate=(alerts&&alerts.length)? acked.length/alerts.length*100 : null;

  const checks=[
    {label:'Market data feed', state:dataStatus==='live'?'ok':dataStatus==='partial'?'warn':dataStatus==='sim'?'down':'neutral', sub:dataStatus==='live'?'All exchanges streaming':dataStatus==='partial'?'Some feeds degraded':dataStatus==='sim'?'Simulation fallback':'Connecting…'},
    {label:'Database', state:dbOk?'ok':'down', sub:dbOk?(lastSnap?`Last snapshot ${lastSnap.day}`:'Connected'):'Unreachable'},
    {label:'Exchange APIs', state:exDown.length?'down':exDegraded.length?'warn':'ok', sub:exDown.length?`${exDown.map(s=>s.ex).join(', ')} down`:exDegraded.length?`${exDegraded.length} degraded`:'Binance · Bybit · OKX OK'},
    {label:'Alerting', state:alerts==null?'neutral':'ok', sub:alerts==null?'Checking…':`${unacked.length} pending acknowledgement`},
    ...(user.role==='admin'?[{label:'WhatsApp (CallMeBot)', state:openwa==null?'neutral':openwa.enabled?(openwa.hasApiKey?'ok':'warn'):'neutral', sub:openwa===undefined?'Checking…':openwa===null?'—':openwa.enabled?(openwa.hasApiKey?'Enabled & configured':'Enabled · no API key'):'Disabled (optional)'}]:[]),
  ];
  const anyDown=checks.some(c=>c.state==='down'); const anyWarn=checks.some(c=>c.state==='warn');
  const overall=anyDown?['Degraded','bg-danger','text-danger']:anyWarn?['Partial outage','bg-amber-500','text-amber-600']:['All systems operational','bg-success','text-success'];
  const dotCls=(s)=>s==='ok'?'bg-success':s==='warn'?'bg-amber-500':s==='down'?'bg-danger':'bg-slate-300';

  return <div>
    <PageHead title="System Status" subtitle="Live health of feeds, database, alerting and integrations"/>
    <Card className="p-5 mb-5 flex items-center gap-3">
      <span className={`w-3 h-3 rounded-full ${overall[1]} ${anyDown?'':'pulse-dot'}`}/>
      <span className={`text-lg font-semibold ${overall[2]}`}>{overall[0]}</span>
      <span className="ml-auto"><LiveBadge status={dataStatus}/></span>
    </Card>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
      {checks.map(c=><Card key={c.label} className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-navy">{c.label}</span>
          <span className={`w-2.5 h-2.5 rounded-full ${dotCls(c.state)}`}/>
        </div>
        <div className="text-xs text-slate-500 mt-1.5">{c.sub}</div>
      </Card>)}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <Card className="p-5">
        <SectionTitle right={<span className="text-[11px] text-slate-400">live ping · 10s</span>}>Service Health</SectionTitle>
        <div className="space-y-2">
          {services.map(s=><div key={s.name} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${s.status==='active'?'bg-success':s.status==='degraded'?'bg-amber-500':s.status==='pending'?'bg-slate-300 animate-pulse':'bg-danger'}`}/>{s.name}</span>
            <span className={`font-mono text-xs ${s.latency==null?'text-slate-300':s.latency>250?'text-amber-600':'text-slate-400'}`}>{s.latency==null?(s.status==='down'?'down':'—'):s.latency+'ms'}</span>
          </div>)}
        </div>
      </Card>
      <Card className="p-5">
        <SectionTitle right={<span className="text-[11px] text-slate-400">acknowledgement</span>}>Alert Analytics</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Mean time to ack</div><div className="text-lg font-bold text-navy mt-0.5">{mttaMin==null?'—':fmtDur(mttaMin)}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Ack rate</div><div className="text-lg font-bold text-navy mt-0.5">{ackRate==null?'—':fmtPctPlain(ackRate)}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Total alerts</div><div className="text-lg font-bold text-navy mt-0.5">{alerts==null?'—':alerts.length}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] text-slate-500">Pending ack</div><div className={`text-lg font-bold mt-0.5 ${unacked.length?'text-danger':'text-navy'}`}>{alerts==null?'—':unacked.length}</div></div>
        </div>
        <div className="text-[11px] text-slate-400 mt-3">{lastSnap?`Last recorded snapshot ${lastSnap.day} · ${fmtAgo(lastSnap.day)}`:'No recorded snapshots yet — the daily cron writes one per day.'}</div>
      </Card>
    </div>
  </div>;
}

/* ============================================================
   UNIFIED TIMELINE
   ============================================================ */
function TimelinePage(){
  const {user,data}=useApp();
  const [kind,setKind]=useState('all'); const [limit,setLimit]=useState(50);
  const [alerts,setAlerts]=useState([]);
  useEffect(()=>{ api('alerts').then(r=>setAlerts(r.alerts||[])).catch(()=>{}); },[]);
  const events=useMemo(()=>{
    const ev=[];
    data.trades.forEach(t=>{
      if(t.status==='Closed'&&t.exit) ev.push({t:t.exit,kind:'trade',icon:'briefcase',color:t.pnl>=0?'text-success':'text-danger',dot:t.pnl>=0?'bg-success':'bg-danger',title:`Closed ${t.side} ${t.symbol}`,sub:`${t.bot} · ${fmtSigned(t.pnl)} (${fmtPct(t.pnlPct)})`});
      else if(t.status==='Open') ev.push({t:t.entry,kind:'trade',icon:'briefcase',color:'text-blue-500',dot:'bg-blue-500',title:`Opened ${t.side} ${t.symbol}`,sub:`${t.bot} · size ${fmtUSD(t.size)}`});
    });
    LOGS.filter(l=>l.level==='critical'||l.level==='error'||l.level==='warning').forEach(l=>ev.push({t:l.t,kind:'log',icon:l.level==='warning'?'triangle':'info',color:l.level==='warning'?'text-amber-500':'text-danger',dot:l.level==='warning'?'bg-amber-500':'bg-danger',title:l.message,sub:`${l.source} · ${l.level}`}));
    INCIDENTS.forEach(i=>ev.push({t:i.t,kind:'incident',icon:'zap',color:i.severity==='critical'?'text-danger':i.severity==='warning'?'text-amber-500':'text-blue-500',dot:i.severity==='critical'?'bg-danger':i.severity==='warning'?'bg-amber-500':'bg-blue-500',title:i.message,sub:'System incident'}));
    alerts.forEach(a=>ev.push({t:new Date(a.createdAt).getTime(),kind:'alert',icon:'bell',color:'text-danger',dot:'bg-danger',title:a.summary,sub:`Alert ${a.code}${a.ackedAt?' · acknowledged':' · pending'}`}));
    return ev.sort((x,y)=>y.t-x.t);
  },[data,alerts]);
  if(!hasPerm(user,'view_trades')) return <Denied/>;

  const filtered=kind==='all'?events:events.filter(e=>e.kind===kind);
  const shown=filtered.slice(0,limit);
  const kinds=[['all','All'],['trade','Trades'],['log','Logs'],['incident','Incidents'],['alert','Alerts']];
  return <div>
    <PageHead title="Timeline" subtitle="Unified chronological feed across trades, logs, incidents and alerts"/>
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      {kinds.map(([k,l])=><button key={k} onClick={()=>{setKind(k);setLimit(50);}} className={`px-3 py-1.5 rounded-lg text-sm border transition ${kind===k?'border-gold text-gold bg-gold/5':'border-slate-200 text-slate-500 hover:text-navy'}`}>{l}</button>)}
      <span className="text-xs text-slate-400 ml-auto">{filtered.length} events</span>
    </div>
    <Card className="p-5">
      <div className="relative">
        <div className="absolute left-1.5 top-2 bottom-2 w-px bg-slate-200"/>
        <div className="space-y-4">
          {shown.map((e,i)=><div key={i} className="relative pl-7">
            <span className={`absolute left-0 top-1 w-3 h-3 rounded-full ring-2 ring-white ${e.dot}`}/>
            <div className="flex items-start gap-2">
              <Icon name={e.icon} className={`w-4 h-4 mt-0.5 shrink-0 ${e.color}`}/>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-navy leading-snug">{e.title}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{e.sub} · {fmtDT(e.t)}</div>
              </div>
            </div>
          </div>)}
          {shown.length===0&&<div className="text-sm text-slate-400 py-6 text-center">No events for this filter.</div>}
        </div>
      </div>
      {filtered.length>shown.length&&<div className="text-center mt-4"><Btn variant="outline" size="sm" onClick={()=>setLimit(l=>l+50)}>Show more ({filtered.length-shown.length})</Btn></div>}
    </Card>
  </div>;
}

/* ============================================================
   ADMIN — REPORT ARCHIVE
   ============================================================ */
function AdminReports(){
  const {user}=useApp();
  const isAdmin=user.role==='admin';
  const [reports,setReports]=useState(null); const [busy,setBusy]=useState(false); const [dl,setDl]=useState(null);
  const load=()=>api('snapshots?reports=list').then(r=>setReports(r.reports||[])).catch(()=>setReports([]));
  useEffect(()=>{ if(hasPerm(user,'view_reports')) load(); },[]);
  if(!hasPerm(user,'view_reports')) return <Denied/>;
  async function generate(){ setBusy(true); try{ await api('snapshots',{method:'POST',body:{action:'generateReport'}}); toast.success('Report generated & archived'); load(); }catch(e){ toast.error(e.message); } finally{ setBusy(false); } }
  async function download(rep){ setDl(rep.id); try{ const r=await api('snapshots?report='+rep.id); downloadBlob(b64ToBlob(r.pdfBase64), r.filename||('lno-report-'+rep.periodLabel+'.pdf')); toast.success('Report downloaded'); }catch(e){ toast.error(e.message); } finally{ setDl(null); } }
  return <div>
    <PageHead title="Reports" subtitle={isAdmin?'Archive of generated portfolio reports — re-download any as PDF':'Download past portfolio reports'}
      actions={isAdmin&&<Btn onClick={generate} disabled={busy}><Icon name="filetext" className="w-4 h-4"/>{busy?'Generating…':'Generate report now'}</Btn>}/>
    {reports==null? <Card className="p-10 text-center text-slate-400 text-sm">Loading…</Card>
    : reports.length===0? <Card className="p-10 text-center text-slate-400 text-sm"><Icon name="filetext" className="w-10 h-10 mx-auto text-slate-200 mb-2"/>{isAdmin?'No reports yet. Generate one now, or wait for the monthly cron (1st of each month).':'No reports available yet.'}</Card>
    : <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
          <th className="px-4 py-2.5 text-left font-medium">Kind</th>
          <th className="px-4 py-2.5 text-left font-medium">Period</th>
          <th className="px-4 py-2.5 text-right font-medium">Equity</th>
          <th className="px-4 py-2.5 text-right font-medium">PnL 30d</th>
          <th className="px-4 py-2.5 text-left font-medium hidden sm:table-cell">Generated</th>
          <th className="px-4 py-2.5"></th>
        </tr></thead>
        <tbody>
          {reports.map(r=><tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
            <td className="px-4 py-2.5 capitalize"><span className="inline-flex items-center gap-1.5"><Icon name="filetext" className="w-4 h-4 text-gold"/>{r.kind}</span></td>
            <td className="px-4 py-2.5 font-mono text-xs">{r.periodLabel}</td>
            <td className="px-4 py-2.5 text-right tnum">{fmtUSD(r.equity)}</td>
            <td className={`px-4 py-2.5 text-right tnum ${clsPnl(r.pnl)}`}>{fmtSigned(r.pnl)}</td>
            <td className="px-4 py-2.5 text-slate-500 hidden sm:table-cell">{fmtDT(r.createdAt)}</td>
            <td className="px-4 py-2.5 text-right"><Btn size="sm" variant="outline" disabled={dl===r.id} onClick={()=>download(r)}><Icon name="download" className="w-4 h-4"/>{dl===r.id?'…':'PDF'}</Btn></td>
          </tr>)}
        </tbody>
      </table></div></Card>}
  </div>;
}

/* ============================================================
   ROUTER + ROOT
   ============================================================ */
function useHashRoute(){
  const parse=()=>{ let h=window.location.hash.replace(/^#/,'')||'/activity'; const [path,query]=h.split('?'); const parts=path.split('/').filter(Boolean); const params=Object.fromEntries(new URLSearchParams(query||'')); return {parts,params}; };
  const [route,setRoute]=useState(parse);
  useEffect(()=>{ const h=()=>setRoute(parse()); window.addEventListener('hashchange',h); return ()=>window.removeEventListener('hashchange',h); },[]);
  return route;
}

/* Live market data: fetch real klines once + poll real tickers every 5s. Falls back to simulation on failure. */
function useLiveData(authed){
  const [klines,setKlines]=useState(null);
  const [tickers,setTickers]=useState({});
  const [status,setStatus]=useState('loading');
  useEffect(()=>{
    if(!authed) return;
    let alive=true; setStatus('loading');
    (async()=>{
      const kl=await loadAllKlines(); if(!alive)return; setKlines(kl);
      const tk=await loadAllTickers(); if(!alive)return; setTickers(tk.bots);
      setStatus(kl.allFail?'sim':(kl.fails||tk.fails)?'partial':'live');
    })();
    return ()=>{alive=false;};
  },[authed]);
  useEffect(()=>{
    if(!authed||!klines)return;
    const iv=setInterval(async()=>{ const tk=await loadAllTickers(); setTickers(tk.bots); if(!tk.allFail&&klines&&!klines.allFail) setStatus(s=>s==='sim'?s:(tk.fails?'partial':'live')); },5000);
    return ()=>clearInterval(iv);
  },[authed,klines]);
  const stat=useMemo(()=> klines? buildStatic(klines):null,[klines]);
  const data=useMemo(()=> stat? {bots:foldLive(stat,tickers),trades:stat.trades,stats:stat.stats,status}:null,[stat,tickers,status]);
  return {data,status};
}

/* Real exchange latency for Service Health (pings every 10s). */
function useServiceHealth(){
  const [pings,setPings]=useState(null);
  const [tick,setTick]=useState(0);
  useEffect(()=>{ let alive=true; const run=async()=>{ const p=await pingExchanges(); if(alive){setPings(p);setTick(t=>t+1);} }; run(); const iv=setInterval(run,10000); return ()=>{alive=false;clearInterval(iv);}; },[]);
  const r=mulberry32(2026+tick*7);
  return SERVICE_DEFS.map(s=>{
    if(s.ex){ const p=pings&&pings[s.ex]; return {name:s.name,ex:s.ex,status:!pings?'pending':(p.ok?(p.ms>250?'degraded':'active'):'down'),latency:p?p.ms:null}; }
    return {name:s.name,status:'active',latency:s.base+Math.floor(r()*s.jit)};
  });
}

// Global keyboard navigation: `g` then a letter jumps between pages, `/` focuses
// search, `?` toggles help. Ignored while typing in a field (except Escape).
function useKeyboardNav(navigate,user){
  const [help,setHelp]=useState(false);
  useEffect(()=>{
    let gPending=false, gTimer=null;
    const isTyping=(el)=>el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.tagName==='SELECT'||el.isContentEditable);
    const onKey=(e)=>{
      if(e.metaKey||e.ctrlKey||e.altKey) return;
      const typing=isTyping(document.activeElement);
      if(e.key==='Escape'){ setHelp(false); if(typing)document.activeElement.blur(); return; }
      if(typing) return;
      if(e.key==='?'){ e.preventDefault(); setHelp(h=>!h); return; }
      if(e.key==='/'){ e.preventDefault(); const s=document.querySelector('input[placeholder^="Search bots"]'); if(s)s.focus(); return; }
      if(gPending){
        gPending=false; clearTimeout(gTimer); const k=e.key.toLowerCase();
        const go={a:'/activity',r:'/realtime',p:'/prices',t:'/trades',l:'/logs',s:'/status',i:'/timeline'}[k];
        const adminGo={u:'/admin/users',e:'/admin/exchanges',w:'/admin/openwa',f:'/admin/funds'}[k];
        if(go){ e.preventDefault(); navigate(go); }
        else if(adminGo&&user.role==='admin'){ e.preventDefault(); navigate(adminGo); }
        return;
      }
      if(e.key==='g'){ gPending=true; gTimer=setTimeout(()=>{gPending=false;},1200); }
    };
    window.addEventListener('keydown',onKey);
    return ()=>{ window.removeEventListener('keydown',onKey); clearTimeout(gTimer); };
  },[navigate,user]);
  return {help,setHelp};
}
function ShortcutsModal({open,onClose,isAdmin}){
  const rows=[
    ['g a','Activity Dashboard'],['g r','Real-Time'],['g p','Prices'],['g t','Trades'],['g l','Activity Log'],
    ['g s','System Status'],['g i','Timeline'],
    ...(isAdmin?[['g u','Admin · Users'],['g e','Admin · Exchanges'],['g w','Admin · WhatsApp'],['g f','Admin · Funds']]:[]),
    ['/','Focus search'],['?','Toggle this help'],['Esc','Close / blur field'],
  ];
  return <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
      {rows.map(([k,d])=><div key={k} className="flex items-center justify-between gap-3 py-1">
        <span className="text-sm text-slate-600">{d}</span>
        <span className="flex gap-1">{k.split(' ').map((part,i)=><kbd key={i} className="px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[11px] font-mono text-navy">{part}</kbd>)}</span>
      </div>)}
    </div>
    <div className="text-[11px] text-slate-400 mt-4">Press <kbd className="px-1 rounded bg-slate-100 border border-slate-200 font-mono">g</kbd> then a letter to jump between pages.</div>
  </Modal>;
}

function Shell(){
  const {route,navigate,user}=useApp();
  const {help,setHelp}=useKeyboardNav(navigate,user);
  const [a,b,c]=route.parts;
  let page;
  if(a==='activity'){ page = b==='bot'? <ActivityPage botId={c}/> : <ActivityPage/>; }
  else if(a==='realtime') page=<RealtimePage/>;
  else if(a==='prices') page=<PricesPage/>;
  else if(a==='trades') page=<TradesPage/>;
  else if(a==='logs') page=<LogsPage/>;
  else if(a==='status') page=<StatusPage/>;
  else if(a==='timeline') page=<TimelinePage/>;
  else if(a==='admin'&&b==='users') page=<AdminUsers/>;
  else if(a==='admin'&&b==='exchanges') page=<AdminExchanges/>;
  else if(a==='admin'&&(b==='openwa'||b==='whatsapp')) page=<AdminOpenWA/>;
  else if(a==='admin'&&b==='funds') page=<AdminFunds/>;
  else if(a==='admin'&&b==='reports') page=<AdminReports/>;
  else if(a==='profile') page=<ProfilePage/>;
  else if(a==='support') page=<SupportPage/>;
  else page=<ActivityPage/>;
  return <div className="flex h-full">
    <Sidebar/>
    <div className="flex-1 flex flex-col min-w-0">
      <Header/>
      <main className="flex-1 overflow-y-auto p-4 lg:p-6 pb-20 lg:pb-6">{page}</main>
      <MobileNav/>
    </div>
    <ShortcutsModal open={help} onClose={()=>setHelp(false)} isAdmin={user.role==='admin'}/>
  </div>;
}

function Root(){
  const route=useHashRoute();
  const [user,setUser]=useState(null);
  const [booting,setBooting]=useState(true);
  const [funds,setFunds]=useState([]);
  const {data,status:dataStatus}=useLiveData(!!user);

  // restore session from the JWT on load
  useEffect(()=>{
    let alive=true;
    (async()=>{
      if(!getToken()){ if(alive){setBooting(false);} return; }
      try{ const r=await api('auth'); if(alive) setUser(r.user); }
      catch(e){ setToken(null); }
      finally{ if(alive) setBooting(false); }
    })();
    return ()=>{alive=false;};
  },[]);

  // graceful session expiry: any 401 with a token -> sign out + tell the user
  useEffect(()=>{
    const onUnauth=()=>{ if(getToken()){ setToken(null); setUser(null); window.location.hash='#/activity'; toast.error('Session expired — please sign in again.'); } };
    window.addEventListener('lno:unauthorized', onUnauth);
    return ()=>window.removeEventListener('lno:unauthorized', onUnauth);
  },[]);

  // presence heartbeat: keep last-seen fresh so the admin Users page shows who's online
  useEffect(()=>{
    if(!user) return;
    const ping=()=>api('auth',{method:'POST',body:{action:'heartbeat'}}).catch(()=>{});
    const iv=setInterval(ping,60000);
    return ()=>clearInterval(iv);
  },[user]);

  // funds are read by many pages (Activity/Realtime) — load once authed
  useEffect(()=>{
    if(!user){ setFunds([]); return; }
    let alive=true;
    api('funds').then(r=>{ if(alive) setFunds(r.funds||[]); }).catch(()=>{});
    return ()=>{alive=false;};
  },[user]);
  const reloadFunds=useCallback(async()=>{ const r=await api('funds'); setFunds(r.funds||[]); return r.funds; },[]);
  const saveFunds=useCallback(async(next)=>{ const r=await api('funds',{method:'PUT',body:{funds:next}}); setFunds(r.funds||[]); return r.funds; },[]);

  async function login(email,password){
    const r=await api('auth',{method:'POST',body:{action:'login',email,password}});
    setToken(r.token); setUser(r.user); return r.user;
  }
  async function loginGoogle(credential){
    const r=await api('auth',{method:'POST',body:{action:'google',credential}});
    setToken(r.token); setUser(r.user); return r.user;
  }
  function logout(){ api('auth',{method:'POST',body:{action:'logout'}}).catch(()=>{}); setToken(null); setUser(null); window.location.hash='#/activity'; }
  function navigate(to){ window.location.hash='#'+to; }

  const ctx={route,navigate,user,setUser,login,loginGoogle,logout,api,funds,setFunds,reloadFunds,saveFunds,data,dataStatus};

  const content = booting ? <LoadingScreen status="loading"/>
    : !user ? <Login/>
    : (!data||!funds.length) ? <LoadingScreen status={dataStatus}/>
    : <Shell/>;
  return <App.Provider value={ctx}>{content}<Toaster/></App.Provider>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root/>);
