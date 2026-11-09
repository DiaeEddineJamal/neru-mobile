// Series colors: the theme accent first, then muted hues that stay legible on both the near-black and the
// cream backgrounds. A hue too close to the accent is skipped so neighbouring series never look alike.
import type { Colors } from '@/theme';

const DARK = ['#d9a066', '#7fa7d9', '#d48a9e', '#a395d6', '#6fbcae', '#cbb85c', '#c9806b', '#94a3b8'];
const LIGHT = ['#a8692c', '#3e6eab', '#ad4f6c', '#6a5ab0', '#2a8478', '#87741a', '#b0583f', '#5b6b80'];

function hue(hex: string): number {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return -1;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const cache = new Map<string, string[]>();

/** Eight series colors for this theme and mode. */
export function seriesColors(c: Colors, scheme: 'light' | 'dark'): string[] {
  const accent = scheme === 'dark' ? c.sage : c.moss;
  const key = `${accent}/${scheme}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const a = hue(accent);
  const near = (h: number) => a >= 0 && h >= 0 && Math.min(Math.abs(h - a), 360 - Math.abs(h - a)) < 28;
  const rest = (scheme === 'dark' ? DARK : LIGHT).filter(x => !near(hue(x)));
  const out = [accent, ...rest].slice(0, 7);
  out.push(scheme === 'dark' ? c.moss : c.sage);
  cache.set(key, out);
  return out;
}

export const colorAt = (colors: string[], i: number) => colors[i % colors.length];
