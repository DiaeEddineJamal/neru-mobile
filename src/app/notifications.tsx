// Settings → Notifications: the phone's permission, then one switch per kind of note Neru posts.
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Text } from 'react-native';

import { t } from '@/i18n';
import { askForNotifications, setNotifyPref, useNotifyPrefs, type NotifyKind } from '@/notify';
import { updateSettings, useStore } from '@/store';
import { font, fs, useColors } from '@/theme';
import type { IconName } from '@/components/Icon';
import { Card, Group, PageScroll, PillButton, Row, SectionLabel } from '@/ui/page';

const kinds: { kind: NotifyKind; icon: IconName; title: string; subtitle: string }[] = [
  { kind: 'replies', icon: 'chat', title: 'Replies', subtitle: 'Get notified when Neru finishes a reply while you are away' },
  { kind: 'approvals', icon: 'permission', title: 'Desktop approvals', subtitle: 'Get notified when a desktop session needs your approval to use a tool' },
  { kind: 'desktop', icon: 'desktop', title: 'Desktop sessions', subtitle: 'Get notified when a desktop session finishes its run' },
  { kind: 'tasks', icon: 'clock', title: 'Queued tasks', subtitle: 'Get notified when queued desktop tasks finish, stop or are canceled' },
  { kind: 'teams', icon: 'team', title: 'Team tasks', subtitle: 'Get notified when a team finishes working or runs into a problem' },
  { kind: 'digest', icon: 'sun', title: 'Morning summary', subtitle: 'One note the morning after queued work runs overnight' },
];

export default function NotificationsPage() {
  const c = useColors();
  const prefs = useNotifyPrefs();
  const nudges = useStore(s => s.settings.nudges);
  const [granted, setGranted] = useState<boolean | null>(null);
  // Checked again on every visit: the user may have changed it in the phone's settings.
  useFocusEffect(useCallback(() => void Notifications.getPermissionsAsync().then(p => setGranted(p.granted)), []));

  const allow = async () => {
    const p = await Notifications.getPermissionsAsync();
    if (!p.granted && p.canAskAgain) setGranted(await askForNotifications());
    else void Linking.openSettings();
  };

  return (
    <PageScroll>
      {granted === false ? (
        <Card style={{ gap: 12 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.text }}>{t('Notifications are off')}</Text>
          <Text style={{ fontFamily: font.medium, fontSize: fs.base, lineHeight: 21, color: c.muted }}>{t('Neru can’t post anything until you allow notifications for it on this phone.')}</Text>
          <PillButton label={t('Allow notifications')} icon="bell" onPress={() => void allow()} style={{ alignSelf: 'flex-start', height: 48 }} />
        </Card>
      ) : null}
      <Group>
        {kinds.map(k => (
          <Row key={k.kind} icon={k.icon} title={t(k.title)} subtitle={t(k.subtitle)} toggle={{ value: prefs[k.kind], onChange: v => setNotifyPref(k.kind, v) }} disabled={granted === false} />
        ))}
      </Group>
      <SectionLabel>{t('From Neru')}</SectionLabel>
      <Group>
        <Row icon="sparkles" title={t('Check-ins')} subtitle={t('A friendly note now and then, never more than one every couple of days')} toggle={{ value: nudges, onChange: v => updateSettings({ nudges: v }) }} disabled={granted === false} />
      </Group>
      <Text style={{ fontFamily: font.sans, fontSize: fs.sm, lineHeight: 20, color: c.muted, paddingHorizontal: 16 }}>
        {t('Neru stays quiet while it is open on screen. Notes come only when something you started finishes or needs you after you leave.')}
      </Text>
    </PageScroll>
  );
}
