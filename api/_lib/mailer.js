// Outbound transactional email via Resend (https://resend.com) — the only email-sending
// capability in this project; everything else routine goes over WhatsApp via
// api/_lib/notify.js. Used for OTP login codes and admin-facing operational alerts (an
// API/exchange sync failure, a new signup) that warrant email as well as WhatsApp.
import { Resend } from 'resend';

let _client;
function client() {
  if (!_client) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not set');
    _client = new Resend(key);
  }
  return _client;
}

const NAVY = '#0B1F3A';
const GOLD = '#C9A24D';

function otpEmailHtml(code) {
  return `<div style="background:#F8F7F4;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;text-align:center">
      <img src="https://cc.lno.company/logo.svg" alt="LNO Control Center" width="120" style="height:auto;display:block;margin:0 auto"/>
      <div style="margin-top:20px;font-size:14px;color:#475569">Your sign-in code is</div>
      <div style="margin:16px 0;font-size:36px;font-weight:700;letter-spacing:0.3em;color:${NAVY};font-variant-numeric:tabular-nums">${code}</div>
      <div style="height:3px;width:48px;background:${GOLD};margin:0 auto 16px;border-radius:2px"></div>
      <div style="font-size:13px;color:#94a3b8">This code expires in 10 minutes. If you didn't request it, you can ignore this email.</div>
    </div>
  </div>`;
}

// Never throws — callers (auth.js requestOtp) treat email delivery as best-effort so a
// transient Resend outage doesn't turn into a 500 on a security-sensitive login path;
// the caller logs/ignores the error and the request still returns {ok:true} either way
// (masking whether the account exists is more important than surfacing a send failure).
export async function sendOtpEmail(to, code) {
  // wearelno.com is the domain verified on Resend (SPF/DKIM) — noreply@lno.company would
  // fail to send since that domain was never added there. RESEND_FROM still overrides this
  // if that ever changes.
  const from = process.env.RESEND_FROM || 'LNO Control Center <noreply@wearelno.com>';
  await client().emails.send({ from, to, subject: `${code} is your LNO Control Center code`, html: otpEmailHtml(code) });
}

// These two alert emails interpolate admin/exchange config and Google-profile-sourced
// values (name/email) — escape before embedding, since HTML from a signed-up user's Google
// display name would otherwise render as-is in the recipient's email client.
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function alertEmailHtml(title, bodyHtml) {
  return `<div style="background:#F8F7F4;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
      <img src="https://cc.lno.company/logo.svg" alt="LNO Control Center" width="100" style="height:auto;display:block;margin:0 0 20px"/>
      <div style="font-size:16px;font-weight:700;color:${NAVY}">${title}</div>
      <div style="margin-top:12px;font-size:14px;color:#334155;line-height:1.6">${bodyHtml}</div>
    </div>
  </div>`;
}

// Callers wrap these in .catch() (same convention as sendOtpEmail) — an operational alert
// email failing to send shouldn't break the sync/signup flow that triggered it (WhatsApp
// still carries the same alert).
export async function sendApiErrorEmail(to, exchangeLabel, message) {
  const from = process.env.RESEND_FROM || 'LNO Control Center <noreply@wearelno.com>';
  const html = alertEmailHtml('⚠️ Exchange API error', `<strong>${escapeHtml(exchangeLabel)}</strong> failed to sync:<br/><span style="font-family:monospace;font-size:13px;color:#DC2626">${escapeHtml(message)}</span>`);
  await client().emails.send({ from, to, subject: `⚠️ ${exchangeLabel}: exchange API error`, html });
}

export async function sendNewSignupEmail(to, name, email) {
  const from = process.env.RESEND_FROM || 'LNO Control Center <noreply@wearelno.com>';
  const html = alertEmailHtml('👋 New sign-up', `<strong>${escapeHtml(name || email)}</strong> (${escapeHtml(email)}) just signed in with Google for the first time — created as a Viewer.`);
  await client().emails.send({ from, to, subject: `New Control Center sign-up: ${name || email}`, html });
}

const grp = (n) => Math.round(Math.abs(n)).toLocaleString('en-US').replace(/,/g, ' ');
const fUSD = (n) => grp(n) + ' USDT';
const fSigned = (n) => (n >= 0 ? '+' : '-') + grp(n) + ' USDT';
const pnlColor = (n) => (n >= 0 ? '#059669' : '#DC2626');

// Full daily report — HTML in the email BODY, not a PDF attachment (item 14 is explicit
// about this; the PDF still gets archived separately in Reports, see report.js).
export async function sendDailyReportEmail(to, d) {
  const from = process.env.RESEND_FROM || 'LNO Control Center <noreply@wearelno.com>';
  // Funds get their own equity line (notional committed + its unrealized PnL) rather than
  // a per-fund breakdown of the same positions already listed individually below — showing
  // both was pure duplication of the same numbers grouped two different ways.
  const funds = (d.funds || []).filter(f => (f.bots || []).length || f.uPnl || f.notional);
  const fundRows = funds.length ? funds.map(f => `
    <tr><td style="padding:8px 0;color:#334155;font-size:13px">${escapeHtml(f.name)}</td>
      <td style="padding:8px 0;text-align:right;color:${NAVY};font-size:13px;font-weight:600">${fUSD((f.notional || 0) + (f.uPnl || 0))}</td></tr>`).join('')
    : `<tr><td colspan="2" style="padding:8px 0;color:#94a3b8;font-size:13px">No open positions</td></tr>`;
  const positions = d.positions || [];
  const posRows = positions.length ? positions.slice(0, 30).map(p => `
    <tr><td style="padding:6px 0;font-family:monospace;font-size:12px;color:#0B1F3A">${escapeHtml(p.symbol)}</td>
      <td style="padding:6px 0;font-size:12px;color:${p.side === 'LONG' ? '#059669' : '#DC2626'}">${p.side}</td>
      <td style="padding:6px 0;text-align:right;color:${pnlColor(p.unrealizedPnl || 0)};font-size:12px">${fSigned(p.unrealizedPnl || 0)}</td>
      <td style="padding:6px 0;text-align:right;color:#94a3b8;font-size:12px">${fUSD(Math.abs(p.notional || 0))}</td></tr>`).join('')
    : `<tr><td colspan="4" style="padding:6px 0;color:#94a3b8;font-size:13px">No open positions</td></tr>`;
  const incidentBanner = d.incidentCount
    ? `<div style="margin-top:16px;padding:10px 14px;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;color:#DC2626;font-size:13px;font-weight:600">⚠️ ${d.incidentCount} incident${d.incidentCount === 1 ? '' : 's'} in the last 24h</div>`
    : `<div style="margin-top:16px;padding:10px 14px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;color:#059669;font-size:13px;font-weight:600">✓ No incidents in the last 24h</div>`;
  const html = `<div style="background:#F8F7F4;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
      <img src="https://cc.lno.company/logo.svg" alt="LNO Control Center" width="100" style="height:auto;display:block;margin:0 0 8px"/>
      <div style="font-size:18px;font-weight:700;color:${NAVY}">Daily Report — ${escapeHtml(d.dateLabel || '')}</div>
      <table style="width:100%;margin-top:16px;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Account equity</td><td style="padding:6px 0;text-align:right;font-weight:700;color:${NAVY};font-size:14px">${fUSD(d.equity)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">PnL — 24h</td><td style="padding:6px 0;text-align:right;font-weight:700;color:${pnlColor(d.pnlDay)};font-size:14px">${fSigned(d.pnlDay)} (${d.pctDay >= 0 ? '+' : ''}${d.pctDay.toFixed(2)}%)</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Open PnL</td><td style="padding:6px 0;text-align:right;font-weight:700;color:${pnlColor(d.openPnl || 0)};font-size:14px">${fSigned(d.openPnl || 0)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Exposure</td><td style="padding:6px 0;text-align:right;font-weight:700;color:${NAVY};font-size:14px">${fUSD(d.exposure || 0)}</td></tr>
      </table>
      ${incidentBanner}
      <div style="margin-top:24px;font-size:13px;font-weight:700;color:${NAVY};text-transform:uppercase;letter-spacing:0.03em">Open Positions</div>
      <table style="width:100%;margin-top:6px;border-collapse:collapse">${posRows}</table>
      <div style="margin-top:24px;font-size:13px;font-weight:700;color:${NAVY};text-transform:uppercase;letter-spacing:0.03em">Funds</div>
      <table style="width:100%;margin-top:6px;border-collapse:collapse">${fundRows}</table>
      <div style="margin-top:24px;font-size:11px;color:#94a3b8">Full detail, including the archived PDF: Control Center ▸ Reports</div>
    </div>
  </div>`;
  await client().emails.send({ from, to, subject: `📊 LNO Daily Report — ${d.dateLabel}`, html });
}

// 8am reminder to admins when unverified reports pile up (item 15) — names them + links
// straight to Reports pre-filtered on "to verify".
export async function sendVerifyReminderEmail(to, reportNames, link) {
  const from = process.env.RESEND_FROM || 'LNO Control Center <noreply@wearelno.com>';
  const list = reportNames.map(n => `<li style="margin:2px 0">${escapeHtml(n)}</li>`).join('');
  const html = alertEmailHtml('📋 Reports awaiting verification', `<ul style="margin:8px 0;padding-left:18px">${list}</ul><a href="${link}" style="display:inline-block;margin-top:8px;color:${GOLD};font-weight:600">Review now →</a>`);
  await client().emails.send({ from, to, subject: `${reportNames.length} report${reportNames.length === 1 ? '' : 's'} awaiting verification`, html });
}
