// Shared backend constants (mirror of the frontend's defaults, server-authoritative)
export const PERMISSIONS = [
  'view_activity','view_realtime','view_trades','view_logs','view_reports','export_data',
  'manage_users','manage_exchanges','manage_whatsapp','manage_funds',
];
export const ROLE_PERMS = {
  admin: PERMISSIONS.slice(),
  operator: ['view_activity','view_realtime','view_trades','view_logs','export_data'],
  viewer: ['view_activity','view_realtime','view_trades','view_logs'],
  // shareholder: dashboard + prices + system status (via view_activity) and read-only reports
  shareholder: ['view_activity','view_reports'],
};
export const FUND_PALETTE = ['#C9A24D','#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444','#EC4899','#6366F1'];

export const DEFAULT_USERS = [
  { id:'u1', username:'admin',       email:'admin@lno.company',       firstName:'',     lastName:'',        role:'admin',    active:true,  phone:'', notify:true,  password:'admin' },
  { id:'u2', username:'sophie.ops',  email:'sophie.ops@lno.company',  firstName:'Sophie', lastName:'Laurent', role:'operator', active:true,  phone:'', notify:false, password:'admin' },
  { id:'u3', username:'marc.view',   email:'marc.view@lno.company',   firstName:'Marc',  lastName:'Dubois',  role:'viewer',   active:false, phone:'', notify:false, password:'admin' },
];
export const DEFAULT_FUNDS = [
  { id:'f1', name:'Alpha Fund', color:'#C9A24D', bots:['b1','b2','b3'] },
  { id:'f2', name:'Beta Fund',  color:'#3B82F6', bots:['b4','b5','b6'] },
  { id:'f3', name:'Gamma Fund', color:'#10B981', bots:['b7','b8'] },
];
// secrets here are placeholders; real ones are entered in the UI and stored encrypted
export const DEFAULT_EXCHANGES = [
  { id:'e1', name:'binance', label:'Binance Main',        apiKey:'BIN-9F2A-7H2K-2204', secret:'',  status:'pending', note:'Primary spot+futures' },
  { id:'e2', name:'bybit',   label:'Bybit Pro',           apiKey:'BYB-1C44-9X1Q-7781', secret:'',  status:'pending', note:'' },
  { id:'e3', name:'okx',     label:'OKX Institutional',   apiKey:'OKX-77B0-3L8P-0099', secret:'',  status:'pending', note:'Awaiting verification' },
];
// OpenWA (open-wa.org) integration config. apiKey is stored encrypted, never returned in clear.
// drawdownPct / pnlDayThreshold drive automated alerts; dailyReport toggles the daily summary.
export const DEFAULT_OPENWA = { defaultSender:'', enabled:false, drawdownPct:10, pnlDayThreshold:-5000, dailyReport:true };

// Bots traded by the firm (static; mirrors the frontend). Used by the alert cron to
// recompute portfolio metrics server-side from real exchange klines.
export const BASE_BOTS = [
  {id:'b1',name:'Alpha-BTC-Momentum',exchange:'Binance',symbol:'BTCUSDT',strategy:'Momentum'},
  {id:'b2',name:'Beta-ETH-Grid',exchange:'Binance',symbol:'ETHUSDT',strategy:'Grid'},
  {id:'b3',name:'Eta-AVAX-Breakout',exchange:'Bybit',symbol:'AVAXUSDT',strategy:'Breakout'},
  {id:'b4',name:'Gamma-SOL-Mean',exchange:'Bybit',symbol:'SOLUSDT',strategy:'Mean Reversion'},
  {id:'b5',name:'Delta-BNB-Arb',exchange:'OKX',symbol:'BNBUSDT',strategy:'Arbitrage'},
  {id:'b6',name:'Theta-MATIC-Grid',exchange:'OKX',symbol:'MATICUSDT',strategy:'Grid'},
  {id:'b7',name:'Epsilon-ADA-Trend',exchange:'Binance',symbol:'ADAUSDT',strategy:'Trend'},
  {id:'b8',name:'Zeta-XRP-Scalp',exchange:'Bybit',symbol:'XRPUSDT',strategy:'Scalping'},
];
export const FALLBACK_PRICE = {BTCUSDT:67000,ETHUSDT:3500,AVAXUSDT:38,SOLUSDT:165,BNBUSDT:600,MATICUSDT:0.72,ADAUSDT:0.45,XRPUSDT:0.62};
