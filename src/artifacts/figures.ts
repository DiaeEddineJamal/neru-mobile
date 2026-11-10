// Charts and diagrams inside documents, decks and PDFs. A model writes them in a file's Markdown as ```chart,
// ```mermaid, ```diagram or ```svg blocks, as in chat. They are drawn as SVG on the phone (viz/svg.ts); Word and
// PowerPoint also get a PNG of each, made by a hidden web view (FigureHost), which also draws the Mermaid diagram
// types Neru has no layout for (Gantt, class, ER, mind maps…) when there is a connection.
import { useSyncExternalStore } from 'react';

import { parse, type Block } from '@/components/markdown/parse';
import { parseVisual } from '@/viz/parse';
import { visualSvg } from '@/viz/svg';

export const FIGURE_LANGS = new Set(['chart', 'mermaid', 'diagram', 'svg']);
export type Figure = { svg: string; width: number; height: number; alt: string; png?: Uint8Array };

export const figureKey = (lang: string, source: string) => `${lang.toLowerCase()}\n${source.trim()}`;
export const isFigure = (b: Block): b is Extract<Block, { t: 'code' }> => b.t === 'code' && FIGURE_LANGS.has(b.lang.toLowerCase()) && !!b.text.trim();

/** An SVG the model wrote, without anything that could run or reach out, and with a size. */
function cleanSvg(source: string): Figure | null {
  const m = /<svg[\s\S]*<\/svg>/i.exec(source);
  if (!m) return null;
  let svg = m[0]
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href\s*=\s*["'])\s*(?:javascript|https?):[^"']*/gi, '$1#');
  const open = /<svg\b[^>]*>/i.exec(svg)![0];
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*["']?([\\d.]+)`, 'i').exec(open)?.[1];
  const box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(open);
  const width = Math.round(Number(attr('width') ?? box?.[1] ?? 400)) || 400;
  const height = Math.round(Number(attr('height') ?? box?.[2] ?? 300)) || 300;
  let head = open.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  head = head.replace(/<svg\b/i, `<svg width="${width}" height="${height}"${/xmlns=/.test(head) ? '' : ' xmlns="http://www.w3.org/2000/svg"'}${box ? '' : ` viewBox="0 0 ${width} ${height}"`}`);
  svg = svg.replace(open, head);
  return { svg, width, height, alt: /<title>([^<]{1,120})<\/title>/i.exec(svg)?.[1] ?? 'Image' };
}

/** A figure drawn right away on the phone, or null when it needs the web view (or cannot be drawn). */
export function figureNow(lang: string, source: string): Figure | null {
  const l = lang.toLowerCase();
  if (l === 'svg') return cleanSvg(source);
  const parsed = parseVisual(l, source);
  if (!parsed.ok) return null;
  const img = visualSvg(parsed.spec);
  const kind = parsed.spec.kind === 'chart' ? 'Chart' : 'Diagram';
  return { ...img, alt: parsed.spec.title ? `${kind}: ${parsed.spec.title}` : kind };
}

// ---- the hidden web view's job queue (FigureHost renders it) ----

type Job = { id: number; svg?: string; mermaid?: string; png: boolean; resolve: (f: Figure | null) => void };
let nextId = 1;
const jobs = new Map<number, Job>();
const listeners = new Set<() => void>();
let pending = 0;
const notify = () => listeners.forEach(l => l());

/** How many drawings are waiting: FigureHost mounts its web view only while there are some. */
export const useFigureJobs = () => useSyncExternalStore(l => (listeners.add(l), () => void listeners.delete(l)), () => pending);
export const takeJobs = () => [...jobs.values()];

export function finishJob(id: number, result: { svg?: string; width?: number; height?: number; png?: string; error?: string }) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  pending = jobs.size;
  notify();
  if (result.error || !result.svg) return job.resolve(null);
  job.resolve({ svg: result.svg, width: result.width ?? 600, height: result.height ?? 400, alt: 'Diagram', png: result.png ? base64Bytes(result.png) : undefined });
}

function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function enqueue(job: Omit<Job, 'id' | 'resolve'>): Promise<Figure | null> {
  return new Promise(resolve => {
    const id = nextId++;
    // A drawing that never comes back (no web view, a stuck renderer) must not hold up the export.
    const timer = setTimeout(() => finishJob(id, { error: 'timeout' }), job.mermaid ? 25_000 : 12_000);
    jobs.set(id, { ...job, id, resolve: f => (clearTimeout(timer), resolve(f)) });
    pending = jobs.size;
    notify();
  });
}

/** The figure, drawn wherever it can be, with a PNG when `png` (Word and PowerPoint need one). */
export async function renderFigure(lang: string, source: string, png: boolean): Promise<Figure | null> {
  const now = figureNow(lang, source);
  if (now && !png) return now;
  if (now) {
    const raster = await enqueue({ svg: now.svg, png: true });
    return { ...now, png: raster?.png };
  }
  if (lang.toLowerCase() !== 'mermaid') return null;
  const drawn = await enqueue({ mermaid: source, png });
  return drawn ? { ...drawn, alt: 'Diagram' } : null;
}

/** Every figure in a Markdown text (slides included), keyed by figureKey. */
export async function renderFigures(content: string, png: boolean): Promise<Map<string, Figure>> {
  const blocks = parse(content.replace(/\n[ \t]*(?:-{3,}|\*{3,})[ \t]*(?=\n|$)/g, '\n\n'));
  const wanted = new Map<string, Extract<Block, { t: 'code' }>>();
  for (const b of blocks) if (isFigure(b)) wanted.set(figureKey(b.lang, b.text), b);
  const out = new Map<string, Figure>();
  await Promise.all([...wanted].map(async ([key, b]) => {
    const f = await renderFigure(b.lang, b.text, png);
    if (f) out.set(key, f);
  }));
  return out;
}

/** Whether a text holds a figure only the web view can draw (an uncommon Mermaid type). */
export function needsHost(content: string): boolean {
  return parse(content).some(b => isFigure(b) && b.lang.toLowerCase() === 'mermaid' && !figureNow(b.lang, b.text));
}
