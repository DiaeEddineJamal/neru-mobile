// Offers a newer release as soon as Neru opens: the illustrated hero, the release notes, and one tap that downloads
// the new APK in the app and opens Android's installer. "Later" hides that version until the next one ships. After
// installing, What's New takes over.
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { appVersion, Hero } from '@/components/WhatsNew';
import { updateSettings, useStore } from '@/store';
import { font, fs, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';
import { checkForUpdate, installUpdate, offerUpdate, useOfferedUpdate } from '@/update';
import { t } from '@/i18n';

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
  const update = useOfferedUpdate();

  useEffect(() => {
    if (onboarded) void checkForUpdate().then(offerUpdate);
  }, [onboarded]);

  // null before a tap; 0–1 while the APK downloads; 'ready' once Android's installer was opened.
  const [progress, setProgress] = useState<number | 'ready' | null>(null);
  const [error, setError] = useState('');
  const open = !!update && caughtUp && update.version !== skipped;
  const later = () => update && progress === null && updateSettings({ skippedUpdate: update.version });
  const install = async () => {
    if (!update) return;
    setError('');
    setProgress(0);
    try {
      await installUpdate(update, setProgress);
      setProgress('ready');
    } catch (e) {
      setProgress(null);
      setError(t('The download stopped ({reason}). Tap Update now to try again.', { reason: e instanceof Error ? e.message : String(e) }));
    }
  };
  const downloading = typeof progress === 'number';

  return (
    <BottomSheet open={open} onClose={later}>
      {update ? (
        <View style={{ gap: 20, paddingBottom: 8 }}>
          <Hero version={update.version} />
          <View style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.serif, fontSize: 34, lineHeight: 40, color: c.text }}>{t('A new Neru is ready')}</Text>
            <Text style={{ fontFamily: font.sans, fontSize: fs.base, color: c.secondary, lineHeight: 23 }}>
              {t('{title} is out. Download it to get the newest features; your chats and settings stay as they are.', { title: update.title })}
            </Text>
          </View>
          {highlights(update.notes).map(line => (
            <View key={line} style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 8, backgroundColor: c.moss }} />
              <Text style={{ flex: 1, fontFamily: font.sans, fontSize: fs.sm, color: c.secondary, lineHeight: 21 }}>{line}</Text>
            </View>
          ))}
          {downloading ? <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }} style={{ height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: c.surface3 }}><View style={{ width: `${Math.round(progress * 100)}%`, height: '100%', backgroundColor: c.moss }} /></View> : null}
          {error ? <Text accessibilityRole="alert" style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.danger, lineHeight: 21 }}>{error}</Text> : null}
          <View style={{ gap: 4 }}>
            <ActionButton
              title={downloading ? t('Downloading… {n}%', { n: Math.round(progress * 100) }) : progress === 'ready' ? t('Install') : t('Update now')}
              icon={downloading ? undefined : 'download'}
              disabled={downloading}
              onPress={() => void install()}
            />
            {!downloading ? <ActionButton title={t('Later')} variant="ghost" onPress={() => (progress === 'ready' ? offerUpdate(null) : later())} /> : null}
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}
