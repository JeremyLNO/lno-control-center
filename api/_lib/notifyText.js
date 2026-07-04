// Localized WhatsApp/report message builders. Mirrors src/i18n.ts's flat-key + {var}
// substitution pattern, kept server-side and self-contained (no shared bundle with the
// frontend). Every notify() call site builds its message through one of these functions
// so each recipient gets the text in THEIR OWN users.language, not a single fixed locale.
import { colorToEmoji } from './colors.js';

const SUPPORTED = ['en', 'fr', 'de', 'es'];
const L = (lang) => (SUPPORTED.includes(lang) ? lang : 'en');

const grp = (n) => Math.round(Math.abs(n)).toLocaleString('en-US').replace(/,/g, ' ');
const fmt = (n) => (n >= 0 ? '+' : '-') + grp(n) + ' USDT';
const fUSD = (n) => grp(n) + ' USDT';

const STR = {
  en: {
    welcome: "🎉 Welcome to LNO Control Center alerts! Your WhatsApp is set up — you'll receive your alerts right here.",
    reportAvailable: '📄 A new LNO report is available. Open the Control Center ▸ Reports to download it.',
    loginFailure: '⚠️ LNO Control Center — 3 failed login attempts for "{email}".',
    dailyTitle: '📊 LNO DAILY REPORT', weeklyTitle: '📅 LNO WEEKLY REPORT', monthlyTitle: '🗓️ LNO MONTHLY REPORT',
    fullPdf: 'Full PDF: Control Center ▸ Reports',
    equity: 'Equity', pnl: 'PnL', openPnl: 'Open PnL', exposure: 'Exposure',
    periodDay: 'day', period7d: '7d', period30d: '30d',
    alertHeader: '🚨 LNO ALERT', replyAck: 'Reply *ACK {code}* to acknowledge.',
    drawdownBreach: 'Portfolio: drawdown {pct}% (limit -{limit}%)',
    pnlBreach: 'Portfolio: daily PnL {pnl} (limit {limit})',
    staleHeader: '🕒 LNO DORMANT BOT ALERT', staleLine: '{symbol}{side} — no activity in {hours}h',
    staleFooterOne: 'Check whether the strategy behind this position is still running.',
    staleFooterMany: 'Check whether the strategy behind these positions is still running.',
  },
  fr: {
    welcome: '🎉 Bienvenue dans les alertes LNO Control Center ! Votre WhatsApp est configuré — vous recevrez vos alertes ici.',
    reportAvailable: '📄 Un nouveau rapport LNO est disponible. Ouvrez Control Center ▸ Rapports pour le télécharger.',
    loginFailure: '⚠️ LNO Control Center — 3 tentatives de connexion échouées pour « {email} ».',
    dailyTitle: '📊 RAPPORT QUOTIDIEN LNO', weeklyTitle: '📅 RAPPORT HEBDOMADAIRE LNO', monthlyTitle: '🗓️ RAPPORT MENSUEL LNO',
    fullPdf: 'PDF complet : Control Center ▸ Rapports',
    equity: 'Equity', pnl: 'PnL', openPnl: 'PnL latent', exposure: 'Exposition',
    periodDay: 'jour', period7d: '7j', period30d: '30j',
    alertHeader: '🚨 ALERTE LNO', replyAck: 'Répondez *ACK {code}* pour acquitter.',
    drawdownBreach: 'Portefeuille : drawdown {pct}% (limite -{limit}%)',
    pnlBreach: 'Portefeuille : PnL quotidien {pnl} (limite {limit})',
    staleHeader: '🕒 ALERTE BOT DORMANT LNO', staleLine: '{symbol}{side} — aucune activité depuis {hours}h',
    staleFooterOne: 'Vérifiez que la stratégie derrière cette position fonctionne toujours.',
    staleFooterMany: 'Vérifiez que la stratégie derrière ces positions fonctionne toujours.',
  },
  de: {
    welcome: '🎉 Willkommen bei den LNO Control Center-Benachrichtigungen! Ihr WhatsApp ist eingerichtet — Sie erhalten Ihre Alarme hier.',
    reportAvailable: '📄 Ein neuer LNO-Bericht ist verfügbar. Öffnen Sie Control Center ▸ Berichte, um ihn herunterzuladen.',
    loginFailure: '⚠️ LNO Control Center — 3 fehlgeschlagene Anmeldeversuche für „{email}".',
    dailyTitle: '📊 LNO TAGESBERICHT', weeklyTitle: '📅 LNO WOCHENBERICHT', monthlyTitle: '🗓️ LNO MONATSBERICHT',
    fullPdf: 'Vollständiges PDF: Control Center ▸ Berichte',
    equity: 'Kontostand', pnl: 'PnL', openPnl: 'Offener PnL', exposure: 'Exponierung',
    periodDay: 'Tag', period7d: '7T', period30d: '30T',
    alertHeader: '🚨 LNO-ALARM', replyAck: 'Antworten Sie mit *ACK {code}*, um zu bestätigen.',
    drawdownBreach: 'Portfolio: Drawdown {pct}% (Limit -{limit}%)',
    pnlBreach: 'Portfolio: Tages-PnL {pnl} (Limit {limit})',
    staleHeader: '🕒 LNO-ALARM: INAKTIVER BOT', staleLine: '{symbol}{side} — seit {hours}h keine Aktivität',
    staleFooterOne: 'Prüfen Sie, ob die Strategie hinter dieser Position noch läuft.',
    staleFooterMany: 'Prüfen Sie, ob die Strategie hinter diesen Positionen noch läuft.',
  },
  es: {
    welcome: '🎉 ¡Bienvenido a las alertas de LNO Control Center! Tu WhatsApp está configurado — recibirás tus alertas aquí.',
    reportAvailable: '📄 Hay un nuevo informe de LNO disponible. Abre Control Center ▸ Informes para descargarlo.',
    loginFailure: '⚠️ LNO Control Center — 3 intentos de inicio de sesión fallidos para "{email}".',
    dailyTitle: '📊 INFORME DIARIO LNO', weeklyTitle: '📅 INFORME SEMANAL LNO', monthlyTitle: '🗓️ INFORME MENSUAL LNO',
    fullPdf: 'PDF completo: Control Center ▸ Informes',
    equity: 'Patrimonio', pnl: 'PnL', openPnl: 'PnL abierto', exposure: 'Exposición',
    periodDay: 'día', period7d: '7d', period30d: '30d',
    alertHeader: '🚨 ALERTA LNO', replyAck: 'Responde *ACK {code}* para reconocerla.',
    drawdownBreach: 'Cartera: drawdown {pct}% (límite -{limit}%)',
    pnlBreach: 'Cartera: PnL diario {pnl} (límite {limit})',
    staleHeader: '🕒 ALERTA DE BOT INACTIVO LNO', staleLine: '{symbol}{side} — sin actividad en {hours}h',
    staleFooterOne: 'Comprueba si la estrategia detrás de esta posición sigue en marcha.',
    staleFooterMany: 'Comprueba si la estrategia detrás de estas posiciones sigue en marcha.',
  },
};

function t(lang, key, vars) {
  let s = (STR[L(lang)] && STR[L(lang)][key]) || STR.en[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}

export function welcomeText(lang) { return t(lang, 'welcome'); }
export function reportAvailableText(lang) { return t(lang, 'reportAvailable'); }
export function loginFailureText(lang, email) { return t(lang, 'loginFailure', { email }); }

// kind: 'daily' | 'weekly' | 'monthly'; period: { pnl, pct, labelKey: 'periodDay'|'period7d'|'period30d' }
export function reportText(lang, kind, port, period) {
  const title = kind === 'daily' ? t(lang, 'dailyTitle') : kind === 'weekly' ? t(lang, 'weeklyTitle') : t(lang, 'monthlyTitle');
  let out = `*${title}*\n\n${t(lang, 'equity')} ${fUSD(port.equity)}\n${t(lang, 'pnl')} ${t(lang, period.labelKey)} ${fmt(period.pnl)} • ${(period.pct >= 0 ? '+' : '-') + Math.abs(period.pct).toFixed(1) + '%'}`;
  if (port.bots.length) out += `\n${t(lang, 'openPnl')} ${fmt(port.openPnl)} · ${t(lang, 'exposure')} ${fUSD(port.exposure)}`;
  const groups = port.funds.filter(f => f.bots.length).concat(port.unassigned.bots.length ? [port.unassigned] : []);
  for (const g of groups) {
    out += `\n\n${g.id ? colorToEmoji(g.color) : '⚪'} *${g.name}*\n${t(lang, 'pnl')} ${fmt(g.uPnl)} · ${t(lang, 'exposure')} ${fUSD(g.notional)}`;
    for (const b of g.bots) out += `\n  • ${b.symbol}${b.side ? ' ' + b.side : ''} ${fmt(Number(b.unrealized_pnl || 0))}`;
  }
  if (kind === 'monthly') out += '\n\n' + t(lang, 'fullPdf');
  return out;
}

// breaches: array of {kind:'drawdown', pct, limit} | {kind:'pnlDay', pnl, limit}
export function breachAlertText(lang, breaches, port, code) {
  const lines = breaches.map(b => b.kind === 'drawdown'
    ? t(lang, 'drawdownBreach', { pct: b.pct.toFixed(1), limit: b.limit })
    : t(lang, 'pnlBreach', { pnl: fmt(b.pnl), limit: fmt(b.limit) }));
  return `${t(lang, 'alertHeader')}\n${lines.join('\n')}\n${t(lang, 'equity')} ${fUSD(port.equity)} · ${t(lang, 'pnl')} ${t(lang, 'periodDay')} ${fmt(port.pnlDay)}\n\n${t(lang, 'replyAck', { code })}`;
}

// dormantBots: array of {symbol, side, hours}
export function dormantAlertText(lang, dormantBots) {
  const lines = dormantBots.map(b => t(lang, 'staleLine', { symbol: b.symbol, side: b.side ? ' ' + b.side : '', hours: b.hours }));
  const footer = dormantBots.length === 1 ? t(lang, 'staleFooterOne') : t(lang, 'staleFooterMany');
  return `${t(lang, 'staleHeader')}\n${lines.join('\n')}\n\n${footer}`;
}
