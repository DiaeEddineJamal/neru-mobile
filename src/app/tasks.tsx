// Tasks queued on the paired desktop: what waits for tonight, what runs now, and what ran this week.
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { t as tx } from '@/i18n';
import { cancelTask, useRemote } from '@/remote/store';
import type { QueuedTask } from '@/shared/types';
import { font, fs, TAP, useBottomPad, useColors } from '@/theme';
import { AnimatedBadge } from '@/ui/animated-badge';
import { ActionButton } from '@/ui/button-base';
import { confirm } from '@/ui/confirm';
import { useToast } from '@/ui/toast';

const baseName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
const when = (ms: number) => {
  const d = new Date(ms);
  const today = new Date();
  const day = d.toDateString() === today.toDateString() ? tx('Today') : d.getTime() - today.getTime() < 2 * 86400_000 && d > today ? tx('Tomorrow') : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

export default function Tasks() {
  const c = useColors();
  const toast = useToast();
  const bottomPad = useBottomPad();
  const queue = useRemote(s => s.queue);
  const connected = useRemote(s => s.status === 'connected');
  const waiting = queue.filter(t => t.status === 'queued' || t.status === 'running').sort((a, b) => a.at - b.at);
  const past = queue.filter(t => t.status !== 'queued' && t.status !== 'running').sort((a, b) => b.at - a.at);

  const cancel = async (t: QueuedTask) => {
    if (!(await confirm({ title: tx('Cancel this task?'), message: t.title, action: tx('Cancel task'), destructive: true }))) return;
    cancelTask(t.id).catch(err => toast.show({ title: tx('Could not cancel it'), description: String(err?.message ?? err) }));
  };

  const card = (t: QueuedTask) => {
    const badge = { queued: ['waiting', 'Queued'], running: ['running', 'Running'], waiting: ['waiting', 'Needs you'], done: ['done', 'Done'], failed: ['failed', 'Failed'], canceled: ['failed', 'Canceled'] } as const;
    const [status, label] = badge[t.status];
    return (
      <Pressable
        key={t.id}
        onPress={() => t.sessionId && router.push(`/desktop/${t.sessionId}`)}
        disabled={!t.sessionId}
        accessibilityRole="button"
        style={[s.card, { backgroundColor: c.surface2, borderColor: c.border }]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text numberOfLines={2} style={{ fontFamily: font.semibold, fontSize: fs.base, color: c.text }}>{t.title}</Text>
            <Text style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>
              {baseName(t.projectPath)} · {t.status === 'queued' ? tx('starts {time}', { time: when(t.at) }) : when(t.at)}
              {t.images ? ` · ${t.images === 1 ? tx('1 photo') : tx('{n} photos', { n: t.images })}` : ''}
            </Text>
          </View>
          <AnimatedBadge status={status} label={tx(label)} />
        </View>
        {t.error ? <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.danger, lineHeight: 20 }}>{t.error}</Text> : null}
        {t.status === 'queued' ? <ActionButton title={tx('Cancel')} variant="ghost" onPress={() => void cancel(t)} /> : null}
      </Pressable>
    );
  };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottomPad + 36 }}>
      <ActionButton title={tx('New task')} icon="plus" onPress={() => router.push('/task-new')} disabled={!connected} />
      <ActionButton title={tx('While you were away')} icon="sun" variant="secondary" onPress={() => router.push('/digest')} disabled={!connected} />
      <Text style={[s.section, { color: c.muted }]}>{tx('UP NEXT')}</Text>
      {waiting.length ? waiting.map(card) : (
        <View style={[s.empty, { borderColor: c.border }]}>
          <Icon name="moon" size={22} color={c.sage} />
          <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.secondary, textAlign: 'center', lineHeight: 20 }}>{tx('Queue big jobs for tonight. They start after free plans reset their daily quota, one at a time, and switch models when one runs out.')}</Text>
        </View>
      )}
      {past.length ? <Text style={[s.section, { color: c.muted }]}>{tx('THIS WEEK')}</Text> : null}
      {past.map(card)}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  section: { fontFamily: font.medium, fontSize: fs.xs, marginTop: 12 },
  card: { gap: 10, padding: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, minHeight: TAP },
  empty: { alignItems: 'center', gap: 8, padding: 20, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed' },
});
