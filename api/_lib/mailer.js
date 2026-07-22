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
