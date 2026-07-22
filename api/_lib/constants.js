// Shared backend constants (mirror of the frontend's defaults, server-authoritative)
// view_logs and manage_users were removed (audit, 2026-07): view_logs never gated anything —
// there's no "logs" feature in the app for it to control — and manage_users would have let a
// non-admin holder promote any account (including themselves) to admin via the same PATCH
// endpoint that edits names/roles, a real privilege-escalation path. User/role management
// stays admin-only by design; nothing else in PERMISSIONS carries that risk.
export const PERMISSIONS = [
  'view_activity','view_realtime','view_trades',
  'view_reports_daily','view_reports_weekly','view_reports_monthly','view_exchanges','export_data',
  'manage_exchanges','manage_whatsapp','manage_funds',
];
export const ROLE_PERMS = {
  admin: PERMISSIONS.slice(),
  operator: ['view_activity','view_realtime','view_trades','export_data'],
  viewer: ['view_activity','view_realtime','view_trades'],
  // shareholder default: Exchanges (view_exchanges — wallets only, no keys), Funds
  // (view_trades — read-only), Live (view_realtime), System Status + dashboard (view_activity),
  // plus monthly reports only — the only kind ever sent to shareholders (SHAREHOLDER_KINDS
  // in api/snapshots.js); daily/weekly stay internal-only by default.
  shareholder: ['view_activity','view_realtime','view_trades','view_reports_monthly','view_exchanges'],
};
export const FUND_PALETTE = ['#C9A24D','#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444','#EC4899','#6366F1'];
// Preset avatar gallery (public/avatars/style{1,2}/s{1,2}-01..30.jpg), grouped by style —
// the Users page's avatar picker (admin) shows both styles; new accounts with no photo of
// their own default to a random one from style 2 only.
export const AVATAR_STYLES = ['style1', 'style2'];
export const AVATAR_COUNT_PER_STYLE = 30;
export function avatarUrl(style, n) { return `/avatars/${style}/s${style.slice(-1)}-${String(n).padStart(2, '0')}.jpg`; }
export function randomStyle2Avatar() { return avatarUrl('style2', 1 + Math.floor(Math.random() * AVATAR_COUNT_PER_STYLE)); }
// Supported UI / notification languages. Mirrored in src/i18n.ts (SUPPORTED_LANGS).
export const SUPPORTED_LANGS = ['en', 'fr', 'de', 'es'];

export const DEFAULT_USERS = [
  { id:'u1', username:'admin',       email:'admin@lno.company',       firstName:'',     lastName:'',        role:'admin',    active:true,  phone:'', notify:true,  password:'admin' },
  { id:'u2', username:'sophie.ops',  email:'sophie.ops@lno.company',  firstName:'Sophie', lastName:'Laurent', role:'operator', active:true,  phone:'', notify:false, password:'admin' },
  { id:'u3', username:'marc.view',   email:'marc.view@lno.company',   firstName:'Marc',  lastName:'Dubois',  role:'viewer',   active:false, phone:'', notify:false, password:'admin' },
];
// OpenWA (open-wa.org) integration config. apiKey is stored encrypted, never returned in clear.
// drawdownPct / pnlDayThreshold drive automated alerts; dailyReport toggles the daily summary.
// WhatsApp notification routing: which roles receive each message type.
export const WA_ROLES = ['admin','operator','viewer','shareholder'];
export const WA_MSG_TYPES = ['login','breach','stale','daily','weekly','monthly','new_report','api_error','new_signup','verify_reminder'];
export const DEFAULT_MATRIX = {
  login:      ['admin'],
  breach:     ['admin','operator'],
  stale:      ['admin','operator'],
  daily:      ['admin','operator'],
  weekly:     ['admin','operator'],
  monthly:    ['admin','operator'],
  new_report: ['shareholder'],
  api_error:  ['admin','operator'],
  new_signup: ['admin'],
  verify_reminder: ['admin'],
};
export const DEFAULT_OPENWA = { enabled:false, drawdownPct:10, pnlDayThreshold:-5000, dailyReport:true, notifMatrix: DEFAULT_MATRIX };
