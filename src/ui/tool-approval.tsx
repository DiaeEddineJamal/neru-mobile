// Port of beui.dev/components/agents/tool-approval (approval-card for the resolved state's rolled label).
// Card, shield/check/x tile, title + mono tool, status badge, "View details" AgentDisclosure (open while
// pending, closed on resolve, as Neru desktop does), and the action row that fades out once resolved.
// Mobile changes: Deny and Allow once are full-width 48dp buttons side by side, Always allow is a text
// button under them; the badge label rolls between states (ActionSwapRollText). Badge colours swap instantly
// rather than through transition-colors. Not ported: shiki highlighting of the detail.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { type EntryExitAnimationFunction, useReducedMotion, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { font, fs, TAP, useColors } from '@/theme';
import { RollText } from '@/ui/action-swap';
import { AgentDisclosure, DisclosureChevron } from '@/ui/agent-disclosure';
import { Button } from '@/ui/button';
import { EASE_OUT } from '@/ui/motion';

// initial { opacity: 0, y: 4 } → { opacity: 1, y: 0 }, exit { opacity: 0 }, 0.22s EASE_OUT (0.12s, no y, reduced).
const actionsIn: EntryExitAnimationFunction = () => {
  'worklet';
  const t = { duration: 220, easing: EASE_OUT };
  return { initialValues: { opacity: 0, transform: [{ translateY: 4 }] }, animations: { opacity: withTiming(1, t), transform: [{ translateY: withTiming(0, t) }] } };
};
const actionsOut: EntryExitAnimationFunction = () => {
  'worklet';
  return { initialValues: { opacity: 1 }, animations: { opacity: withTiming(0, { duration: 220, easing: EASE_OUT }) } };
};

export function ToolApproval({ tool, summary, detail, onApprove, onDeny, onAlways, resolved }: {
  tool: string;
  summary: string;
  detail: string;
  onApprove: () => void;
  onDeny: () => void;
  onAlways?: () => void;
  resolved?: 'approved' | 'denied';
}) {
  const c = useColors();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(!resolved);
  const [prevResolved, setPrevResolved] = useState(resolved);
  if (prevResolved !== resolved) {
    setPrevResolved(resolved);
    if (resolved) setOpen(false);
  }
  const tone = resolved === 'approved' ? c.sage : resolved === 'denied' ? c.danger : c.codeChip;
  const status = resolved === 'approved' ? 'Approved' : resolved === 'denied' ? 'Denied' : 'Approval required';

  return (
    <View style={{ width: '100%', overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16 }}>
        <View importantForAccessibility="no" style={{ marginTop: 2, width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg }}>
          <Icon name={resolved === 'approved' ? 'check' : resolved === 'denied' ? 'close' : 'shield'} size={16} color={c.muted} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text accessibilityRole="header" style={{ fontFamily: font.medium, fontSize: fs.sm, lineHeight: 20, color: c.text }}>{summary}</Text>
              <Text numberOfLines={1} style={{ marginTop: 2, fontFamily: font.mono, fontSize: fs.xs, color: c.muted }}>{tool}</Text>
            </View>
            <View accessibilityLiveRegion="polite" style={{ borderRadius: 999, borderWidth: 1, borderColor: `${tone}4d`, backgroundColor: `${tone}1a`, paddingHorizontal: 8, paddingVertical: 2 }}>
              <RollText value={status} style={{ fontFamily: font.medium, fontSize: 11, color: tone }}>{status}</RollText>
            </View>
          </View>
          <Pressable
            onPress={() => setOpen(!open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            hitSlop={12}
            style={{ marginTop: 8, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Text style={{ fontFamily: font.medium, fontSize: fs.xs, color: c.muted }}>View details</Text>
            <DisclosureChevron open={open} color={c.muted} />
          </Pressable>
        </View>
      </View>

      <AgentDisclosure open={open}>
        <View style={{ marginHorizontal: 16, marginBottom: 16, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface3, paddingHorizontal: 10, paddingVertical: 8 }}>
          <Text selectable style={{ fontFamily: font.mono, fontSize: fs.xs, lineHeight: 20, color: c.text }}>{detail}</Text>
        </View>
      </AgentDisclosure>

      {!resolved ? (
        <Animated.View entering={reduce ? undefined : actionsIn} exiting={actionsOut} style={{ gap: 4, borderTopWidth: 1, borderTopColor: c.border, paddingHorizontal: 16, paddingTop: 12, paddingBottom: onAlways ? 4 : 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Deny" onPress={onDeny} pressScale={0.97} hitSlop={0} style={{ flex: 1, height: TAP, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg }}>
              <Text style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.text }}>Deny</Text>
            </Button>
            <Button label="Allow once" onPress={onApprove} pressScale={0.97} hitSlop={0} style={{ flex: 1, height: TAP, borderRadius: 12, backgroundColor: c.text }}>
              <Text style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.bg }}>Allow once</Text>
            </Button>
          </View>
          {onAlways ? (
            <Button label="Always allow" onPress={onAlways} pressScale={0.97} hitSlop={0} style={{ height: TAP }}>
              <Text style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.muted }}>Always allow</Text>
            </Button>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}
