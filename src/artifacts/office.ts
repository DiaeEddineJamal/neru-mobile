// Real Office files built on the phone from what the model wrote: Word (.docx) from Markdown, PowerPoint (.pptx) from
// Markdown slides split by "---", Excel (.xlsx) from Markdown tables or CSV. Each is a zip of XML parts, written here
// uncompressed (Office reads stored entries), so no library or native code is needed.
// Pure TypeScript with type-only imports, so `node src/artifacts/office.check.ts` can build and inspect the files;
// the Markdown parser is passed in for the same reason.
import type { Align, Block } from '../components/markdown/parse';

export type ParseMarkdown = (src: string) => Block[];

// ---- zip (stored) ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive of the given files, stored without compression. */
export function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const entries = Object.entries(files).map(([name, body]) => {
    const data = typeof body === 'string' ? enc.encode(body) : body;
    return { name: enc.encode(name), data, crc: crc32(data) };
  });
  const size = entries.reduce((n, e) => n + 30 + e.name.length + e.data.length + 46 + e.name.length, 22);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const u16 = (v: number) => (view.setUint16(at, v, true), (at += 2));
  const u32 = (v: number) => (view.setUint32(at, v >>> 0, true), (at += 4));
  const bytes = (b: Uint8Array) => (out.set(b, at), (at += b.length));
  // 1980-01-01 00:00: a fixed date keeps the bytes the same for the same content.
  const TIME = 0;
  const DATE = 0x21;
  const offsets: number[] = [];
  for (const e of entries) {
    offsets.push(at);
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(TIME); u16(DATE);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length); u16(0);
    bytes(e.name); bytes(e.data);
  }
  const dir = at;
  entries.forEach((e, i) => {
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(TIME); u16(DATE);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(offsets[i]);
    bytes(e.name);
  });
  const dirSize = at - dir;
  u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length); u32(dirSize); u32(dir); u16(0);
  return out;
}

// ---- shared ----

/** Escapes text for XML and drops the control characters XML forbids. */
export function xml(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function coreProps(title: string): string {
  return `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>Neru</dc:creator></cp:coreProperties>`;
}

function rootRels(main: string): string {
  return `${XML_HEAD}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${DOC_REL}/officeDocument" Target="${main}"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
}

function contentTypes(overrides: [string, string][]): string {
  const all: [string, string][] = [...overrides, ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml']];
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${all.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('')}</Types>`;
}

// ---- inline Markdown ----

export type Run = { text: string; b?: boolean; i?: boolean; code?: boolean; strike?: boolean; link?: string };

const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\[([^\]]+)\]\(([^)\s]+)\)|(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\w)|(^|[^\w])_(?!\s)([^_]+?)_(?!\w)/g;

/** Inline Markdown as styled runs: code, bold, italic, strikethrough and links (one level of nesting). */
export function runs(text: string, style: Omit<Run, 'text'> = {}): Run[] {
  const out: Run[] = [];
  const push = (t: string) => {
    const clean = t.replace(/\\([\\`*_[\]()#+\-.!~|])/g, '$1');
    if (clean) out.push({ ...style, text: clean });
  };
  let last = 0;
  INLINE.lastIndex = 0;
  for (let m = INLINE.exec(text); m; m = INLINE.exec(text)) {
    let start = m.index;
    // The italic forms capture the character before the marker; it is plain text.
    const lead = m[7] ?? m[9];
    if (lead) start += lead.length;
    push(text.slice(last, start));
    if (m[1] !== undefined) out.push({ ...style, text: m[1], code: true });
    else if (m[2] !== undefined || m[3] !== undefined) out.push(...runs(m[2] ?? m[3], { ...style, b: true }));
    else if (m[4] !== undefined) out.push(...runs(m[4], { ...style, strike: true }));
    else if (m[5] !== undefined) out.push(...runs(m[5], { ...style, link: /^(https?:|mailto:)/i.test(m[6]) ? m[6] : undefined }));
    else out.push(...runs(m[8] ?? m[10], { ...style, i: true }));
    last = m.index + m[0].length;
    INLINE.lastIndex = last;
  }
  push(text.slice(last));
  return out;
}

/** Inline Markdown as plain text. */
export const plain = (text: string) => runs(text).map(r => r.text).join('');

// ---- Word ----

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
/** A4 with 1-inch margins, in twentieths of a point. */
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 1440;
const TEXT_W = PAGE_W - 2 * MARGIN;

const WORD_STYLES = `${XML_HEAD}<w:styles ${W_NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:color w:val="1F3A2E"/><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr></w:style>
${[1, 2, 3, 4].map(l => `<w:style w:type="paragraph" w:styleId="Heading${l}"><w:name w:val="heading ${l}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${[360, 280, 240, 200][l - 1]}" w:after="${[120, 100, 80, 60][l - 1]}"/><w:outlineLvl w:val="${l - 1}"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/>${l > 2 ? '<w:b/>' : ''}<w:color w:val="${l === 1 ? '1F3A2E' : '2E5A44'}"/><w:sz w:val="${[36, 30, 26, 23][l - 1]}"/><w:szCs w:val="${[36, 30, 26, 23][l - 1]}"/></w:rPr></w:style>`).join('\n')}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="9DB8A7"/></w:pBdr><w:ind w:left="360"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F4F2"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>
<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Inline Code"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/><w:shd w:val="clear" w:color="auto" w:fill="F0F1EE"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="2A6F4F"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="C9D2CC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="C9D2CC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="C9D2CC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="C9D2CC"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="C9D2CC"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="C9D2CC"/></w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

const BULLETS = ['•', '◦', '▪'];
const ORDERED: [string, string][] = [['decimal', '%1.'], ['lowerLetter', '%2.'], ['lowerRoman', '%3.']];

function wordNumbering(ordered: number[]): string {
  const lvl = (i: number, fmt: string, text: string) =>
    `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + 360 * i}" w:hanging="360"/></w:pPr></w:lvl>`;
  const bullet = Array.from({ length: 9 }, (_, i) => lvl(i, 'bullet', BULLETS[i % 3])).join('');
  const numbered = Array.from({ length: 9 }, (_, i) => lvl(i, ORDERED[i % 3][0], `%${i + 1}.`)).join('');
  // numId 1: bullets. Each ordered list gets its own numId so its numbering starts again.
  const nums = ordered.map((start, k) => `<w:num w:numId="${k + 2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${start}"/></w:lvlOverride></w:num>`).join('');
  return `${XML_HEAD}<w:numbering ${W_NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${bullet}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${numbered}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${nums}</w:numbering>`;
}

/** A Word document from Markdown blocks. */
export function docx(blocks: Block[], title: string): Uint8Array {
  const links: string[] = [];
  const ordered: number[] = [];
  const linkId = (url: string) => {
    let i = links.indexOf(url);
    if (i < 0) i = links.push(url) - 1;
    return `rIdL${i + 1}`;
  };
  const wrun = (r: Run, extra = '') => {
    const props = `${r.link ? '<w:rStyle w:val="Hyperlink"/>' : r.code ? '<w:rStyle w:val="CodeChar"/>' : ''}${r.b ? '<w:b/>' : ''}${r.i ? '<w:i/>' : ''}${r.strike ? '<w:strike/>' : ''}${extra}`;
    return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`;
  };
  const inline = (text: string, style: Omit<Run, 'text'> = {}) =>
    runs(text, style).map(r => (r.link ? `<w:hyperlink r:id="${linkId(r.link)}" w:history="1">${wrun(r)}</w:hyperlink>` : wrun(r))).join('');
  const para = (content: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`;

  let body = '';
  let listNum = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const prev = blocks[i - 1];
    switch (b.t) {
      case 'h':
        // The first heading of the document is its title.
        body += para(inline(b.text), `<w:pStyle w:val="${i === 0 && b.level === 1 ? 'Title' : `Heading${b.level}`}"/>`);
        break;
      case 'p':
        body += para(inline(b.text));
        break;
      case 'quote':
        body += para(inline(b.text), '<w:pStyle w:val="Quote"/>');
        break;
      case 'hr':
        body += para('', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C9D2CC"/></w:pBdr>');
        break;
      case 'code':
        body += (b.text ? b.text.split('\n') : ['']).map(l => para(l ? `<w:r><w:t xml:space="preserve">${xml(l)}</w:t></w:r>` : '', '<w:pStyle w:val="Code"/>')).join('');
        body += para('', '<w:spacing w:after="0"/>');
        break;
      case 'li': {
        // listNum: the numbering of the ordered list being written, so a new list counts from its own start.
        const isOrdered = /\d/.test(b.marker);
        if (prev?.t !== 'li') listNum = 0;
        if (isOrdered && !listNum) listNum = ordered.push(parseInt(b.marker, 10) || 1) + 1;
        const numId = isOrdered ? listNum : 1;
        const level = Math.min(b.level, 8);
        body += para(inline(b.text), `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr><w:ind w:left="${720 + 360 * level}" w:hanging="360"/>`);
        break;
      }
      case 'table': {
        const cols = Math.max(b.head.length, ...b.rows.map(r => r.length), 1);
        const w = Math.floor(TEXT_W / cols);
        const jc = (a: Align | undefined) => (a === 'center' ? '<w:jc w:val="center"/>' : a === 'right' ? '<w:jc w:val="right"/>' : '');
        const cell = (text: string, j: number, head: boolean) =>
          `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="E6EEE8"/>' : ''}</w:tcPr>${para(inline(text, head ? { b: true } : {}), `<w:spacing w:after="0"/>${jc(b.align[j])}`)}</w:tc>`;
        const row = (cells: string[], head: boolean) =>
          `<w:tr>${head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${Array.from({ length: cols }, (_, j) => cell(cells[j] ?? '', j, head)).join('')}</w:tr>`;
        body += `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${w * cols}" w:type="dxa"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${row(b.head, true)}${b.rows.map(r => row(r, false)).join('')}</w:tbl>`;
        body += para('');
        break;
      }
    }
  }
  const document = `${XML_HEAD}<w:document ${W_NS}><w:body>${body || para('')}<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const rels = `${XML_HEAD}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${DOC_REL}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${DOC_REL}/numbering" Target="numbering.xml"/>${links.map((u, i) => `<Relationship Id="rIdL${i + 1}" Type="${DOC_REL}/hyperlink" Target="${xml(u)}" TargetMode="External"/>`).join('')}</Relationships>`;
  return zip({
    '[Content_Types].xml': contentTypes([
      ['/word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],
      ['/word/styles.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'],
      ['/word/numbering.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'],
    ]),
    '_rels/.rels': rootRels('word/document.xml'),
    'docProps/core.xml': coreProps(title),
    'word/document.xml': document,
    'word/styles.xml': WORD_STYLES,
    'word/numbering.xml': wordNumbering(ordered),
    'word/_rels/document.xml.rels': rels,
  });
}

// ---- PowerPoint ----

export type Slide = { title: string; blocks: Block[] };

/** Splits Markdown slides on lines holding only "---" (or "***"); each slide's first heading is its title. */
export function splitSlides(content: string, parse: ParseMarkdown): Slide[] {
  return content
    .replace(/\r\n/g, '\n')
    .split(/\n[ \t]*(?:-{3,}|\*{3,})[ \t]*(?=\n|$)/)
    .map(chunk => {
      const blocks = parse(chunk.replace(/^[ \t]*(?:-{3,}|\*{3,})[ \t]*\n/, ''));
      const h = blocks.findIndex(b => b.t === 'h');
      const title = h >= 0 ? plain((blocks[h] as Extract<Block, { t: 'h' }>).text) : '';
      return { title, blocks: blocks.filter((_, i) => i !== h) };
    })
    .filter(s => s.title || s.blocks.length);
}

const P_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const SLIDE_W = 12192000;
const SLIDE_H = 6858000;
const EMU_IN = 914400;
const INK = '1F2A24';
const BODY = '3A433E';
const MOSS = '1F3A2E';
const ACCENT = '3E7A5A';

const THEME = `${XML_HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Neru"><a:themeElements><a:clrScheme name="Neru"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="${MOSS}"/></a:dk2><a:lt2><a:srgbClr val="EEF2EE"/></a:lt2><a:accent1><a:srgbClr val="${ACCENT}"/></a:accent1><a:accent2><a:srgbClr val="C8873A"/></a:accent2><a:accent3><a:srgbClr val="4F7CAC"/></a:accent3><a:accent4><a:srgbClr val="9D5C8C"/></a:accent4><a:accent5><a:srgbClr val="6B8F3A"/></a:accent5><a:accent6><a:srgbClr val="B5543C"/></a:accent6><a:hlink><a:srgbClr val="2A6F4F"/></a:hlink><a:folHlink><a:srgbClr val="5E4B8B"/></a:folHlink></a:clrScheme><a:fontScheme name="Neru"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Neru"><a:fillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${'<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const CLR_MAP = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';

const MASTER = `${XML_HEAD}<p:sldMaster ${P_NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMap ${CLR_MAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2000"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
const LAYOUT = `${XML_HEAD}<p:sldLayout ${P_NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

type Para = { runs: Run[]; bullet?: 'dot' | 'number'; level?: number; size: number; color: string; mono?: boolean; align?: 'ctr' | 'r'; /** No space above (table cells, code). */ tight?: boolean };

function aRun(r: Run, p: Para): string {
  const attrs = `lang="en-US" sz="${p.size * 100}"${r.b ? ' b="1"' : ''}${r.i ? ' i="1"' : ''}${r.strike ? ' strike="sngStrike"' : ''}${r.link ? ' u="sng"' : ''} dirty="0"`;
  const font = r.code || p.mono ? '<a:latin typeface="Consolas"/><a:cs typeface="Consolas"/>' : '';
  return `<a:r><a:rPr ${attrs}><a:solidFill><a:srgbClr val="${r.link ? ACCENT : p.color}"/></a:solidFill>${font}</a:rPr><a:t>${xml(r.text)}</a:t></a:r>`;
}

function aPara(p: Para): string {
  const level = Math.min(p.level ?? 0, 4);
  const indent = 342900;
  const ppr = p.bullet
    ? `<a:pPr marL="${indent * (level + 1)}" lvl="${level}" indent="-${indent}"><a:spcBef><a:spcPts val="${level ? 300 : 900}"/></a:spcBef>${p.bullet === 'dot' ? `<a:buFont typeface="Arial"/><a:buChar char="${level ? '–' : '•'}"/>` : '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>'}</a:pPr>`
    : `<a:pPr marL="0" indent="0"${p.align ? ` algn="${p.align}"` : ''}><a:spcBef><a:spcPts val="${p.mono || p.tight ? 0 : 900}"/></a:spcBef><a:buNone/></a:pPr>`;
  return `<a:p>${ppr}${p.runs.map(r => aRun(r, p)).join('')}<a:endParaRPr lang="en-US" sz="${p.size * 100}" dirty="0"/></a:p>`;
}

function textBox(id: number, name: string, x: number, y: number, w: number, h: number, paras: Para[], anchor: 't' | 'ctr' | 'b' = 't'): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${(paras.length ? paras : [{ runs: [], size: 18, color: BODY }]).map(aPara).join('')}</p:txBody></p:sp>`;
}

function rect(id: number, x: number, y: number, w: number, h: number, color: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Accent ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;
}

function slideTable(id: number, b: Extract<Block, { t: 'table' }>, x: number, y: number, w: number, maxH: number): string {
  const cols = Math.max(b.head.length, ...b.rows.map(r => r.length), 1);
  const colW = Math.floor(w / cols);
  const rows = [b.head, ...b.rows];
  const rowH = Math.min(457200, Math.floor(maxH / rows.length));
  const size = rows.length > 8 || cols > 5 ? 12 : rows.length > 5 ? 14 : 16;
  const line = ['lnL', 'lnR', 'lnT', 'lnB'].map(l => `<a:${l} w="9525"><a:solidFill><a:srgbClr val="C9D2CC"/></a:solidFill></a:${l}>`).join('');
  const cell = (text: string, j: number, head: boolean, band: boolean) =>
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${aPara({ runs: runs(text, head ? { b: true } : {}), size, color: head ? 'FFFFFF' : BODY, align: b.align[j] === 'center' ? 'ctr' : b.align[j] === 'right' ? 'r' : undefined, tight: true })}</a:txBody><a:tcPr marL="91440" marR="91440" marT="45720" marB="45720" anchor="ctr">${line}<a:solidFill><a:srgbClr val="${head ? ACCENT : band ? 'EEF3EF' : 'FFFFFF'}"/></a:solidFill></a:tcPr></a:tc>`;
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${colW * cols}" cy="${rowH * rows.length}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${Array.from({ length: cols }, () => `<a:gridCol w="${colW}"/>`).join('')}</a:tblGrid>${rows.map((r, i) => `<a:tr h="${rowH}">${Array.from({ length: cols }, (_, j) => cell(r[j] ?? '', j, i === 0, i > 0 && i % 2 === 0)).join('')}</a:tr>`).join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

function slideXml(s: Slide, index: number, total: number): string {
  const margin = Math.round(0.6 * EMU_IN);
  const width = SLIDE_W - 2 * margin;
  // A first slide with only a title and a line or two is the title slide.
  const cover = index === 0 && s.blocks.length <= 2 && s.blocks.every(b => b.t === 'p' || b.t === 'h');
  let shapes = '';
  let bg = 'FFFFFF';
  if (cover) {
    bg = MOSS;
    const sub = s.blocks.map(b => ({ runs: runs((b as { text: string }).text), size: 22, color: 'CFE3D6', align: 'ctr' as const }));
    shapes += textBox(2, 'Title', margin, Math.round(SLIDE_H * 0.3), width, Math.round(SLIDE_H * 0.25), [{ runs: runs(s.title, { b: true }), size: 44, color: 'FFFFFF', align: 'ctr' }], 'b');
    shapes += rect(3, Math.round(SLIDE_W / 2 - 0.5 * EMU_IN), Math.round(SLIDE_H * 0.58), EMU_IN, 45720, 'CFE3D6');
    shapes += textBox(4, 'Subtitle', margin, Math.round(SLIDE_H * 0.62), width, Math.round(SLIDE_H * 0.25), sub);
  } else {
    const titleY = Math.round(0.45 * EMU_IN);
    const titleH = Math.round(0.9 * EMU_IN);
    shapes += rect(2, margin, titleY + 91440, 73152, titleH - 182880, ACCENT);
    shapes += textBox(3, 'Title', margin + 228600, titleY, width - 228600, titleH, [{ runs: runs(s.title, { b: true }), size: 30, color: INK }], 'ctr');
    const table = s.blocks.find((b): b is Extract<Block, { t: 'table' }> => b.t === 'table');
    const text = s.blocks.filter(b => b.t !== 'table');
    const lines = text.reduce((n, b) => n + (b.t === 'code' ? b.text.split('\n').length : 1), 0);
    const size = lines <= 5 ? 22 : lines <= 8 ? 18 : 15;
    const paras: Para[] = text.flatMap((b): Para[] => {
      if (b.t === 'li') return [{ runs: runs(b.text), bullet: /\d/.test(b.marker) ? 'number' : 'dot', level: b.level, size: b.level ? size - 2 : size, color: BODY }];
      if (b.t === 'code') return b.text.split('\n').map(l => ({ runs: [{ text: l || ' ' }], size: Math.min(size, 14), color: BODY, mono: true }));
      if (b.t === 'h') return [{ runs: runs(b.text, { b: true }), size: size + 2, color: INK }];
      if (b.t === 'hr') return [];
      return [{ runs: runs(b.text, b.t === 'quote' ? { i: true } : {}), size, color: BODY }];
    });
    const top = titleY + titleH + Math.round(0.3 * EMU_IN);
    const bottom = SLIDE_H - Math.round(0.6 * EMU_IN);
    if (table) {
      const textH = paras.length ? Math.min(Math.round(paras.length * size * 1.6 * 12700), Math.round((bottom - top) * 0.4)) : 0;
      if (paras.length) shapes += textBox(4, 'Body', margin, top, width, textH, paras);
      shapes += slideTable(5, table, margin, top + textH + (textH ? 182880 : 0), width, bottom - top - textH);
    } else shapes += textBox(4, 'Body', margin, top, width, bottom - top, paras);
    shapes += textBox(6, 'Slide number', SLIDE_W - margin - EMU_IN, SLIDE_H - Math.round(0.45 * EMU_IN), EMU_IN, Math.round(0.3 * EMU_IN), [{ runs: [{ text: `${index + 1} / ${total}` }], size: 10, color: '8A948E', align: 'r' }], 'b');
  }
  return `${XML_HEAD}<p:sld ${P_NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

/** A 16:9 PowerPoint deck. */
export function pptx(slides: Slide[], title: string): Uint8Array {
  const list = slides.length ? slides : [{ title, blocks: [] }];
  const files: Record<string, string> = {
    '[Content_Types].xml': contentTypes([
      ['/ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'],
      ['/ppt/slideMasters/slideMaster1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml'],
      ['/ppt/slideLayouts/slideLayout1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml'],
      ['/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'],
      ...list.map((_, i): [string, string] => [`/ppt/slides/slide${i + 1}.xml`, 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml']),
    ]),
    '_rels/.rels': rootRels('ppt/presentation.xml'),
    'docProps/core.xml': coreProps(title),
    'ppt/presentation.xml': `${XML_HEAD}<p:presentation ${P_NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${list.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `${XML_HEAD}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${DOC_REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${DOC_REL}/theme" Target="theme/theme1.xml"/>${list.map((_, i) => `<Relationship Id="rId${i + 3}" Type="${DOC_REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`,
    'ppt/slideMasters/slideMaster1.xml': MASTER,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': `${XML_HEAD}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${DOC_REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${DOC_REL}/theme" Target="../theme/theme1.xml"/></Relationships>`,
    'ppt/slideLayouts/slideLayout1.xml': LAYOUT,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': `${XML_HEAD}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${DOC_REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
    'ppt/theme/theme1.xml': THEME,
  };
  list.forEach((s, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = slideXml(s, i, list.length);
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = `${XML_HEAD}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${DOC_REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`;
  });
  return zip(files);
}

// ---- Excel ----

export type Sheet = { name: string; rows: string[][] };

/** Splits CSV (comma, semicolon or tab, whichever the first line uses most), with quoted fields. */
export function parseCsv(text: string): string[][] {
  const first = text.split('\n', 1)[0] ?? '';
  const delim = [',', ';', '\t'].reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell.trim()) {
      quoted = true;
      cell = '';
    } else if (ch === delim) endCell();
    else if (ch === '\n') {
      endCell();
      rows.push(row);
      row = [];
    } else if (ch !== '\r') cell += ch;
  }
  if (cell.trim() || row.length) {
    endCell();
    rows.push(row);
  }
  return rows.filter(r => r.some(c => c));
}

/** The sheets in what the model wrote: each Markdown table (named by the heading above it), or else the CSV. */
export function sheetsFrom(content: string, parse: ParseMarkdown): Sheet[] {
  const blocks = parse(content);
  const sheets: Sheet[] = [];
  let heading = '';
  for (const b of blocks) {
    if (b.t === 'h') heading = plain(b.text);
    else if (b.t === 'table') {
      sheets.push({ name: heading, rows: [b.head, ...b.rows].map(r => r.map(plain)) });
      heading = '';
    }
  }
  if (sheets.length) return sheets;
  const body = content.replace(/^\s*```\w*\n|\n```\s*$/g, '');
  return [{ name: '', rows: parseCsv(body) }];
}

const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

/** A cell as Excel stores it: formulas for "=…", numbers (and percentages) as numbers, the rest as text. */
function cellXml(ref: string, raw: string, header: boolean): string {
  const v = raw.trim();
  if (!v) return '';
  if (header) return `<c r="${ref}" s="1" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  if (/^=[^=]/.test(v)) return `<c r="${ref}"><f>${xml(v.slice(1))}</f></c>`;
  const n = v.replace(/^([-+]?)[$€£]\s?/, '$1').replace(/(\d),(?=\d{3}(\D|$))/g, '$1').replace(/\s?[$€£]$/, '');
  if (/^[-+]?\d+(\.\d+)?%$/.test(n)) return `<c r="${ref}" s="2"><v>${parseFloat(n) / 100}</v></c>`;
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(n) && !/^0\d/.test(n)) return `<c r="${ref}"><v>${Number(n)}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
}

const XLSX_STYLES = `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${ACCENT}"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function sheetXml(rows: string[][]): string {
  const cols = Math.max(1, ...rows.map(r => r.length));
  const widths = Array.from({ length: cols }, (_, j) => Math.min(60, Math.max(8, ...rows.map(r => (r[j] ?? '').length + 2))));
  const header = rows.length > 1;
  const data = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cellXml(`${colName(j)}${i + 1}`, v, header && i === 0)).join('')}</row>`).join('');
  const views = header ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const filter = header ? `<autoFilter ref="A1:${colName(cols - 1)}${rows.length}"/>` : '';
  return `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${views}<sheetFormatPr defaultRowHeight="15"/><cols>${widths.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData>${filter}</worksheet>`;
}

/** Excel's rules for sheet names: 31 characters, none of []:*?/\, unique. */
function sheetNames(sheets: Sheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((s, i) => {
    const base = s.name.replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** An Excel workbook, one sheet per table. Formulas are computed when Excel opens it. */
export function xlsx(sheets: Sheet[], title: string): Uint8Array {
  const list = sheets.length ? sheets : [{ name: '', rows: [] }];
  const names = sheetNames(list);
  const files: Record<string, string> = {
    '[Content_Types].xml': contentTypes([
      ['/xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'],
      ['/xl/styles.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'],
      ...list.map((_, i): [string, string] => [`/xl/worksheets/sheet${i + 1}.xml`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml']),
    ]),
    '_rels/.rels': rootRels('xl/workbook.xml'),
    'docProps/core.xml': coreProps(title),
    'xl/workbook.xml': `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML_HEAD}<Relationships xmlns="${REL_NS}">${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${DOC_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${list.length + 1}" Type="${DOC_REL}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': XLSX_STYLES,
  };
  list.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s.rows)));
  return zip(files);
}
