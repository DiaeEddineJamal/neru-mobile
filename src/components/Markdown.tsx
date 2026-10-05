import { Fragment } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { font, fs, useColors, type Colors } from '@/theme';
import { CodeBlock } from '@/ui/code-block';

// ponytail: covers what chat replies use (fences, headings, nested lists, quotes, rules, GitHub tables,
// inline code/bold/italic/links). Swap in a full parser when replies need more.
type Align = 'left' | 'center' | 'right';
type Block =
  | { t: 'code'; lang: string; text: string; open: boolean }
  | { t: 'h'; level: number; text: string }
  | { t: 'li'; marker: string; text: string; level: number }
  | { t: 'quote'; text: string }
  | { t: 'hr' }
  | { t: 'table'; head: string[]; align: Align[]; rows: string[][] }
  | { t: 'p'; text: string };

const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** "| a | b |" -> ["a", "b"]; a backslash-escaped pipe stays in its cell. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/\\\|/g, '\u0000')
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim().replace(/\u0000/g, '|'));
}

function parse(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.split('\n');
  let para: string[] = [];
  // Indents of the open list items; an item's level is how many open items sit left of it.
  let indents: number[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', text: para.join(' ') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      flush();
      indents = [];
      const body: string[] = [];
      while (++i < lines.length && !lines[i].startsWith('```')) body.push(lines[i]);
      blocks.push({ t: 'code', lang: fence[1], text: body.join('\n'), open: i >= lines.length }); // an unclosed fence (mid-stream) still renders
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && DELIM.test(lines[i + 1]) && cells(lines[i + 1]).length === cells(line).length) {
      flush();
      indents = [];
      const head = cells(line);
      const align = cells(lines[++i]).map((d): Align => (d.endsWith(':') ? (d.startsWith(':') ? 'center' : 'right') : 'left'));
      const rows: string[][] = [];
      while (i + 1 < lines.length && lines[i + 1].includes('|')) rows.push(cells(lines[++i]));
      blocks.push({ t: 'table', head, align, rows });
      continue;
    }
    const hr = HR.test(line);
    const h = line.match(/^(#{1,4})\s+(.*)/);
    const li = hr ? null : line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/);
    const q = line.match(/^>\s?(.*)/);
    if (!hr && !h && !li && !q && line.trim()) {
      para.push(line.trim());
      continue;
    }
    flush();
    if (li) {
      const indent = li[1].replace(/\t/g, '    ').length;
      while (indents.length && indents[indents.length - 1] >= indent) indents.pop();
      blocks.push({ t: 'li', marker: /\d/.test(li[2]) ? li[2] : indents.length ? '◦' : '•', text: li[3], level: indents.length });
      indents.push(indent);
      continue;
    }
    if (line.trim()) indents = [];
    if (hr) blocks.push({ t: 'hr' });
    else if (h) blocks.push({ t: 'h', level: h[1].length, text: h[2] });
    else if (q) blocks.push({ t: 'quote', text: q[1] });
  }
  flush();
  return blocks;
}

function Inline({ text, c }: { text: string; c: Colors }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('`') && p.endsWith('`') && p.length > 1)
          return <Text key={i} style={{ fontFamily: font.mono, fontSize: fs.sm, color: c.codeChip, backgroundColor: c.codeChipBg }}>{` ${p.slice(1, -1)} `}</Text>;
        if (p.startsWith('**') && p.endsWith('**') && p.length > 3)
          return <Text key={i} style={{ fontFamily: font.semibold }}>{p.slice(2, -2)}</Text>;
        if (p.startsWith('*') && p.endsWith('*') && p.length > 2)
          return <Text key={i} style={{ fontStyle: 'italic' }}>{p.slice(1, -1)}</Text>;
        const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link)
          return <Text key={i} style={{ color: c.link }} onPress={() => Linking.openURL(link[2])}>{link[1]}</Text>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

// beUI table look (beui.dev/components/motion/table): square bordered frame on the background, bg-muted
// header in font-medium muted text, rows split by border/60, px-4 cells, text-sm, 48px rows.
// ponytail: column widths come from the longest cell's character count (no measuring pass), then grow to fill the frame.
function Table({ head, align, rows, c }: { head: string[]; align: Align[]; rows: string[][]; c: Colors }) {
  const cols = Math.max(head.length, ...rows.map(r => r.length));
  const widths = Array.from({ length: cols }, (_, j) =>
    Math.min(300, Math.max(88, 36 + 8.6 * Math.max(head[j]?.length ?? 0, ...rows.map(r => r[j]?.length ?? 0)))),
  );
  const row = (r: string[], header: boolean) =>
    widths.map((w, j) => (
      <View key={j} style={[ts.cell, { flexBasis: w, flexGrow: w, minWidth: w }]}>
        <Text style={[ts.text, { textAlign: align[j] ?? 'left', color: header ? c.muted : c.text, fontFamily: header ? font.medium : font.sans }]}>
          <Inline text={r[j] ?? ''} c={c} />
        </Text>
      </View>
    ));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[ts.frame, { borderColor: c.border, backgroundColor: c.bg }]} contentContainerStyle={{ flexGrow: 1 }}>
      {/* Columns grow in proportion so a narrow table still fills the frame and rows stay aligned. */}
      <View style={{ flexGrow: 1 }}>
        <View style={[ts.row, { backgroundColor: c.surface3, borderBottomColor: c.border }]}>{row(head, true)}</View>
        {rows.map((r, i) => (
          <View key={i} style={[ts.row, { borderBottomColor: `${c.border}99` }, i === rows.length - 1 && ts.lastRow]}>
            {row(r, false)}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export function Markdown({ text }: { text: string }) {
  const c = useColors();
  const body = { color: c.text, fontFamily: font.sans, fontSize: fs.base, lineHeight: 24 };
  return (
    <View style={{ gap: 10 }}>
      {parse(text).map((b, i) => {
        switch (b.t) {
          case 'code':
            return <CodeBlock key={i} lang={b.lang} code={b.text} streaming={b.open} />;
          case 'h':
            return <Text key={i} accessibilityRole="header" style={[body, { fontFamily: font.semibold, fontSize: b.level === 1 ? fs.lg : fs.md }]}><Inline text={b.text} c={c} /></Text>;
          case 'li':
            return (
              <View key={i} style={{ flexDirection: 'row', gap: 8, paddingLeft: 4 + 20 * b.level }}>
                <Text style={[body, { color: c.muted }]}>{b.marker}</Text>
                <Text style={[body, { flex: 1 }]}><Inline text={b.text} c={c} /></Text>
              </View>
            );
          case 'quote':
            return <Text key={i} style={[body, { color: c.secondary, borderLeftWidth: 3, borderLeftColor: c.border, paddingLeft: 12 }]}><Inline text={b.text} c={c} /></Text>;
          case 'hr':
            return <View key={i} style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: 6 }} />;
          case 'table':
            return <Table key={i} head={b.head} align={b.align} rows={b.rows} c={c} />;
          default:
            return <Text key={i} style={body}><Inline text={b.text} c={c} /></Text>;
        }
      })}
    </View>
  );
}

const ts = StyleSheet.create({
  frame: { flexGrow: 0, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  lastRow: { borderBottomWidth: 0 },
  cell: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  text: { fontSize: fs.sm, lineHeight: 20 },
});
