// "What's new", shown once per version after an update, in the style of Claude's model and feature
// announcements: an illustrated hero, a "New" badge, a serif headline, one short pitch, the highlights,
// and a single primary action.
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import releases from '@/changelog.json';
import { Icon, type IconName } from '@/components/Icon';
import { updateSettings, useStore } from '@/store';
import { font, fs, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';

export const appVersion = Constants.expoConfig?.version ?? '0.0.0';
export type Release = (typeof releases)[number];

export function Hero({ version }: { version: string }) {
  const c = useColors();

  return (
    <View style={s.hero}>
      <Image source={require('@/assets/images/whats-new-parchment.png')} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel="Neru in a landscape of layered paper hills on warm parchment" accessibilityIgnoresInvertColors />
      <View style={[s.newPill, { backgroundColor: c.onAction }]}>
        <Text style={{ fontFamily: font.semibold, fontSize: fs.xs, color: '#344a39', letterSpacing: 0.4 }}>NEW · {version}</Text>
      </View>
    </View>
  );
}

export function ReleaseItems({ release, stagger = true }: { release: Release; stagger?: boolean }) {
  const c = useColors();
  const reduce = useReducedMotion();
  return (
    <View style={{ gap: 16 }}>
      {release.items.map((item, i) => (
        <Animated.View key={item.title} entering={stagger && !reduce ? FadeInDown.delay(200 + i * 70).springify() : undefined} style={s.item}>
          <View style={[s.itemIcon, { backgroundColor: c.surface3 }]}>
            <Icon name={item.icon as IconName} size={20} color={c.moss} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: font.semibold, fontSize: fs.base, color: c.text }}>{item.title}</Text>
            <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.secondary, lineHeight: 20 }}>{item.text}</Text>
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

/** Opens by itself after an update; new installs see onboarding instead. */
export function WhatsNew() {
  const c = useColors();
  const seen = useStore(s => s.settings.seenVersion);
  const onboarded = useStore(s => s.settings.onboarded);
  const release = releases.find(r => r.version === appVersion) ?? releases[0];
  const open = onboarded && seen !== appVersion && !!release;
  const close = () => updateSettings({ seenVersion: appVersion });

  return (
    <BottomSheet open={open} onClose={close}>
      <View style={{ gap: 20, paddingBottom: 8 }}>
        <Hero version={release.version} />
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={[s.title, { color: c.text }]}>{release.title}</Text>
          <Text style={{ fontFamily: font.sans, fontSize: fs.base, color: c.secondary, lineHeight: 23 }}>{release.summary}</Text>
        </View>
        <ReleaseItems release={release} />
        <View style={{ gap: 4 }}>
          <ActionButton title="Got it" onPress={close} />
          <ActionButton title="See all updates" variant="ghost" onPress={() => (close(), router.push('/changelog'))} />
        </View>
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  hero: { aspectRatio: 2, borderRadius: 20, overflow: 'hidden', backgroundColor: '#f4e8d3' },
  newPill: { position: 'absolute', top: 14, left: 14, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  title: { fontFamily: font.serif, fontSize: 34, lineHeight: 40 },
  item: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  itemIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
