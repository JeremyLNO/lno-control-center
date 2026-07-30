// Report PDF (pdf-lib, pure JS — serverless-safe). Returns base64. Shared builder for the
// daily/weekly/monthly reports — same vector-drawn equity line + fund bar chart in all three,
// matching the look already used for the WhatsApp/email digests and the Activity Dashboard.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const grp  = (n) => Math.round(Math.abs(n)).toLocaleString('en-US').replace(/,/g, ' ');
const fUSD = (n) => grp(n) + ' USDT';
const fmt  = (n) => (n >= 0 ? '+' : '-') + grp(n) + ' USDT';
// pdf-lib's standard fonts are WinAnsi-encoded and THROW on anything outside it — an arrow,
// a curly quote, an emoji in a bot name. Any string that came from the database or from an
// operator passes through here first: a plain hyphen beats a report that fails to generate.
// WinAnsi is a superset of Latin-1, so accented characters are KEPT: a French strategy name
// must not lose its accents on the way into a PDF. Only the few typographic characters
// outside the encoding are transliterated; anything still unencodable is dropped.
const ascii = (s) => String(s == null ? '' : s)
  .replace(/\u2192/g, '->').replace(/\u2190/g, '<-')
  .replace(/[\u2012-\u2015\u2212]/g, '-')
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
  // \x20-\x7E is ASCII, \xA0-\xFF the Latin-1 range WinAnsi shares; the CP1252 extras this
  // file actually emits (en/em dash, ellipsis) are listed explicitly.
  .replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2014\u2026]/g, '');

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
  y -= 18; at(ascii(d.dateLabel), 40, 11, font, slate);
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

// Human-readable line for one "needs a decision" item. The review section is the part of the
// weekly report a person actually acts on, so each line states the observation and its
// numbers — never a recommendation, since nothing here knows the desk's intent.
function reviewLine(item) {
  switch (item.kind) {
    case 'critical_anomaly':
      return `Critical anomaly on ${item.scope}: ${item.detail}`;
    case 'expectation_missed':
      return `${item.detail} missed ${item.metrics.map(m => `${m.metric} (${m.actual} vs ${m.target})`).join(', ')}`;
    case 'undocumented_bot':
      return `${item.detail} traded ${item.trades}x with no strategy declared — no expected KPI to judge it against`;
    case 'fee_drag':
      return `Fees are ${item.feeShare}% of gross profit (${fUSD(item.fees)} of ${fUSD(item.gross)})`;
    default:
      return item.detail || item.kind;
  }
}

// d: { equity, pnl7, openPnl, exposure, funds, positions, dateLabel, series, review? }
// `review` is the structured weekly analysis from api/_lib/weeklyReport.js. Optional: without
// it this still renders the same one-page snapshot it always did.
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
  y -= 18; at(ascii(d.dateLabel), 40, 11, font, slate);
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

  // ------------------------------------------------------------------------------------
  // Weekly review. Everything above is a snapshot of the account right now; this is the
  // analysis of the week that just ended, which is what the report exists for.
  // ------------------------------------------------------------------------------------
  const rv = d.review;
  if (rv) {
    let pg = page;
    // pdf-lib has no flow layout: text drawn below y=60 lands in the footer or off-page, so
    // each section checks for room and starts a new sheet when it runs out.
    const ensure = (need) => {
      if (y - need > 60) return;
      pg = doc.addPage([595, 842]);
      pg.drawText('LNO Trading Systems — Internal Use Only', { x: 40, y: 40, size: 9, font, color: slate });
      y = 800;
    };
    const put = (s, x, size, f, color) => pg.drawText(String(s), { x, y, size, font: f || font, color: color || navy });
    // Reserve the heading AND room for a few of its lines: a section title stranded at the
    // bottom of a page with its content overleaf is worse than a slightly emptier page.
    const heading = (label) => { ensure(80); y -= 24; put(label, 40, 13, bold, navy); y -= 4;
      pg.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.5, color: rgb(0.9, 0.9, 0.92) }); };
    const safe = ascii;
    const line = (s, indent = 40, size = 9.5, color = slate) => { ensure(16); y -= 13; put(safe(s).slice(0, 110), indent, size, font, color); };

    const p = rv.portfolio;
    heading('Week in review — ' + safe(rv.weekLabel));
    y -= 6;
    const cmp = (label, val, sub) => { ensure(20); y -= 17;
      put(label, 40, 10, font, slate);
      put(val, 260, 11, bold, typeof val === 'string' && val.startsWith('-') ? red : navy);
      if (sub) put(sub, 380, 9.5, font, slate); };
    cmp('Net PnL', fmt(p.netPnl), p.vsPrevPct == null ? 'no comparable previous week'
      : `${p.vsPrevPct >= 0 ? '+' : ''}${p.vsPrevPct}% vs last week (${fmt(p.prevNetPnl)})`);
    cmp('vs 4-week average', fmt(p.avgWeeklyNetPnl), p.vsAvgPct == null ? '-' : `${p.vsAvgPct >= 0 ? '+' : ''}${p.vsAvgPct}%`);
    cmp('Trades', String(p.trades), `${p.prevTrades} last week - ${p.tradesPerDay ?? 0}/day`);
    cmp('Win rate', p.winRate == null ? '-' : p.winRate + '%', p.prevWinRate == null ? '-' : `${p.prevWinRate}% last week`);
    cmp('Profit factor', p.profitFactor == null ? 'n/a' : String(p.profitFactor), `expectancy ${fmt(p.expectancy || 0)}`);
    cmp('Max drawdown', fmt(p.maxDrawdown), `fees ${fUSD(p.fees)} - funding ${fmt(p.funding)}`);

    if (rv.contributors.length || rv.detractors.length) {
      heading('PnL contributors');
      for (const b of rv.contributors) line(`+ ${b.symbol}  ${fmt(b.netPnl)}  (${b.trades} trades, win ${b.winRate ?? '-'}%)`, 40, 9.5, green);
      for (const b of rv.detractors) line(`- ${b.symbol}  ${fmt(b.netPnl)}  (${b.trades} trades, win ${b.winRate ?? '-'}%)`, 40, 9.5, red);
    }
    if (rv.significantLosses.length) {
      heading('Significant losses');
      // closed_at arrives as a Date from the pg driver but as an ISO string from JSON, and
      // String(aDate) gives "Wed Jul 29 2026 16:00:00 GMT+0200 (…)" — normalise both to the
      // same ISO minute the rest of the report uses.
      const at16 = (v) => new Date(v).toISOString().slice(0, 16).replace('T', ' ');
      for (const t of rv.significantLosses) line(`${t.symbol} ${t.direction}  ${fmt(t.netPnl)}  closed ${at16(t.closedAt)}`, 40, 9.5, red);
    }
    if (rv.anomalies.length) {
      heading(`Anomalies detected (${rv.anomalies.length})`);
      for (const a of rv.anomalies.slice(0, 10)) line(`[${a.severity}] ${a.summary}${a.resolved ? ' (resolved)' : ''}`, 40, 9.5, a.severity === 'critical' ? red : slate);
    }
    if (rv.incidents.length) {
      heading(`Technical incidents (${rv.incidents.length})`);
      for (const i of rv.incidents.slice(0, 10)) line(`${i.summary}${i.resolved ? ' (resolved)' : ' (ongoing)'}`, 40, 9.5, i.resolved ? slate : red);
    }
    heading('Needs human review');
    if (!rv.review.length) line('Nothing flagged this week.', 40, 9.5, slate);
    else for (const item of rv.review.slice(0, 12)) line('- ' + reviewLine(item), 40, 9.5, navy);
  }

  page.drawText('LNO Trading Systems — Internal Use Only', { x: 40, y: 40, size: 9, font, color: slate });
  return Buffer.from(await doc.save()).toString('base64');
}

// d: { equity, pnlDay, pctDay, openPnl, exposure, funds, positions, incidentCount, dateLabel,
//      series, prevPnl?, prevPct? } — prev* is the same-length window immediately before,
//      null when history is too short for a full comparable one.
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
  y -= 18; at(ascii(d.dateLabel), 40, 11, font, slate);
  y -= 22; page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 1, color: rgb(0.9, 0.9, 0.92) });

  const row = (label, val, color) => { y -= 26; at(label, 40, 12, font, slate); at(val, 300, 14, bold, color || navy); };
  y -= 12;
  row('Account equity', fUSD(d.equity));
  row('PnL — 24h', fmt(d.pnlDay), d.pnlDay >= 0 ? green : red);
  // Same window, one period earlier — tells you whether the number above is an improvement.
  // Omitted entirely when there isn't enough history for a full comparable window.
  if (d.prevPct != null) at(`prev. ${d.prevPct >= 0 ? '+' : ''}${d.prevPct.toFixed(2)}%`, 420, 10, font, slate);
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
