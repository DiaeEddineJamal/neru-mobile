// The compact card shown in a reply for each artifact; tapping it opens the viewer on that exact version.
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { displayTitle, KIND_ICON, kindLabel } from '@/artifacts/kinds';
import { artifactKey, isStreaming } from '@/artifacts/library';
import type { Artifact } from '@/artifacts/parse';
import { Icon } from '@/components/Icon';
import { t } from '@/i18n';
import { useStore } from '@/store';
import { font, fs, useColors } from '@/theme';
import { Squish } from '@/ui/page';

/** The card shown in the conversation for an artifact; tapping it opens the viewer. */
export function ArtifactCard({ artifact, chatId, messageId }: { artifact: Artifact; chatId: string | null; messageId: string }) {
  const c = useColors();
  const live = useStore(s => isStreaming(s, chatId, messageId));
  // An unclosed tag in a finished reply is shown as done: the model just forgot to close it.
  const writing = artifact.open && live;
  const title = displayTitle(artifact);
  const lines = artifact.content ? artifact.content.split('\n').length : 0;
  const detail = writing
    ? t('Writing…')
    : artifact.kind === 'code' && artifact.language
      ? `${artifact.language} · ${t('Tap to open')}`
      : `${kindLabel(artifact.kind)} · ${t('Tap to open')}`;
  return (
    <Squish
      onPress={() => router.push(`/artifact/${encodeURIComponent(artifactKey(chatId, artifact.id, messageId))}` as Href)}
      accessibilityLabel={`${title}, ${kindLabel(artifact.kind)}${writing ? `, ${t('Writing…')}` : ''}`}
      style={[s.card, { backgroundColor: c.surface2, borderColor: c.border }]}
    >
      <View style={[s.chip, { backgroundColor: c.surface3 }]}>
        <Icon name={KIND_ICON[artifact.kind]} size={22} color={c.text} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.text }}>{title}</Text>
        {writing ? (
          <Shimmer text={lines > 1 ? `${detail} ${t('{n} lines', { n: lines })}` : detail} color={c.muted} />
        ) : (
          <Text numberOfLines={1} style={[s.detail, { color: c.muted }]}>{detail}</Text>
        )}
      </View>
      <Icon name="chevronRight" size={20} color={c.muted} />
    </Squish>
  );
}

function Shimmer({ text, color }: { text: string; color: string }) {
  const reduce = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduce) return;
    pulse.set(withRepeat(withTiming(0.45, { duration: 900 }), -1, true));
    return () => cancelAnimation(pulse);
  }, [pulse, reduce]);
  const anim = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  return (
    <Animated.Text numberOfLines={1} accessibilityLiveRegion="polite" style={[s.detail, { color }, anim]}>
      {text}
    </Animated.Text>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, marginVertical: 6, borderWidth: StyleSheet.hairlineWidth },
  chip: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  detail: { fontFamily: font.medium, fontSize: fs.sm },
});
