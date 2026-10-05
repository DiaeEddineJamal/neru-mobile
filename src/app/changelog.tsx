import { ScrollView, StyleSheet, Text, View } from 'react-native';

import releases from '@/changelog.json';
import { appVersion, Hero, ReleaseItems } from '@/components/WhatsNew';
import { font, fs, useColors } from '@/theme';

/** Every release, newest first; the same data the What's New sheet shows. */
export default function Changelog() {
  const c = useColors();
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, gap: 32, paddingBottom: 48 }}>
      {/* The same illustrated hero the update sheet opens with. */}
      <Hero version={releases[0].version} />
      {releases.map(r => (
        <View key={r.version} style={{ gap: 14 }}>
          <Text style={{ fontFamily: font.medium, fontSize: fs.xs, color: c.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            {r.version}
            {r.version === appVersion ? ' · this version' : ''} · {r.date}
          </Text>
          <Text accessibilityRole="header" style={[s.title, { color: c.text }]}>{r.title}</Text>
          <Text style={{ fontFamily: font.sans, fontSize: fs.base, color: c.secondary, lineHeight: 23 }}>{r.summary}</Text>
          <ReleaseItems release={r} stagger={false} />
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({ title: { fontFamily: font.serif, fontSize: 30, lineHeight: 36 } });
