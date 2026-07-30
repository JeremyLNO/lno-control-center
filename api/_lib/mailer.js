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

// Inline SVG equity sparkline — renders fine in Apple Mail/most modern clients; Outlook and
// some Gmail contexts strip embedded SVG, in which case it simply doesn't render and the
// stat table + fund bars below still carry the same numbers in text form. Deliberately not a
// server-rendered PNG (see the reports-redesign proposal) — that's a fast-follow if Outlook
// opens turn out to matter; most of this list reads on phones.
function sparklineSvg(series, positive) {
  if (!series || series.length < 2) return '';
  const w = 600, h = 90, pad = 4;
  const min = Math.min(...series), max = Math.max(...series);
  const range = (max - min) || 1;
  const n = series.length;
  const x = (i) => (i / (n - 1)) * w;
  const y = (v) => pad + (1 - (v - min) / range) * (h - pad * 2);
  const line = series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const color = positive ? '#059669' : '#DC2626';
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" style="display:block">
    <line x1="0" y1="${h * 0.25}" x2="${w}" y2="${h * 0.25}" stroke="#E7EAF0" stroke-width="1"/>
    <line x1="0" y1="${h * 0.5}" x2="${w}" y2="${h * 0.5}" stroke="#E7EAF0" stroke-width="1"/>
    <line x1="0" y1="${h * 0.75}" x2="${w}" y2="${h * 0.75}" stroke="#E7EAF0" stroke-width="1"/>
    <path d="${area}" fill="${color}" fill-opacity="0.12"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${x(n - 1).toFixed(1)}" cy="${y(series[n - 1]).toFixed(1)}" r="4" fill="${color}"/>
  </svg>`;
}
// Horizontal BOT bars — one row per individual open position, same visual language as
// fundBarsHtml() below, one level more granular. This is the primary breakdown now; Funds
// (below it) is the supplementary roll-up.
function botBarsHtml(positions) {
  const rows = positions || [];
  if (!rows.length) return `<div style="padding:8px 0;color:#94a3b8;font-size:13px">No open positions</div>`;
  const maxAbs = Math.max(...rows.map(p => Math.abs(p.notional || 0)), 1);
  return rows.slice(0, 12).map(p => {
    const pct = Math.max(2, Math.round((Math.abs(p.notional || 0) / maxAbs) * 100));
    const color = (p.unrealizedPnl || 0) >= 0 ? '#059669' : '#DC2626';
    return `<div style="margin:10px 0">
      <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px">
        <span style="color:#334155;font-weight:500;font-family:monospace">${escapeHtml(p.symbol)} <span style="color:${p.side === 'LONG' ? '#059669' : '#DC2626'};font-family:inherit;font-weight:600">${p.side || ''}</span></span>
        <span style="font-family:monospace;color:${color};font-weight:600">${fSigned(p.unrealizedPnl || 0)}</span>
      </div>
      <div style="height:6px;background:#F1F3F6;border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:3px"></div>
      </div>
    </div>`;
  }).join('');
}
// Horizontal fund bars — width proportional to notional, same visual language as the PDF's
// drawFundBars() and the Activity Dashboard's fund allocation view.
function fundBarsHtml(funds) {
  const rows = (funds || []).filter(f => (f.bots || []).length || f.uPnl || f.notional);
  if (!rows.length) return `<div style="padding:8px 0;color:#94a3b8;font-size:13px">No open positions</div>`;
  const maxAbs = Math.max(...rows.map(f => Math.abs(f.notional || 0)), 1);
  return rows.map(f => {
    const pct = Math.max(2, Math.round((Math.abs(f.notional || 0) / maxAbs) * 100));
    const color = (f.uPnl || 0) >= 0 ? '#059669' : '#DC2626';
    return `<div style="margin:10px 0">
      <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px">
        <span style="color:#334155;font-weight:500">${escapeHtml(f.name)}</span>
        <span style="font-family:monospace;color:${color};font-weight:600">${fSigned(f.uPnl || 0)}</span>
      </div>
      <div style="height:6px;background:#F1F3F6;border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:3px"></div>
      </div>
    </div>`;
  }).join('');
}

// Full daily report — HTML in the email BODY, not a PDF attachment (item 14 is explicit
// about this; the PDF still gets archived separately in Reports, see report.js).
export function dailyReportHtml(d) {
  const from = process.env.RESEND_FROM || 'LNO Control Center <noreply@wearelno.com>';
  const incidentBanner = d.incidentCount
    ? `<div style="margin-top:16px;padding:10px 14px;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;color:#DC2626;font-size:13px;font-weight:600">⚠️ ${d.incidentCount} incident${d.incidentCount === 1 ? '' : 's'} in the last 24h</div>`
    : `<div style="margin-top:16px;padding:10px 14px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;color:#059669;font-size:13px;font-weight:600">✓ No incidents in the last 24h</div>`;
  const spark = sparklineSvg(d.series, d.pnlDay >= 0);
  const html = `<div style="background:#F8F7F4;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
      <img src="https://cc.lno.company/logo.svg" alt="LNO Control Center" width="100" style="height:auto;display:block;margin:0 0 8px"/>
      <div style="font-size:18px;font-weight:700;color:${NAVY}">Daily Report — ${escapeHtml(d.dateLabel || '')}</div>
      <div style="margin-top:16px;padding:20px;background:#F8F7F4;border-radius:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px">
          <div><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em">Account equity</div>
            <div style="font-size:26px;font-weight:700;color:${NAVY};font-family:monospace">${fUSD(d.equity)}</div></div>
          <div style="text-align:right"><div style="font-family:monospace;font-size:14px;font-weight:700;color:${pnlColor(d.pnlDay)}">${fSigned(d.pnlDay)}</div>
            <div style="font-family:monospace;font-size:11px;color:${pnlColor(d.pctDay)}">${d.pctDay >= 0 ? '+' : ''}${d.pctDay.toFixed(2)}% vs yesterday</div>
            ${d.prevPct != null ? `<div style="font-family:monospace;font-size:11px;color:#94a3b8">prev. ${d.prevPct >= 0 ? '+' : ''}${d.prevPct.toFixed(2)}%</div>` : ''}</div>
        </div>
        ${spark ? `<div style="margin-top:14px">${spark}</div>` : ''}
      </div>
      <table style="width:100%;margin-top:16px;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Open PnL</td><td style="padding:6px 0;text-align:right;font-weight:700;color:${pnlColor(d.openPnl || 0)};font-size:14px">${fSigned(d.openPnl || 0)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Exposure</td><td style="padding:6px 0;text-align:right;font-weight:700;color:${NAVY};font-size:14px">${fUSD(d.exposure || 0)}</td></tr>
      </table>
      ${incidentBanner}
      <div style="margin-top:24px;font-size:13px;font-weight:700;color:${NAVY};text-transform:uppercase;letter-spacing:0.03em">By Bot</div>
      ${botBarsHtml(d.positions)}
      <div style="margin-top:24px;font-size:13px;font-weight:700;color:${NAVY};text-transform:uppercase;letter-spacing:0.03em">Funds</div>
      ${fundBarsHtml(d.funds)}
      <div style="margin-top:24px;font-size:11px;color:#94a3b8">Full detail, including the archived PDF: Control Center ▸ Reports</div>
    </div>
  </div>`;
  return html;
}
export async function sendDailyReportEmail(to, d) {
  const from = process.env.RESEND_FROM || 'LNO Control Center <noreply@wearelno.com>';
  await client().emails.send({ from, to, subject: `📊 LNO Daily Report — ${d.dateLabel}`, html: dailyReportHtml(d) });
}

// 8am reminder to admins when unverified reports pile up (item 15) — names them + links
// straight to Reports pre-filtered on "to verify".
export async function sendVerifyReminderEmail(to, reportNames, link) {
  const from = process.env.RESEND_FROM || 'LNO Control Center <noreply@wearelno.com>';
  const list = reportNames.map(n => `<li style="margin:2px 0">${escapeHtml(n)}</li>`).join('');
  const html = alertEmailHtml('📋 Reports awaiting verification', `<ul style="margin:8px 0;padding-left:18px">${list}</ul><a href="${link}" style="display:inline-block;margin-top:8px;color:${GOLD};font-weight:600">Review now →</a>`);
  await client().emails.send({ from, to, subject: `${reportNames.length} report${reportNames.length === 1 ? '' : 's'} awaiting verification`, html });
}

// Weekly review email. Unlike the daily report (a snapshot of the account), this is the
// analysis of the week that ended: the result read against the previous week and the recent
// average, who moved it, and what a person has to look at. Sent as HTML in the body, same as
// the daily one — the PDF is archived separately in Reports.
export function weeklyReportHtml(rv) {
  const from = process.env.RESEND_FROM || 'LNO Control Center <noreply@wearelno.com>';
  const p = rv.portfolio;
  const up = (p.netPnl || 0) >= 0;
  const colorOf = (n) => (n >= 0 ? '#059669' : '#DC2626');

  // "No comparable week" is a real state — a desk two weeks old has nothing to compare
  // against — and saying so beats printing a percentage derived from a zero baseline.
  const vsPrev = p.vsPrevPct == null
    ? 'no comparable previous week'
    : `${p.vsPrevPct >= 0 ? '+' : ''}${p.vsPrevPct}% vs last week (${fSigned(p.prevNetPnl)})`;
  const vsAvg = p.vsAvgPct == null ? '' : ` · ${p.vsAvgPct >= 0 ? '+' : ''}${p.vsAvgPct}% vs 4-week average`;

  const stat = (label, value, color) => `<tr>
    <td style="padding:6px 0;color:#64748B;font-size:13px">${escapeHtml(label)}</td>
    <td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:600;color:${color || NAVY};font-size:13px">${escapeHtml(String(value))}</td></tr>`;

  const botRows = (rows, sign) => rows.map(b => `<div style="display:flex;justify-content:space-between;font-size:13px;margin:5px 0">
      <span style="font-family:monospace;color:#334155">${escapeHtml(b.symbol)}</span>
      <span style="font-family:monospace;font-weight:600;color:${colorOf(sign)}">${fSigned(b.netPnl)} <span style="color:#94A3B8;font-weight:400">(${b.trades})</span></span>
    </div>`).join('') || `<div style="color:#94A3B8;font-size:13px">None</div>`;

  const section = (title, body) => `<div style="margin-top:22px">
    <div style="font-size:13px;font-weight:700;color:${NAVY};margin-bottom:6px">${escapeHtml(title)}</div>${body}</div>`;

  const listOr = (items, empty) => items.length
    ? `<ul style="margin:4px 0;padding-left:18px;color:#334155;font-size:13px">${items.map(i => `<li style="margin:3px 0">${i}</li>`).join('')}</ul>`
    : `<div style="color:#94A3B8;font-size:13px">${escapeHtml(empty)}</div>`;

  const reviewText = {
    critical_anomaly: (i) => `Critical anomaly on <code>${escapeHtml(i.scope)}</code> — ${escapeHtml(i.detail)}`,
    expectation_missed: (i) => `${escapeHtml(i.detail)} missed ${i.metrics.map(m => `${escapeHtml(m.metric)} (${m.actual} vs ${m.target})`).join(', ')}`,
    undocumented_bot: (i) => `${escapeHtml(i.detail)} traded ${i.trades}× with no strategy declared — nothing to judge it against`,
    fee_drag: (i) => `Fees are ${i.feeShare}% of gross profit (${fUSD(i.fees)} of ${fUSD(i.gross)})`,
  };

  const html = `<div style="background:#F8F7F4;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
      <img src="https://cc.lno.company/logo.svg" alt="LNO Control Center" width="100" style="height:auto;display:block;margin:0 0 8px"/>
      <div style="font-size:18px;font-weight:700;color:${NAVY}">Weekly Review — ${escapeHtml(rv.weekLabel)}</div>

      <div style="margin-top:18px;padding:20px;background:#F8F7F4;border-radius:10px;text-align:center">
        <div style="font-size:12px;color:#64748B;text-transform:uppercase;letter-spacing:.04em">Net PnL</div>
        <div style="font-size:30px;font-weight:800;color:${colorOf(p.netPnl)};font-family:monospace;margin-top:2px">${fSigned(p.netPnl)}</div>
        <div style="font-size:12px;color:#64748B;margin-top:4px">${escapeHtml(vsPrev + vsAvg)}</div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-top:14px">
        ${stat('Trades', `${p.trades} (${p.prevTrades} last week)`)}
        ${stat('Win rate', p.winRate == null ? '—' : `${p.winRate}%`)}
        ${stat('Profit factor', p.profitFactor == null ? 'n/a' : p.profitFactor)}
        ${stat('Expectancy / trade', fSigned(p.expectancy || 0), colorOf(p.expectancy || 0))}
        ${stat('Max drawdown', fSigned(p.maxDrawdown), '#DC2626')}
        ${stat('Fees / funding', `${fUSD(p.fees)} / ${fSigned(p.funding)}`)}
      </table>

      ${section('Top contributors', botRows(rv.contributors, 1))}
      ${section('Biggest detractors', botRows(rv.detractors, -1))}
      ${section('Significant losses', listOr(rv.significantLosses.map(t =>
        `<code>${escapeHtml(t.symbol)}</code> ${escapeHtml(t.direction)} <b style="color:#DC2626">${fSigned(t.netPnl)}</b>`), 'None this week'))}
      ${section(`Anomalies detected (${rv.anomalies.length})`, listOr(rv.anomalies.slice(0, 8).map(a =>
        `<b style="color:${a.severity === 'critical' ? '#DC2626' : '#B45309'}">[${escapeHtml(a.severity)}]</b> ${escapeHtml(a.summary)}${a.resolved ? ' <i style="color:#94A3B8">(resolved)</i>' : ''}`), 'None'))}
      ${section(`Technical incidents (${rv.incidents.length})`, listOr(rv.incidents.slice(0, 8).map(i =>
        `${escapeHtml(i.summary)}${i.resolved ? ' <i style="color:#94A3B8">(resolved)</i>' : ' <b style="color:#DC2626">(ongoing)</b>'}`), 'None'))}

      <div style="margin-top:22px;padding:14px;border:1px solid #E7EAF0;border-radius:10px">
        <div style="font-size:13px;font-weight:700;color:${NAVY};margin-bottom:6px">Needs human review</div>
        ${listOr(rv.review.map(i => (reviewText[i.kind] || (() => escapeHtml(i.kind)))(i)), 'Nothing flagged this week.')}
        <div style="margin-top:8px;font-size:11px;color:#94A3B8">Observations only — no action is inferred from these numbers.</div>
      </div>

      <a href="https://cc.lno.company/#/analysis" style="display:inline-block;margin-top:18px;color:${GOLD};font-weight:600;font-size:13px">Open the analysis →</a>
      <div style="margin-top:20px;font-size:11px;color:#94A3B8">LNO Trading Systems — internal use only</div>
    </div>
  </div>`;

  return html;
}
export async function sendWeeklyReportEmail(to, rv) {
  const from = process.env.RESEND_FROM || 'LNO Control Center <noreply@wearelno.com>';
  const p = rv.portfolio;
  await client().emails.send({ from, to, subject: `Weekly review — ${fSigned(p.netPnl)} (${rv.weekLabel})`, html: weeklyReportHtml(rv) });
}

// "X mentioned you" — the notification that makes @handles worth writing. Deliberately short:
// its whole job is to carry the excerpt and a link straight to the comment in its context,
// not to reproduce the discussion in an inbox.
export async function sendMentionEmail(to, { authorName, excerpt, link, entityLabel }) {
  const from = process.env.RESEND_FROM || 'LNO Control Center <noreply@wearelno.com>';
  const html = alertEmailHtml(
    `${escapeHtml(authorName || 'Someone')} mentioned you`,
    `<div style="color:#64748B;font-size:12px;margin-bottom:6px">${escapeHtml(entityLabel || '')}</div>
     <blockquote style="margin:0;padding:10px 14px;background:#F8F7F4;border-left:3px solid ${GOLD};border-radius:0 8px 8px 0;color:#334155;font-size:13.5px;white-space:pre-wrap">${escapeHtml(excerpt || '')}</blockquote>
     <a href="${link}" style="display:inline-block;margin-top:12px;color:${GOLD};font-weight:600;font-size:13px">Open the comment →</a>`
  );
  await client().emails.send({ from, to, subject: `${authorName || 'Someone'} mentioned you in LNO Control Center`, html });
}

// Monthly report body. The monthly is the only shareholder-facing kind, and until now it
// existed as a PDF only — so there was nothing to preview and nothing to read without
// downloading a file. Same visual language and same helpers as the daily and weekly bodies,
// so all three previews look like one family.
// Everything above the review in the monthly is the account as it stands today. This is the
// MONTH: realised performance per fund and per bot, the shape of it day by day, execution
// quality with its own coverage, and what went wrong while it ran.
function monthlyReviewHtml(rv) {
  if (!rv) return '';
  const p = rv.portfolio;
  const colorOf = (n) => (n >= 0 ? '#059669' : '#DC2626');
  const sec = (title, body) => `<div style="margin-top:22px">
    <div style="font-size:13px;font-weight:700;color:${NAVY};margin-bottom:6px">${escapeHtml(title)}</div>${body}</div>`;
  const row2 = (label, value, sub, color) => `<tr>
    <td style="padding:5px 0;color:#64748B;font-size:13px">${escapeHtml(label)}</td>
    <td style="padding:5px 0;text-align:right;font-family:monospace;font-weight:600;color:${color || NAVY};font-size:13px">${escapeHtml(String(value))}</td>
    <td style="padding:5px 0 5px 12px;text-align:right;color:#94A3B8;font-size:11.5px">${escapeHtml(sub || '')}</td></tr>`;
  const bar = (rows, nameKey) => rows.length ? rows.map(r => {
    const max = Math.max(...rows.map(x => Math.abs(x.netPnl)), 1);
    const pct = Math.max(2, Math.round((Math.abs(r.netPnl) / max) * 100));
    const c = colorOf(r.netPnl);
    return `<div style="margin:9px 0">
      <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px">
        <span style="color:#334155;font-weight:500">${escapeHtml(r[nameKey])}</span>
        <span style="font-family:monospace;color:${c};font-weight:600">${fSigned(r.netPnl)}
          <span style="color:#94A3B8;font-weight:400">(${r.trades} · win ${r.winRate ?? '-'}%)</span></span>
      </div>
      <div style="height:6px;background:#F1F3F6;border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${c};border-radius:3px"></div></div>
    </div>`;
  }).join('') : '<div style="color:#94A3B8;font-size:13px">None</div>';
  const list = (items, empty) => items.length
    ? `<ul style="margin:4px 0;padding-left:18px;color:#334155;font-size:13px">${items.map(i => `<li style="margin:3px 0">${i}</li>`).join('')}</ul>`
    : `<div style="color:#94A3B8;font-size:13px">${escapeHtml(empty)}</div>`;

  return `
  <div style="margin-top:26px;padding-top:18px;border-top:2px solid #E7EAF0">
    <div style="font-size:15px;font-weight:700;color:${NAVY}">Month in review</div>
    <div style="font-size:12px;color:#64748B;margin-top:2px">${escapeHtml(rv.monthLabel)}</div>
    <table style="width:100%;border-collapse:collapse;margin-top:12px">
      ${row2('Realised net PnL', fSigned(p.netPnl),
        p.vsPrevPct == null ? 'no comparable previous month' : `${p.vsPrevPct >= 0 ? '+' : ''}${p.vsPrevPct}% vs last month`,
        colorOf(p.netPnl))}
      ${row2('Trades closed', p.trades, `${rv.daysTraded} days traded, ${rv.greenDays} positive`)}
      ${row2('Win rate', p.winRate == null ? '—' : p.winRate + '%', p.profitFactor == null ? '' : `PF ${p.profitFactor}`)}
      ${row2('Expectancy / trade', fSigned(p.expectancy || 0), '', colorOf(p.expectancy || 0))}
      ${row2('Max drawdown', fSigned(p.maxDrawdown), `best ${fSigned(p.bestTrade || 0)} · worst ${fSigned(p.worstTrade || 0)}`, '#DC2626')}
      ${row2('Costs', fUSD(p.fees) + ' fees', `funding ${fSigned(p.funding)}`)}
      ${rv.bestDay ? row2('Best / worst day', `${rv.bestDay.day} ${fSigned(rv.bestDay.pnl)}`,
        rv.worstDay ? `${rv.worstDay.day} ${fSigned(rv.worstDay.pnl)}` : '') : ''}
    </table>
    ${sec('By fund', bar(rv.funds, 'name'))}
    ${sec('By bot', bar(rv.bots.slice(0, 12), 'symbol'))}
    ${(rv.execution.slippage != null || rv.execution.avgRMultiple != null) ? sec('Execution quality', list([
        rv.execution.slippage != null ? `Slippage cost <b>${fSigned(-rv.execution.slippage)}</b> <i style="color:#94A3B8">(measured on ${rv.execution.slippageCoverage}% of trades)</i>` : null,
        rv.execution.avgRMultiple != null ? `Average R-multiple <b>${rv.execution.avgRMultiple}</b> <i style="color:#94A3B8">(measured on ${rv.execution.rCoverage}% of trades)</i>` : null,
      ].filter(Boolean), '')) : ''}
    ${sec(`Technical incidents (${rv.incidents.length})`, list(rv.incidents.slice(0, 8).map(i =>
      `${escapeHtml(i.summary)}${i.resolved ? ' <i style="color:#94A3B8">(resolved)</i>' : ' <b style="color:#DC2626">(ongoing)</b>'}`), 'None this month'))}
    ${sec(`Anomalies detected (${rv.anomalies.length})`, list(rv.anomalies.slice(0, 8).map(a =>
      `<b style="color:${a.severity === 'critical' ? '#DC2626' : '#B45309'}">[${escapeHtml(a.severity)}]</b> ${escapeHtml(a.summary)}${a.resolved ? ' <i style="color:#94A3B8">(resolved)</i>' : ''}`), 'None this month'))}
  </div>`;
}

export function monthlyReportHtml(d) {
  const up = (d.pnl30 || 0) >= 0;
  const colorOf = (n) => (n >= 0 ? '#059669' : '#DC2626');
  const stat = (label, value, color) => `<tr>
    <td style="padding:6px 0;color:#64748B;font-size:13px">${escapeHtml(label)}</td>
    <td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:600;color:${color || NAVY};font-size:13px">${escapeHtml(String(value))}</td></tr>`;
  return `<div style="background:#F8F7F4;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
      <img src="https://cc.lno.company/logo.svg" alt="LNO Control Center" width="100" style="height:auto;display:block;margin:0 0 8px"/>
      <div style="font-size:18px;font-weight:700;color:${NAVY}">Monthly Report — ${escapeHtml(d.dateLabel || '')}</div>
      <div style="margin-top:18px;padding:20px;background:#F8F7F4;border-radius:10px;text-align:center">
        <div style="font-size:12px;color:#64748B;text-transform:uppercase;letter-spacing:.04em">PnL — 30 days</div>
        <div style="font-size:30px;font-weight:800;color:${colorOf(d.pnl30 || 0)};font-family:monospace;margin-top:2px">${fSigned(d.pnl30 || 0)}</div>
      </div>
      ${sparklineSvg(d.series, up)}
      <table style="width:100%;border-collapse:collapse;margin-top:14px">
        ${stat('Account equity', fUSD(d.equity || 0))}
        ${stat('Open PnL', fSigned(d.openPnl || 0), colorOf(d.openPnl || 0))}
        ${stat('Exposure (notional)', fUSD(d.exposure || 0))}
        ${stat('Max drawdown', `${(d.maxDrawdownPct || 0).toFixed(1)}% over ${d.ddDurationDays || 0} days`, '#DC2626')}
        ${stat('Sharpe / Sortino', `${(d.sharpe || 0).toFixed(2)} / ${(d.sortino || 0).toFixed(2)}`)}
      </table>
      <div style="margin-top:22px">
        <div style="font-size:13px;font-weight:700;color:${NAVY};margin-bottom:6px">By bot</div>
        ${botBarsHtml(d.positions)}
      </div>
      <div style="margin-top:22px">
        <div style="font-size:13px;font-weight:700;color:${NAVY};margin-bottom:6px">Funds</div>
        ${fundBarsHtml(d.funds)}
      </div>
      ${monthlyReviewHtml(d.review)}
      <div style="margin-top:20px;font-size:11px;color:#94A3B8">LNO Trading Systems — internal use only</div>
    </div>
  </div>`;
}
