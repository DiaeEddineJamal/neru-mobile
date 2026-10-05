// Port of beui.dev/components/agents/tool-result
// Same row (kind icon, rolled title, mono tool name, status, chevron) and the AgentDisclosure log box that
// follows the output while running and collapses when the run ends (collapseOnComplete, defaultOpen).
// Not ported: copy/retry actions and meta (no props for them), shiki highlighting of the output.
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { font, fs, TAP, useColors } from '@/theme';
import { RollText } from '@/ui/action-swap';
import { AgentDisclosure, DisclosureChevron } from '@/ui/agent-disclosure';
import { LoaderCircle } from '@/ui/loader-circle';

export type ToolResultStatus = 'running' | 'done' | 'failed';

const statusLabel = { running: 'Running', done: 'Completed', failed: 'Failed' } as const;

export function ToolResult({ tool, summary, detail, status }: { tool: string; summary: string; detail?: string; status: ToolResultStatus }) {
  const c = useColors();
  const viewport = useRef<ScrollView>(null);
  const [open, setOpen] = useState(true);
  // Opens when a run starts, collapses when it ends (beUI's status effect, derived during render).
  const [prevStatus, setPrevStatus] = useState(status);
  if (prevStatus !== status) {
    setPrevStatus(status);
    if (status === 'running') setOpen(true);
    else if (prevStatus === 'running') setOpen(false);
  }
  const running = status === 'running';
  const tone = running ? c.link : status === 'done' ? c.sage : c.danger;

  useEffect(() => {
    if (open && running) viewport.current?.scrollToEnd({ animated: true });
  });

  return (
    <View accessibilityState={{ busy: running }} style={{ width: '100%' }}>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityLabel={`${summary}, ${tool}, ${statusLabel[status]}`}
        accessibilityState={{ expanded: open }}
        style={{ minHeight: TAP, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}
      >
        <Icon name="wrench" size={16} color={c.muted} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <RollText value={summary} style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.text }}>{summary}</RollText>
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: font.mono, fontSize: 11, color: c.muted, opacity: 0.8 }}>{tool}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {running ? <LoaderCircle size={12} color={tone} /> : <Icon name={status === 'done' ? 'checkCircle' : 'xCircle'} size={12} color={tone} />}
          <RollText value={status} style={{ fontFamily: font.medium, fontSize: 11, color: tone }}>{statusLabel[status]}</RollText>
        </View>
        <DisclosureChevron open={open} color={c.muted} />
      </Pressable>

      <AgentDisclosure open={open}>
        <View style={{ paddingLeft: 24, paddingTop: 6 }}>
          <View style={{ overflow: 'hidden', borderRadius: 12, backgroundColor: c.surface3 }}>
            <ScrollView ref={viewport} nestedScrollEnabled showsVerticalScrollIndicator={false} style={{ maxHeight: 220 }} contentContainerStyle={{ padding: 12 }}>
              <Text accessibilityLiveRegion="polite" selectable style={{ fontFamily: font.mono, fontSize: fs.xs, lineHeight: 20, color: c.text, opacity: 0.8 }}>
                {detail ?? ''}
              </Text>
            </ScrollView>
          </View>
        </View>
      </AgentDisclosure>
    </View>
  );
}
