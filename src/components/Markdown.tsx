import { Fragment, memo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { createIncrementalParser, sameBlock, type Align, type Block } from '@/components/markdown/parse';
import { font, fs, useColors, type Colors } from '@/theme';
import { CodeBlock } from '@/ui/code-block';
import { perf } from '@/ui/stream/perf';
import { VISUAL_LANGS, Visual } from '@/viz/Visual';

// Parsing lives in markdown/parse.ts. While a reply streams, the blocks above its last blank line are parsed once
// and keep their identity, and every block row is memoized on its content: per update only the open last block
// re-renders (see scripts/bench-stream.mjs for the numbers).

const Inline = memo(function Inline({ text, c }: { text: string; c: Colors }) {
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
});

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

/** One block. Re-renders only when its content (or the theme) changes, never because a later block grew. */
const BlockView = memo(
  function BlockView({ b, c }: { b: Block; c: Colors }) {
    if (__DEV__ && perf.on) perf.countBlock();
    const body = { color: c.text, fontFamily: font.sans, fontSize: fs.base, lineHeight: 24 };
    switch (b.t) {
      case 'code':
        return VISUAL_LANGS.includes(b.lang) ? <Visual lang={b.lang} source={b.text} streaming={b.open} /> : <CodeBlock lang={b.lang} code={b.text} streaming={b.open} />;
      case 'h':
        return <Text accessibilityRole="header" style={[body, { fontFamily: font.semibold, fontSize: b.level === 1 ? fs.lg : fs.md }]}><Inline text={b.text} c={c} /></Text>;
      case 'li':
        return (
          <View style={{ flexDirection: 'row', gap: 8, paddingLeft: 4 + 20 * b.level }}>
            <Text style={[body, { color: c.muted }]}>{b.marker}</Text>
            <Text style={[body, { flex: 1 }]}><Inline text={b.text} c={c} /></Text>
          </View>
        );
      case 'quote':
        return <Text style={[body, { color: c.secondary, borderLeftWidth: 3, borderLeftColor: c.border, paddingLeft: 12 }]}><Inline text={b.text} c={c} /></Text>;
      case 'hr':
        return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: 6 }} />;
      case 'table':
        return <Table head={b.head} align={b.align} rows={b.rows} c={c} />;
      default:
        return <Text style={body}><Inline text={b.text} c={c} /></Text>;
    }
  },
  (a, b) => a.c === b.c && sameBlock(a.b, b.b),
);

export function Markdown({ text }: { text: string }) {
  const c = useColors();
  // One parser per mounted reply: it keeps the settled blocks between updates.
  const [parser] = useState(createIncrementalParser);
  const blocks = parser.update(text);
  return (
    <View style={{ gap: 10 }}>
      {blocks.map((b, i) => (
        <BlockView key={i} b={b} c={c} />
      ))}
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
