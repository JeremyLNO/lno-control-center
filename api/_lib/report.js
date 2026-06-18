// Monthly report PDF (pdf-lib, pure JS — serverless-safe). Returns base64.
// Built from the real portfolio: account equity, 30d PnL, risk metrics, then funds.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const grp  = (n) => Math.round(Math.abs(n)).toLocaleString('en-US').replace(/,/g, ' ');
const fUSD = (n) => grp(n) + ' USDT';
const fmt  = (n) => (n >= 0 ? '+' : '-') + grp(n) + ' USDT';

export async function buildMonthlyPdf(d) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.043, 0.121, 0.227), gold = rgb(0.788, 0.635, 0.302),
        slate = rgb(0.42, 0.47, 0.52), red = rgb(0.937, 0.267, 0.267), green = rgb(0.063, 0.725, 0.506);
  let y = 800;
  const at = (s, x, size, f, color) => page.drawText(String(s), { x, y, size, font: f || font, color: color || navy });

  at('LNO', 40, 28, bold, gold); at('Monthly Report', 96, 22, bold, navy);
  y -= 18; at(d.dateLabel || '', 40, 11, font, slate);
  y -= 22; page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 1, color: rgb(0.9, 0.9, 0.92) });

  const row = (label, val, color) => { y -= 26; at(label, 40, 12, font, slate); at(val, 300, 14, bold, color || navy); };
  y -= 12;
  row('Account equity', fUSD(d.equity));
  row('PnL — 30 days', fmt(d.pnl30), d.pnl30 >= 0 ? green : red);
  row('Open PnL', fmt(d.openPnl || 0), (d.openPnl || 0) >= 0 ? green : red);
  row('Exposure (notional)', fUSD(d.exposure || 0));
  row('Max drawdown', `${(d.maxDrawdownPct || 0).toFixed(1)}%  (${d.ddDurationDays || 0} days)`, red);
  row('Sharpe / Sortino', `${(d.sharpe || 0).toFixed(2)}  /  ${(d.sortino || 0).toFixed(2)}`);

  y -= 32; at('Funds', 40, 13, bold, navy);
  const funds = (d.funds || []).filter(f => (f.bots || []).length || f.uPnl || f.notional);
  if (!funds.length) { y -= 20; at('No open positions', 40, 11, font, slate); }
  funds.forEach(f => {
    const nb = (f.bots || []).length;
    y -= 20; at(`${f.name}  (${nb} bot${nb === 1 ? '' : 's'})`, 40, 11, font, slate);
    at(`${fmt(f.uPnl || 0)} · ${fUSD(f.notional || 0)}`, 300, 11, font, (f.uPnl || 0) >= 0 ? green : red);
  });

  page.drawText('LNO Trading Systems — Internal Use Only', { x: 40, y: 40, size: 9, font, color: slate });
  return Buffer.from(await doc.save()).toString('base64');
}
