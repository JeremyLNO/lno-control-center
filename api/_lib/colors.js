// Map a fund's hex colour to the nearest WhatsApp colour-circle emoji (used in reports).
const CIRCLES = [
  ['🔴', [239, 68, 68]],   ['🟠', [249, 115, 22]], ['🟡', [234, 179, 8]],
  ['🟢', [34, 197, 94]],   ['🔵', [59, 130, 246]], ['🟣', [168, 85, 247]],
  ['🟤', [120, 72, 40]],   ['⚫', [24, 24, 27]],    ['⚪', [244, 244, 245]],
];

export function colorToEmoji(hex) {
  const m = typeof hex === 'string' && hex.replace('#', '').match(/^([0-9a-fA-F]{6})$/);
  if (!m) return '⚪';
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  let best = '⚪', bd = Infinity;
  for (const [e, [cr, cg, cb]] of CIRCLES) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
