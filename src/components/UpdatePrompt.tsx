// Offers a newer release as soon as Neru opens: the illustrated hero, the release notes, and one tap to download
// the new APK. "Later" hides that version until the next one ships. After installing, What's New takes over.
import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { appVersion, Hero } from '@/components/WhatsNew';
import { updateSettings, useStore } from '@/store';
import { font, fs, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';
import { checkForUpdate, type Update } from '@/update';

// Release bodies are Markdown; the sheet shows the bullet points as plain lines.
const highlights = (md: string) =>
  md
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- '))
    .map(l => l.slice(2).replace(/\*\*(.+?)\*\*/g, '$1').replace(/[*_`]/g, ''))
    .slice(0, 6);

export function UpdatePrompt() {
  const c = useColors();
  const onboarded = useStore(s => s.settings.onboarded);
  const skipped = useStore(s => s.settings.skippedUpdate);
  // What's New for the running version comes first; the update offer waits until it is dismissed.
  const caughtUp = useStore(s => s.settings.seenVersion === appVersion);
  const [update, setUpdate] = useState<Update | null>(null);

  useEffect(() => {
    if (onboarded) void checkForUpdate().then(setUpdate);
  }, [onboarded]);

  const open = !!update && caughtUp && update.version !== skipped;
  const later = () => update && updateSettings({ skippedUpdate: update.version });
  const install = () => {
    if (!update) return;
    void Linking.openURL(update.url);
    setUpdate(null);
  };

  return (
    <BottomSheet open={open} onClose={later}>
      {update ? (
        <View style={{ gap: 20, paddingBottom: 8 }}>
          <Hero version={update.version} />
          <View style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.serif, fontSize: 34, lineHeight: 40, color: c.text }}>A new Neru is ready</Text>
            <Text style={{ fontFamily: font.sans, fontSize: fs.base, color: c.secondary, lineHeight: 23 }}>
              {update.title} is out. Download it to get the newest features; your chats and settings stay as they are.
            </Text>
          </View>
          {highlights(update.notes).map(line => (
            <View key={line} style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 8, backgroundColor: c.moss }} />
              <Text style={{ flex: 1, fontFamily: font.sans, fontSize: fs.sm, color: c.secondary, lineHeight: 21 }}>{line}</Text>
            </View>
          ))}
          <View style={{ gap: 4 }}>
            <ActionButton title="Update now" icon="download" onPress={install} />
            <ActionButton title="Later" variant="ghost" onPress={later} />
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}
