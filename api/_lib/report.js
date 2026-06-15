// Monthly report PDF (pdf-lib, pure JS — serverless-safe). Returns base64.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const fUSD = (n) => '$' + Math.round(n).toLocaleString('en-US');
const fmt  = (n) => (n >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');

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
  row('Total equity', fUSD(d.equity));
  row('PnL — 30 days', fmt(d.pnl30), d.pnl30 >= 0 ? green : red);
  row('Max drawdown', `${d.maxDrawdownPct.toFixed(1)}%  (${d.ddDurationDays} days)`, red);
  row('Sharpe / Sortino', `${d.sharpe.toFixed(2)}  /  ${d.sortino.toFixed(2)}`);
  row('Best bot', `${d.best.name}   ${fmt(d.best.pnl)}`, green);
  row('Worst bot', `${d.worst.name}   ${fmt(d.worst.pnl)}`, red);

  y -= 32; at('Exposure by exchange', 40, 13, bold, navy);
  Object.entries(d.byExchange || {}).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => { y -= 20; at(k, 40, 11, font, slate); at(fUSD(v), 300, 11, font, navy); });

  page.drawText('LNO Trading Systems — Internal Use Only', { x: 40, y: 40, size: 9, font, color: slate });
  return Buffer.from(await doc.save()).toString('base64');
}
