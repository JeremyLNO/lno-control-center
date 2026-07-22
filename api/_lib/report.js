// Report PDF (pdf-lib, pure JS — serverless-safe). Returns base64. Shared builder for the
// daily/weekly/monthly reports — same vector-drawn equity line + fund bar chart in all three,
// matching the look already used for the WhatsApp/email digests and the Activity Dashboard.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const grp  = (n) => Math.round(Math.abs(n)).toLocaleString('en-US').replace(/,/g, ' ');
const fUSD = (n) => grp(n) + ' USDT';
const fmt  = (n) => (n >= 0 ? '+' : '-') + grp(n) + ' USDT';

// Equity line chart drawn as vector primitives (no embedded image, no new dependency) — pdf-lib's
// coordinate origin is bottom-left with y growing upward, same convention the rest of this file
// already uses for its own `y` cursor, so no axis flip is needed. `yTop` is the chart's top edge;
// it occupies the `height` below that. Returns the y just below the chart, for the next element.
function drawEquityChart(page, { x, yTop, width, height, series, gold, gridColor }) {
  if (!series || series.length < 2) return yTop - height;
  const min = Math.min(...series), max = Math.max(...series);
  const range = (max - min) || Math.max(1, Math.abs(min) * 0.01) || 1;
  const n = series.length;
  const px = (i) => x + (i / (n - 1)) * width;
  const py = (v) => (yTop - height) + ((v - min) / range) * (height - 8) + 4; // 4px padding top/bottom
  [0.25, 0.5, 0.75].forEach((f) => {
    const gy = (yTop - height) + height * f;
    page.drawLine({ start: { x, y: gy }, end: { x: x + width, y: gy }, thickness: 0.5, color: gridColor });
  });
  for (let i = 1; i < n; i++) {
    page.drawLine({ start: { x: px(i - 1), y: py(series[i - 1]) }, end: { x: px(i), y: py(series[i]) }, thickness: 1.7, color: gold });
  }
  page.drawCircle({ x: px(n - 1), y: py(series[n - 1]), size: 2.5, color: gold });
  return yTop - height;
}

// Horizontal fund bars — width proportional to each fund's notional, coloured by its PnL sign.
// Returns the y position after the last row, for whatever's drawn next.
function drawFundBars(page, { x, yTop, width, funds, font, slate, green, red, rowH = 18 }) {
  const rows = (funds || []).filter((f) => (f.bots || []).length || f.uPnl || f.notional);
  if (!rows.length) { page.drawText('No open positions', { x, y: yTop - 12, size: 10, font, color: slate }); return yTop - rowH; }
  const maxAbs = Math.max(...rows.map((f) => Math.abs(f.notional || 0)), 1);
  const labelW = 90, barX = x + labelW, barW = width - labelW - 90;
  let y = yTop;
  rows.forEach((f) => {
    const w = Math.max(2, (Math.abs(f.notional || 0) / maxAbs) * barW);
    const color = (f.uPnl || 0) >= 0 ? green : red;
    page.drawText(f.name.length > 13 ? f.name.slice(0, 12) + '…' : f.name, { x, y: y - 9, size: 9, font, color: slate });
    page.drawRectangle({ x: barX, y: y - 11, width: barW, height: 5, color: rgb(0.93, 0.94, 0.95) });
    page.drawRectangle({ x: barX, y: y - 11, width: w, height: 5, color, opacity: 0.55 });
    page.drawText(fmt(f.uPnl || 0), { x: barX + barW + 8, y: y - 9, size: 9, font, color });
    y -= rowH;
  });
  return y;
}

// Horizontal BOT bars — one row per individual open position (not merged by fund), width
// proportional to notional, coloured by its own PnL sign. Same visual language as
// drawFundBars, one level more granular — this is now the primary breakdown; drawFundBars
// is the supplementary roll-up drawn further down the page.
function drawBotBars(page, { x, yTop, width, positions, font, slate, green, red, rowH = 15 }) {
  const rows = positions || [];
  if (!rows.length) { page.drawText('No open positions', { x, y: yTop - 12, size: 10, font, color: slate }); return yTop - rowH; }
  const maxAbs = Math.max(...rows.map((p) => Math.abs(p.notional || 0)), 1);
  const labelW = 90, barX = x + labelW, barW = width - labelW - 90;
  let y = yTop;
  rows.slice(0, 12).forEach((p) => {
    const w = Math.max(2, (Math.abs(p.notional || 0) / maxAbs) * barW);
    const color = (p.unrealizedPnl || 0) >= 0 ? green : red;
    page.drawText(p.symbol, { x, y: y - 9, size: 9, font, color: slate });
    page.drawRectangle({ x: barX, y: y - 11, width: barW, height: 5, color: rgb(0.93, 0.94, 0.95) });
    page.drawRectangle({ x: barX, y: y - 11, width: w, height: 5, color, opacity: 0.55 });
    page.drawText(fmt(p.unrealizedPnl || 0), { x: barX + barW + 8, y: y - 9, size: 9, font, color });
    y -= rowH;
  });
  return y;
}

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

  y -= 30; at('Equity — 30 days', 40, 11, bold, navy);
  y -= 10; y = drawEquityChart(page, { x: 40, yTop: y, width: 515, height: 85, series: d.series, gold, gridColor: rgb(0.91, 0.91, 0.93) });

  y -= 26; at('By Bot', 40, 13, bold, navy);
  y -= 6; y = drawBotBars(page, { x: 40, yTop: y, width: 515, positions: d.positions, font, slate, green, red });

  y -= 18; at('Funds', 40, 13, bold, navy);
  y -= 6; y = drawFundBars(page, { x: 40, yTop: y, width: 515, funds: d.funds, font, slate, green, red });

  page.drawText('LNO Trading Systems — Internal Use Only', { x: 40, y: 40, size: 9, font, color: slate });
  return Buffer.from(await doc.save()).toString('base64');
}

// d: { equity, pnl7, openPnl, exposure, funds, positions, dateLabel, series }
export async function buildWeeklyPdf(d) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.043, 0.121, 0.227), gold = rgb(0.788, 0.635, 0.302),
        slate = rgb(0.42, 0.47, 0.52), red = rgb(0.937, 0.267, 0.267), green = rgb(0.063, 0.725, 0.506);
  let y = 800;
  const at = (s, x, size, f, color) => page.drawText(String(s), { x, y, size, font: f || font, color: color || navy });

  at('LNO', 40, 28, bold, gold); at('Weekly Report', 96, 22, bold, navy);
  y -= 18; at(d.dateLabel || '', 40, 11, font, slate);
  y -= 22; page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 1, color: rgb(0.9, 0.9, 0.92) });

  const row = (label, val, color) => { y -= 26; at(label, 40, 12, font, slate); at(val, 300, 14, bold, color || navy); };
  y -= 12;
  row('Account equity', fUSD(d.equity));
  row('PnL — 7 days', fmt(d.pnl7), d.pnl7 >= 0 ? green : red);
  row('Open PnL', fmt(d.openPnl || 0), (d.openPnl || 0) >= 0 ? green : red);
  row('Exposure (notional)', fUSD(d.exposure || 0));

  y -= 30; at('Equity — 7 days', 40, 11, bold, navy);
  y -= 10; y = drawEquityChart(page, { x: 40, yTop: y, width: 515, height: 85, series: d.series, gold, gridColor: rgb(0.91, 0.91, 0.93) });

  y -= 26; at('By Bot', 40, 13, bold, navy);
  y -= 6; y = drawBotBars(page, { x: 40, yTop: y, width: 515, positions: d.positions, font, slate, green, red });

  y -= 18; at('Funds', 40, 13, bold, navy);
  y -= 6; y = drawFundBars(page, { x: 40, yTop: y, width: 515, funds: d.funds, font, slate, green, red });

  page.drawText('LNO Trading Systems — Internal Use Only', { x: 40, y: 40, size: 9, font, color: slate });
  return Buffer.from(await doc.save()).toString('base64');
}

// d: { equity, pnlDay, pctDay, openPnl, exposure, funds, positions, incidentCount, dateLabel, series }
export async function buildDailyPdf(d) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.043, 0.121, 0.227), gold = rgb(0.788, 0.635, 0.302),
        slate = rgb(0.42, 0.47, 0.52), red = rgb(0.937, 0.267, 0.267), green = rgb(0.063, 0.725, 0.506);
  let y = 800;
  const at = (s, x, size, f, color) => page.drawText(String(s), { x, y, size, font: f || font, color: color || navy });

  at('LNO', 40, 28, bold, gold); at('Daily Report', 96, 22, bold, navy);
  y -= 18; at(d.dateLabel || '', 40, 11, font, slate);
  y -= 22; page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 1, color: rgb(0.9, 0.9, 0.92) });

  const row = (label, val, color) => { y -= 26; at(label, 40, 12, font, slate); at(val, 300, 14, bold, color || navy); };
  y -= 12;
  row('Account equity', fUSD(d.equity));
  row('PnL — 24h', fmt(d.pnlDay), d.pnlDay >= 0 ? green : red);
  row('Open PnL', fmt(d.openPnl || 0), (d.openPnl || 0) >= 0 ? green : red);
  row('Exposure (notional)', fUSD(d.exposure || 0));
  if (d.incidentCount) row('Incidents (24h)', String(d.incidentCount), red);

  y -= 30; at('Equity — recent', 40, 11, bold, navy);
  y -= 10; y = drawEquityChart(page, { x: 40, yTop: y, width: 515, height: 75, series: d.series, gold, gridColor: rgb(0.91, 0.91, 0.93) });

  y -= 24; at('By Bot', 40, 13, bold, navy);
  y -= 6; y = drawBotBars(page, { x: 40, yTop: y, width: 515, positions: d.positions, font, slate, green, red, rowH: 15 });

  y -= 18; at('Funds', 40, 13, bold, navy);
  y -= 6; y = drawFundBars(page, { x: 40, yTop: y, width: 515, funds: d.funds, font, slate, green, red, rowH: 15 });

  page.drawText('LNO Trading Systems — Internal Use Only', { x: 40, y: 40, size: 9, font, color: slate });
  return Buffer.from(await doc.save()).toString('base64');
}
