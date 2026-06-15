// Server-side portfolio metrics — a faithful port of the frontend's deterministic
// equity math so the alert cron / daily report match what users see on the dashboard.
import { BASE_BOTS, FALLBACK_PRICE } from './constants.js';

const DAY = 86400000;

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function seedStr(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function strategyBeta(strat,r){const m={Momentum:[0.8,1.2],Breakout:[0.7,1.1],Trend:[0.7,1.1],'Mean Reversion':[0.25,0.5],Grid:[0.2,0.45],Scalping:[0.15,0.4],Arbitrage:[0.03,0.12]};const x=m[strat]||[0.4,0.8];return x[0]+r()*(x[1]-x[0]);}

const EX = {
  parse(sym){ const quote=sym.endsWith('USDT')?'USDT':(sym.endsWith('USDC')?'USDC':'USD'); let base=sym.slice(0,sym.length-quote.length); return {base,quote,apiBase:base==='MATIC'?'POL':base}; },
  bn(sym){ const {apiBase,quote}=EX.parse(sym); return apiBase+quote; },
  okx(sym){ const {apiBase,quote}=EX.parse(sym); return apiBase+'-'+quote; },
};
async function fetchCloses(exchange, sym, limit){
  let rows=[];
  if(exchange==='Binance'){ const j=await (await fetch(`https://api.binance.com/api/v3/klines?symbol=${EX.bn(sym)}&interval=1d&limit=${limit}`)).json(); rows=j.map(k=>({t:+k[0],close:+k[4]})); }
  else if(exchange==='Bybit'){ const j=await (await fetch(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${EX.bn(sym)}&interval=D&limit=${limit}`)).json(); rows=((j.result&&j.result.list)||[]).map(k=>({t:+k[0],close:+k[4]})); }
  else { const j=await (await fetch(`https://www.okx.com/api/v5/market/candles?instId=${EX.okx(sym)}&bar=1D&limit=${Math.min(limit,300)}`)).json(); rows=(j.data||[]).map(k=>({t:+k[0],close:+k[4]})); }
  return rows.filter(x=>isFinite(x.close)&&x.close>0).sort((a,b)=>a.t-b.t);
}
function normalizeCloses(real, botId, target=365){
  if(real.length>=target) return real.slice(real.length-target);
  const need=target-real.length; const r=mulberry32(seedStr(botId+'pad')); let p=real[0].close, t=real[0].t; const head=[];
  for(let i=0;i<need;i++){ t-=DAY; const ret=(r()+r()+r()-1.5)*0.02; p=Math.max(p/(1+ret),p*0.5); head.push({t,close:+p.toFixed(8)}); }
  head.sort((a,b)=>a.t-b.t); return head.concat(real);
}
function synthCloses(botId, n){
  const b=BASE_BOTS.find(x=>x.id===botId); const r=mulberry32(seedStr(botId+'syn')); let p=FALLBACK_PRICE[b.symbol]||100; const out=[];
  for(let i=n-1;i>=0;i--){ const ret=(r()+r()+r()-1.5)*0.03; p=Math.max(p*(1+ret),p*0.5); out.push({t:Date.now()-i*DAY,close:+p.toFixed(8)}); }
  return out;
}
function botSeries(bot, closes){
  const r=mulberry32(seedStr(bot.id));
  const e0=40000+Math.floor(r()*160000);
  const beta=strategyBeta(bot.strategy,r);
  const alpha=r()*0.0006;
  const s=[]; let eq=e0; s.push({t:closes[0].t,equity:eq});
  for(let i=1;i<closes.length;i++){ const ret=closes[i].close/closes[i-1].close-1; eq=Math.max(eq*(1+alpha+beta*ret),e0*0.25); s.push({t:closes[i].t,equity:Math.round(eq)}); }
  return { series:s };
}

export async function computePortfolio(){
  const per={}; let fails=0;
  await Promise.all(BASE_BOTS.map(async b=>{
    let closes;
    try{ const r=await fetchCloses(b.exchange,b.symbol,365); if(!r.length) throw 0; closes=normalizeCloses(r,b.id); }
    catch(e){ fails++; closes=synthCloses(b.id,365); }
    per[b.id]=botSeries(b,closes);
  }));
  const ids=BASE_BOTS.map(b=>b.id);
  const minLen=Math.min(...ids.map(id=>per[id].series.length));
  const series=[];
  for(let i=0;i<minLen;i++){ let sum=0,t=0; ids.forEach(id=>{ const s=per[id].series; const pt=s[s.length-minLen+i]; sum+=pt.equity; t=pt.t; }); series.push({t,equity:sum}); }
  const byExchange={}, bySymbol={};
  let best={name:null,pnl:-Infinity}, worst={name:null,pnl:Infinity};
  BASE_BOTS.forEach(b=>{ const s=per[b.id].series; const cur=s[s.length-1].equity; const pnl=cur-s[Math.max(0,s.length-2)].equity;
    byExchange[b.exchange]=(byExchange[b.exchange]||0)+cur; bySymbol[EX.parse(b.symbol).base]=(bySymbol[EX.parse(b.symbol).base]||0)+cur;
    if(pnl>best.pnl) best={name:b.name,pnl}; if(pnl<worst.pnl) worst={name:b.name,pnl}; });
  return { series, byExchange, bySymbol, best, worst, fails };
}

export function riskMetrics(series){
  const eq=series.map(p=>p.equity);
  const rets=[]; for(let i=1;i<eq.length;i++) rets.push(eq[i]/eq[i-1]-1);
  const n=rets.length||1;
  const mean=rets.reduce((a,b)=>a+b,0)/n;
  const sd=Math.sqrt(rets.reduce((a,b)=>a+(b-mean)**2,0)/n);
  const down=rets.filter(r=>r<0);
  const dd=Math.sqrt(down.reduce((a,b)=>a+b*b,0)/(down.length||1));
  const ann=Math.sqrt(365);
  let peak=eq[0],peakI=0,mdd=0,ddDur=0;
  for(let i=0;i<eq.length;i++){ if(eq[i]>=peak){peak=eq[i];peakI=i;} else { const d=(eq[i]-peak)/peak; if(d<mdd)mdd=d; if(i-peakI>ddDur)ddDur=i-peakI; } }
  const last=eq[eq.length-1], prev=eq[eq.length-2]||last, wk=eq[eq.length-8]||eq[0];
  return {
    totalEquity:last, pnlDay:last-prev, pnlWeek:last-wk,
    sharpe:sd?(mean/sd)*ann:0, sortino:dd?(mean/dd)*ann:0,
    maxDrawdownPct:mdd*100, ddDurationDays:ddDur,
  };
}
