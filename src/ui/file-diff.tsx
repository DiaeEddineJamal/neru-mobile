// Port of beui.dev/components/agents/file-diff, split in two for mobile: FileDiffCard is beUI's trigger row
// (file icon, mono path, +N/−N, applied check) opening a screen instead of a disclosure, and FileDiffView is
// its unified body (old/new gutters, +/− column, 7% green/red line tints, horizontal scroll), parsing the patch
// the way Neru desktop's lib/diff.ts does. Hunk headers take the muted strip desktop's split view uses.
// ponytail: no shiki highlighting (beUI's AgentCodeLine tokens); lines render in plain text colour.
// Not ported: copy button, streaming auto-scroll, split view and line comments (desktop-only additions).
import { useState } from 'react';
import { Pressable, ScrollView, Text, type TextStyle, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { font, fs, TAP, useColors } from '@/theme';

type DiffLine = { id: string; type?: 'added' | 'removed' | 'context'; oldLine?: number; newLine?: number; content: string };

/** Unified diff → rows with old/new line numbers (Neru desktop's parseUnifiedDiff). */
export function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  const rows = diff.split('\n');
  rows.forEach((raw, index) => {
    if (/^(diff --git|index |--- |\+\+\+ |\\ |new file mode|deleted file mode)/.test(raw)) return;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      lines.push({ id: `h${index}`, content: raw });
    } else if (raw.startsWith('+')) lines.push({ id: `l${index}`, type: 'added', newLine: newLine++, content: raw.slice(1) });
    else if (raw.startsWith('-')) lines.push({ id: `l${index}`, type: 'removed', oldLine: oldLine++, content: raw.slice(1) });
    else if (raw.startsWith(' ') || (raw === '' && index < rows.length - 1 && (oldLine || newLine))) lines.push({ id: `l${index}`, type: 'context', oldLine: oldLine++, newLine: newLine++, content: raw.slice(1) });
  });
  return lines;
}

function ChangeCount({ value, type }: { value: number; type: 'added' | 'removed' }) {
  const c = useColors();
  if (!value) return null;
  return <Text style={{ fontFamily: font.mono, fontSize: fs.xs, fontVariant: ['tabular-nums'], color: type === 'added' ? c.sage : c.danger }}>{type === 'added' ? '+' : '−'}{value}</Text>;
}

export function FileDiffCard({ file, added, removed, onPress }: { file: string; added: number; removed: number; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${file}, ${added} added, ${removed} removed`}
      accessibilityHint="Opens the diff"
      style={({ pressed }) => ({ minHeight: TAP, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}
    >
      <Icon name="fileCode" size={16} color={c.muted} />
      <Text numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1, minWidth: 0, fontFamily: font.mono, fontSize: fs.xs, color: c.text, opacity: 0.8 }}>{file}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ChangeCount value={added} type="added" />
        <ChangeCount value={removed} type="removed" />
      </View>
      <Icon name="check" size={14} color={c.muted} />
      <Icon name="chevronRight" size={14} color={c.muted} />
    </Pressable>
  );
}

const GUTTER = 36;
const LINE = 20;

export function FileDiffView({ file, patch }: { file: string; patch: string }) {
  const c = useColors();
  const [width, setWidth] = useState(0);
  const lines = parseUnifiedDiff(patch);
  const mono = { fontFamily: font.mono, fontSize: fs.xs, lineHeight: LINE } as const;
  const numberStyle: TextStyle = { ...mono, width: GUTTER, paddingRight: 8, textAlign: 'right', fontVariant: ['tabular-nums'], color: c.muted, opacity: 0.6 };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }} accessibilityLabel={`Changes to ${file}`}>
      <View style={{ overflow: 'hidden', borderRadius: 12, backgroundColor: c.surface3 }} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ minWidth: width, paddingVertical: 4 }}>
            {lines.map(line => {
              const tint = line.type === 'added' ? c.sage : line.type === 'removed' ? c.danger : null;
              if (!line.type) {
                return <Text key={line.id} style={{ ...mono, paddingHorizontal: 8, color: c.muted, backgroundColor: `${c.text}08` }}>{line.content}</Text>;
              }
              return (
                <View
                  key={line.id}
                  accessible
                  accessibilityLabel={`${line.type === 'added' ? 'Added' : line.type === 'removed' ? 'Removed' : 'Line'} ${line.newLine ?? line.oldLine}: ${line.content}`}
                  style={{ flexDirection: 'row', backgroundColor: tint ? `${tint}12` : undefined }}
                >
                  <Text style={numberStyle}>{line.oldLine}</Text>
                  <Text style={numberStyle}>{line.newLine}</Text>
                  <Text style={{ ...mono, width: 16, textAlign: 'center', color: tint ?? c.muted }}>{line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ''}</Text>
                  <Text style={{ ...mono, paddingHorizontal: 6, color: c.text }}>{line.content}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </ScrollView>
  );
}
