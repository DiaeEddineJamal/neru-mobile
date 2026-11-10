// Pages for documents, decks and spreadsheets: what the viewer shows and what is printed to PDF or saved as HTML.
// The deck mirrors the PowerPoint file office.ts builds (same colours, title slide, layout), so the preview, the PDF
// and the .pptx look alike.
import { displayTitle } from '@/artifacts/kinds';
import { plain, sheetsFrom, splitSlides, type Slide } from '@/artifacts/office';
import type { Artifact } from '@/artifacts/parse';
import { parse, type Block } from '@/components/markdown/parse';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inline Markdown (code, bold, italic, strikethrough, links) to HTML. Only http(s) and mailto links are kept. */
export function inlineHtml(text: string): string {
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, c: string) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, url: string) => (/^(https?:|mailto:)/i.test(url) ? `<a href="${url}">${label}</a>` : label))
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a?: string, b?: string) => `<strong>${a ?? b}</strong>`)
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${esc(codes[Number(i)])}</code>`);
}

type Li = Extract<Block, { t: 'li' }>;

function listHtml(items: Li[]): string {
  let out = '';
  const open: string[] = [];
  for (const it of items) {
    const depth = it.level + 1;
    if (open.length > depth) {
      while (open.length > depth) out += `</li></${open.pop()}>`;
      out += '</li>';
    } else if (open.length === depth) out += '</li>';
    else {
      const tag = /\d/.test(it.marker) ? 'ol' : 'ul';
      while (open.length < depth) {
        open.push(tag);
        out += `<${tag}>`;
      }
    }
    out += `<li>${inlineHtml(it.text)}`;
  }
  while (open.length) out += `</li></${open.pop()}>`;
  return out;
}

/** Markdown blocks to HTML. */
export function blocksHtml(blocks: Block[]): string {
  let out = '';
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t === 'li') {
      const items: Li[] = [];
      while (i < blocks.length && blocks[i].t === 'li') items.push(blocks[i++] as Li);
      i--;
      out += listHtml(items);
    } else if (b.t === 'quote') {
      const lines: string[] = [];
      while (i < blocks.length && blocks[i].t === 'quote') lines.push(inlineHtml((blocks[i++] as Extract<Block, { t: 'quote' }>).text));
      i--;
      out += `<blockquote>${lines.join('<br>')}</blockquote>`;
    } else if (b.t === 'h') out += `<h${b.level}>${inlineHtml(b.text)}</h${b.level}>`;
    else if (b.t === 'p') out += `<p>${inlineHtml(b.text)}</p>`;
    else if (b.t === 'hr') out += '<hr>';
    else if (b.t === 'code') out += `<pre><code>${esc(b.text)}</code></pre>`;
    else {
      const cell = (tag: string, text: string, j: number) => `<${tag} style="text-align:${b.align[j] ?? 'left'}">${inlineHtml(text)}</${tag}>`;
      out += `<table><thead><tr>${b.head.map((h, j) => cell('th', h, j)).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map((d, j) => cell('td', d, j)).join('')}</tr>`).join('')}</tbody></table>`;
    }
  }
  return out;
}

export const markdownHtml = (md: string) => blocksHtml(parse(md));

const page = (title: string, css: string, body: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${css}</style></head><body>${body}</body></html>`;

const DOC_CSS = `html{background:#e9ece9}body{margin:0;padding:12px}
.paper{background:#fff;max-width:760px;margin:0 auto;padding:28px 24px;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.14);font-family:Calibri,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;word-wrap:break-word}
h1,h2,h3,h4{font-family:'Calibri Light','Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.25;margin:1.3em 0 .45em;color:#2e5a44}
.paper>h1:first-child{margin-top:0;font-size:2em;color:#1f3a2e;font-weight:400}h1{font-size:1.6em;color:#1f3a2e}h2{font-size:1.35em}h3{font-size:1.15em}h4{font-size:1em}
code{font-family:Menlo,Consolas,'Courier New',monospace;font-size:.88em;background:#f0f1ee;padding:1px 4px;border-radius:3px}
pre{background:#f3f4f2;padding:12px;border-radius:6px;white-space:pre-wrap}pre code{background:none;padding:0}
blockquote{margin:1em 0;padding:0 1em;border-left:3px solid #9db8a7;color:#555;font-style:italic}
table{border-collapse:collapse;margin:1em 0;width:100%;font-size:.94em}th,td{border:1px solid #c9d2cc;padding:6px 9px}th{background:#e6eee8}
hr{border:none;border-top:1px solid #c9d2cc;margin:1.8em 0}a{color:#2a6f4f}
@media print{html{background:#fff}body{padding:0}.paper{box-shadow:none;border-radius:0;max-width:none;padding:0 48px;font-size:11pt}}`;

/** A document on a sheet of paper (Markdown), or a code listing. */
export function documentHtml(a: Artifact): string {
  const body = a.kind === 'markdown' ? markdownHtml(a.content) : `<pre><code>${esc(a.content)}</code></pre>`;
  return page(displayTitle(a), DOC_CSS, `<div class="paper">${body}</div>`);
}

// ---- Decks ----

const DECK_CSS = `html,body{margin:0;background:#e9ece9}.deck{padding:12px;display:flex;flex-direction:column;gap:12px}
.slide{position:relative;aspect-ratio:16/9;container-type:inline-size;background:#fff;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.16);overflow:hidden;font-family:Calibri,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#3a433e}
.t{position:absolute;left:5%;right:5%;top:6.7%;height:13.3%;display:flex;align-items:center;padding-left:2.2cqw;font-size:3.1cqw;font-weight:700;color:#1f2a24}
.t:before{content:'';position:absolute;left:0;top:13%;bottom:13%;width:.6cqw;background:#3e7a5a}
.b{position:absolute;left:5%;right:5%;top:24.4%;bottom:8.8%;font-size:2.3cqw;line-height:1.3;overflow:hidden}
.b p,.b ul,.b ol{margin:0 0 .5em}.b ul,.b ol{padding-left:1.3em}.b li{margin:.35em 0}.b li li{font-size:.9em}
.b h1,.b h2,.b h3,.b h4{font-size:1.1em;color:#1f2a24;margin:.4em 0}.b code,.b pre{font-family:Consolas,Menlo,monospace;font-size:.8em}.b pre{margin:0;white-space:pre-wrap}
.b table{border-collapse:collapse;width:100%;font-size:.75em;margin-top:.4em}.b th{background:#3e7a5a;color:#fff;text-align:left}.b th,.b td{border:1px solid #c9d2cc;padding:.45em .7em}.b tr:nth-child(even) td{background:#eef3ef}
.b blockquote{margin:0;font-style:italic}.b a{color:#3e7a5a}
.n{position:absolute;right:5%;bottom:3.3%;font-size:1.1cqw;color:#8a948e}
.cover{background:#1f3a2e;color:#cfe3d6;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 5%}
.cover h1{color:#fff;font-size:4.6cqw;margin:0;line-height:1.15}.cover i{display:block;width:7.5cqw;height:.4cqw;background:#cfe3d6;margin:2.4cqw 0}.cover p{font-size:2.3cqw;margin:0 0 .3em}
@media print{html,body{background:#fff}.deck{padding:0;gap:0}.slide{border-radius:0;box-shadow:none;break-after:page;page-break-after:always}}`;

const isCover = (s: Slide, i: number) => i === 0 && s.blocks.length <= 2 && s.blocks.every(b => b.t === 'p' || b.t === 'h');

/** Markdown slides as a deck of 16:9 pages, the way the PowerPoint file lays them out. */
export function deckHtml(a: Artifact): string {
  const slides = splitSlides(a.content, parse);
  const body = slides
    .map((s, i) =>
      isCover(s, i)
        ? `<section class="slide cover"><h1>${inlineHtml(s.title)}</h1>${s.blocks.length ? '<i></i>' : ''}${s.blocks.map(b => `<p>${inlineHtml((b as { text: string }).text)}</p>`).join('')}</section>`
        : `<section class="slide">${s.title ? `<div class="t">${inlineHtml(s.title)}</div>` : ''}<div class="b">${blocksHtml(s.blocks.filter(b => b.t !== 'hr'))}</div><div class="n">${i + 1} / ${slides.length}</div></section>`,
    )
    .join('');
  return page(displayTitle(a), DECK_CSS, `<div class="deck">${body}</div>`);
}

/** How many slides a deck has. */
export const slideCount = (a: Artifact) => splitSlides(a.content, parse).length;

// ---- Spreadsheets ----

const SHEET_CSS = `html,body{margin:0;background:#fff;font-family:Calibri,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#1a1a1a}
h2{font-size:15px;margin:14px 12px 6px;color:#1f3a2e}.wrap{overflow-x:auto;margin:0 0 8px}
table{border-collapse:collapse;min-width:100%}th,td{border:1px solid #dde3df;padding:5px 9px;white-space:nowrap;text-align:left}
thead th{background:#f3f5f3;color:#8a948e;font-weight:400;font-size:12px;text-align:center}td.r{background:#f3f5f3;color:#8a948e;font-size:12px;text-align:center}
tr.h td:not(.r){background:#3e7a5a;color:#fff;font-weight:600}td.num{text-align:right;font-variant-numeric:tabular-nums}td.f{color:#5e7a68;font-style:italic;font-family:Menlo,Consolas,monospace;font-size:12px}`;

const col = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : col(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

/** The workbook as grids with Excel's row numbers and column letters. Formulas show as written. */
export function sheetHtml(a: Artifact): string {
  const sheets = sheetsFrom(a.content, parse);
  const body = sheets
    .map((s, k) => {
      const cols = Math.max(1, ...s.rows.map(r => r.length));
      const head = `<thead><tr><th></th>${Array.from({ length: cols }, (_, j) => `<th>${col(j)}</th>`).join('')}</tr></thead>`;
      const rows = s.rows
        .map((r, i) => {
          const cells = Array.from({ length: cols }, (_, j) => {
            const v = r[j] ?? '';
            const cls = v.startsWith('=') ? 'f' : /^[-+]?[$€£]?\s?[\d,.]+%?\s?[$€£]?$/.test(v.trim()) ? 'num' : '';
            return `<td${cls ? ` class="${cls}"` : ''}>${esc(v)}</td>`;
          }).join('');
          return `<tr${i === 0 && s.rows.length > 1 ? ' class="h"' : ''}><td class="r">${i + 1}</td>${cells}</tr>`;
        })
        .join('');
      return `${sheets.length > 1 || s.name ? `<h2>${esc(s.name || `Sheet${k + 1}`)}</h2>` : ''}<div class="wrap"><table>${head}<tbody>${rows}</tbody></table></div>`;
    })
    .join('');
  return page(displayTitle(a), SHEET_CSS, body);
}

/** The first rows of the first sheet, as plain text cells (for thumbnails). */
export const sheetPreview = (a: Artifact) => (sheetsFrom(a.content, parse)[0]?.rows ?? []).slice(0, 6).map(r => r.slice(0, 4).map(c => plain(c)));
