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
// OpenWA (open-wa.org) integration config. apiKey is stored encrypted, never returned in clear.
// drawdownPct / pnlDayThreshold drive automated alerts; dailyReport toggles the daily summary.
// WhatsApp notification routing: which roles receive each message type.
export const WA_ROLES = ['admin','operator','viewer','shareholder'];
export const WA_MSG_TYPES = ['login','breach','daily','weekly','monthly','new_report'];
export const DEFAULT_MATRIX = {
  login:      ['admin'],
  breach:     ['admin','operator'],
  daily:      ['admin','operator'],
  weekly:     ['admin','operator'],
  monthly:    ['admin','operator'],
  new_report: ['shareholder'],
};
export const DEFAULT_OPENWA = { enabled:false, drawdownPct:10, pnlDayThreshold:-5000, dailyReport:true, notifMatrix: DEFAULT_MATRIX };
