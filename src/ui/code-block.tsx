// Port of beui.dev/components/agents/code-block (+ agents/agent-code line rendering).
// beUI tokenises with shiki, too heavy for Hermes; ui/highlight colours lines like VS Code's Dark+/Light+ instead.
// Not ported: highlightLines/filename/wrap (Markdown has no use for them).
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { font, fs, useColors, useScheme } from '@/theme';
import { Button, SwapIcon } from '@/ui/button';
import { tokenize, vscode } from '@/ui/highlight';
import { Loader } from '@/ui/loader';

type Props = { code: string; lang: string; /** Fence still open mid-stream: shows "Writing" and follows the tail. */ streaming?: boolean };

export function CodeBlock({ code, lang, streaming = false }: Props) {
  const c = useColors();
  const reduce = useReducedMotion();
  const viewport = useRef<ScrollView>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  const palette = vscode[useScheme()];
  const lines = useMemo(() => tokenize(code, lang), [code, lang]);
  // No ligatures: `<!--` and `=>` must read as typed.
  const line = { fontFamily: font.mono, fontSize: fs.xs, lineHeight: 20, fontVariant: ['no-common-ligatures', 'no-contextual'] as ('no-common-ligatures' | 'no-contextual')[] };
  const statusColor = streaming ? c.link : c.sage;

  return (
    <View accessibilityState={{ busy: streaming }} style={[s.box, { backgroundColor: c.surface3 }]}>
      <View style={s.head}>
        <Icon name="code" size={14} color={c.muted} />
        <Text style={[s.lang, { color: c.muted }]}>{lang || 'text'}</Text>
        <View style={s.status}>
          {streaming ? <Loader size={12} color={statusColor} /> : <Icon name="check" size={12} color={statusColor} />}
          <Text style={[s.statusText, { color: statusColor }]}>{streaming ? 'Writing' : 'Ready'}</Text>
        </View>
        <Button label={copied ? 'Copied' : 'Copy code'} onPress={copy} pressScale={0.9} hitSlop={10} style={{ width: 28, height: 28, borderRadius: 14 }}>
          <SwapIcon swapKey={copied ? 'check' : 'copy'} size={16}>
            <Icon name={copied ? 'check' : 'copy'} size={16} color={c.muted} />
          </SwapIcon>
        </Button>
      </View>

      <ScrollView
        ref={viewport}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: 280, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }}
        contentContainerStyle={{ paddingVertical: 8 }}
        onContentSizeChange={() => streaming && viewport.current?.scrollToEnd({ animated: !reduce })}
        accessibilityLiveRegion={streaming ? 'polite' : 'none'}
      >
        <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}>
          <View>
            {lines.map((tokens, i) => (
              <View key={i} style={{ flexDirection: 'row', minHeight: 20 }}>
                <Text aria-hidden style={[line, s.gutter, { color: c.muted }]}>{i + 1}</Text>
                <Text selectable style={[line, { color: palette.plain, paddingLeft: 4, paddingRight: 16 }]}>
                  {tokens.map((t, j) => <Text key={j} style={t.kind === 'comment' ? { color: palette.comment, fontStyle: 'italic' } : { color: palette[t.kind] }}>{t.text}</Text>)}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  box: { width: '100%', overflow: 'hidden', borderRadius: 16 },
  head: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },
  lang: { fontFamily: font.medium, fontSize: 10, letterSpacing: 0.25, textTransform: 'uppercase', opacity: 0.55 },
  status: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { fontFamily: font.medium, fontSize: 10 },
  gutter: { width: 44, paddingRight: 12, textAlign: 'right', fontVariant: ['tabular-nums'], opacity: 0.35 },
});
