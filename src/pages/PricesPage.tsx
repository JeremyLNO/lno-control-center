import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  fmtPrice, fmtAgo, baseOf, PREF, Card, useApp, hasPerm, PageHead, Denied
} from '../ui'
import { Quantum } from 'ldrs/react'
import 'ldrs/react/Quantum.css'

/* ============================================================
   SYSTEM STATUS
   ============================================================ */
const PRICE_SYMBOLS=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT','ATOMUSDT','NEARUSDT','HYPEUSDT'];
// Live public crypto prices — Binance's public futures ticker WebSocket (no key, no CORS
// issue since it's not even HTTP), so every symbol updates in real time (~once/sec) instead
// of waiting on a fixed poll interval. Entirely independent of the account/positions.
function PricesPage(){
  const {user,t}=useApp();
  const [rows,setRows]=useState(null); const [err,setErr]=useState(false); const [ts,setTs]=useState(null);
  const [order,setOrder]=useState(()=>PREF.get('prices_order',[])); const [drag,setDrag]=useState(null);
  useEffect(()=>{
    if(!hasPerm(user,'view_activity')) return;
    let stopped=false, ws: WebSocket|null=null, reconnectTimer: any=null, reconnectDelay=2000;
    let restIv: any=null, watchdog: any=null, gotFirstMessage=false;
    const want=new Set(PRICE_SYMBOLS);

    // Fallback: some networks (corporate proxies, certain regions) let the WS handshake
    // through but silently drop the actual data frames, or block it outright. If no real
    // tick has arrived a few seconds after connecting, fall back to the old 20s REST poll so
    // the page never gets stuck on "Loading…" — and drop the fallback the moment WS data
    // does start flowing (now, or after a later successful reconnect).
    const loadRest=async()=>{
      try{
        const r=await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr',{cache:'no-store'});
        if(!r.ok) throw 0; const all=await r.json(); if(stopped) return;
        const j=(Array.isArray(all)?all:[]).filter(x=>want.has(x.symbol));
        setRows(j.map(x=>({symbol:x.symbol,base:baseOf(x.symbol),price:+x.lastPrice,chg:+x.priceChangePercent,vol:+x.quoteVolume,high:+x.highPrice,low:+x.lowPrice})).sort((a,b)=>b.vol-a.vol));
        setErr(false); setTs(Date.now());
      }catch(e){ if(!stopped){ setErr(true); setRows(p=>p||[]); } }
    };
    const startRestFallback=()=>{ if(restIv) return; loadRest(); restIv=setInterval(loadRest,20000); };

    // Set once, tied to the whole mount — NOT re-armed on every reconnect attempt. A blocked
    // connection (CSP, proxy, offline) fires onerror/onclose before onopen ever runs, and
    // retries can cycle well within 8s of each other; arming the watchdog inside onopen (or
    // resetting it on every connect()) means a connection that never opens never triggers the
    // fallback. This way it fires exactly once, 8s after the first attempt, unless real data
    // has arrived by then.
    watchdog=setTimeout(()=>{ if(!gotFirstMessage) startRestFallback(); },8000);

    function connect(){
      if(stopped) return;
      // !ticker@arr streams a fresh 24hr-ticker snapshot for EVERY symbol roughly once a
      // second; filtering client-side mirrors exactly what the REST fetch-all-then-filter
      // fallback does (the futures ticker endpoint has no per-symbol batch param either).
      ws=new WebSocket('wss://fstream.binance.com/ws/!ticker@arr');
      ws.onopen=()=>{ reconnectDelay=2000; };
      ws.onmessage=(ev)=>{
        try{
          const all=JSON.parse(ev.data);
          const j=(Array.isArray(all)?all:[]).filter(x=>want.has(x.s));
          if(!j.length) return;
          if(!gotFirstMessage){ gotFirstMessage=true; clearTimeout(watchdog); if(restIv){ clearInterval(restIv); restIv=null; } }
          setRows(j.map(x=>({symbol:x.s,base:baseOf(x.s),price:+x.c,chg:+x.P,vol:+x.q,high:+x.h,low:+x.l})).sort((a,b)=>b.vol-a.vol));
          setErr(false); setTs(Date.now());
        }catch(e){ /* a malformed tick shouldn't drop the whole stream */ }
      };
      ws.onclose=()=>{ if(stopped)return; if(gotFirstMessage) setErr(true); reconnectTimer=setTimeout(connect,reconnectDelay); reconnectDelay=Math.min(reconnectDelay*2,30000); };
      ws.onerror=()=>{ try{ ws&&ws.close(); }catch(e){} };
    }
    connect();
    return ()=>{ stopped=true; if(ws){ try{ ws.close(); }catch(e){} } if(reconnectTimer) clearTimeout(reconnectTimer); if(restIv) clearInterval(restIv); if(watchdog) clearTimeout(watchdog); };
  },[]);
  // apply the user's saved drag order; unknown/new symbols fall to the end (by volume)
  const ordered=useMemo(()=>{ if(!rows||!order.length) return rows; const idx=s=>{ const i=order.indexOf(s); return i<0?1e9:i; }; return rows.slice().sort((a,b)=>idx(a.symbol)-idx(b.symbol)||b.vol-a.vol); },[rows,order]);
  if(!hasPerm(user,'view_activity')) return <Denied/>;
  const compact=(n)=>{ const a=Math.abs(n); return a>=1e9?(n/1e9).toFixed(2)+'B':a>=1e6?(n/1e6).toFixed(1)+'M':a>=1e3?(n/1e3).toFixed(0)+'K':String(Math.round(n)); };
  const px=(p)=>fmtPrice(p).replace(' USDT','');
  const onDrop=(targetSym)=>{ const cur=(ordered||[]).map(r=>r.symbol); const from=cur.indexOf(drag); if(from<0||drag===targetSym){ setDrag(null); return; } cur.splice(from,1); const to=cur.indexOf(targetSym); cur.splice(to<0?cur.length:to,0,drag); setOrder(cur); PREF.set('prices_order',cur); setDrag(null); };
  return <div>
    <PageHead title={t('prices.title')} subtitle={t('prices.subtitle')} actions={<div className="flex items-center gap-3">
      {order.length>0&&<button onClick={()=>{setOrder([]);PREF.set('prices_order',[]);}} className="text-xs text-slate-400 hover:text-navy">{t('prices.resetOrder')}</button>}
      {ts&&<span className="text-xs text-slate-400">{t('prices.updatedAgo',{ago:fmtAgo(ts)})}</span>}
    </div>}/>
    {rows==null? <Card className="p-10 text-center text-slate-400 text-sm">
        <div className="flex justify-center mb-2"><Quantum size="45" speed="1.9" color="#C9A24D"/></div>
        {t('prices.loading')}
      </Card>
     : err&&!rows.length? <Card className="p-10 text-center text-slate-400 text-sm">{t('prices.couldNotLoad')}</Card>
     : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {ordered.map(row=><div key={row.symbol} draggable
          onDragStart={()=>setDrag(row.symbol)} onDragOver={e=>e.preventDefault()} onDrop={()=>onDrop(row.symbol)} onDragEnd={()=>setDrag(null)}
          className={`cursor-move select-none transition ${drag===row.symbol?'opacity-40':''}`}>
          <Card className={`p-4 h-full ${drag===row.symbol?'ring-2 ring-gold':''}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-9 h-9 rounded-full bg-navy text-white grid place-items-center text-[11px] font-bold shrink-0">{row.base.slice(0,4)}</span>
                <div className="min-w-0 leading-tight"><div className="font-semibold text-navy truncate">{row.base}</div><div className="text-[11px] text-slate-400">/USDT</div></div>
              </div>
              <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${row.chg>=0?'bg-success/10 text-success':'bg-danger/10 text-danger'}`}>{row.chg>=0?'▲':'▼'} {Math.abs(row.chg).toFixed(1)}%</span>
            </div>
            <div className="text-lg font-bold text-navy mt-3 tabular-nums truncate">{fmtPrice(row.price)}</div>
            <div className="flex items-center justify-between gap-1 text-[11px] text-slate-400 mt-2 tabular-nums">
              <span>{t('prices.high')} {px(row.high)}</span><span>{t('prices.low')} {px(row.low)}</span><span className="text-slate-500">{t('prices.vol')} {compact(row.vol)}</span>
            </div>
          </Card>
        </div>)}
      </div>}
    <p className="text-[11px] text-slate-400 mt-3">{t('prices.footerHint')}</p>
  </div>;
}

export { PricesPage };
