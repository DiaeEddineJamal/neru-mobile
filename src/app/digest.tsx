// "While you were away": what the desktop's sessions did since you last looked, what needs you, and what it cost.
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { kvGetSync, kvSet } from '@/db';
import { t } from '@/i18n';
import { loadDigest, useRemote } from '@/remote/store';
import type { Digest, DigestItem } from '@/shared/types';
import { font, fs, useBottomPad, useColors } from '@/theme';
import { AnimatedBadge } from '@/ui/animated-badge';
import { ActionButton } from '@/ui/button-base';
import { Bone, Skeleton } from '@/ui/skeleton';
import { dollars, referenceCost, REFERENCE } from '@/usage';

const SEEN = 'digest.seen';
/** Since the last "Mark as read", or the last 12 hours the first time. */
const since = () => Number(kvGetSync(SEEN) ?? 0) || Date.now() - 12 * 3600_000;
const ago = (ms: number) => {
  const h = Math.round((Date.now() - ms) / 3600_000);
  return h <= 1 ? t('the last hour') : h < 24 ? t('the last {n} hours', { n: h }) : t('the last {n} days', { n: Math.round(h / 24) });
};

export default function WhileAway() {
  const c = useColors();
  const bottomPad = useBottomPad();
  const connected = useRemote(s => s.status === 'connected');
  const [from, setFrom] = useState(since);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((at: number) => {
    loadDigest(at).then(d => (setDigest(d), setError(null))).catch(err => setError(String(err?.message ?? err)));
  }, []);
  useEffect(() => {
    if (connected) load(from);
  }, [connected, from, load]);

  const markRead = () => {
    const now = Date.now();
    void kvSet(SEEN, String(now));
    setFrom(now);
  };

  const card = (i: DigestItem) => {
    const badge = { done: ['done', t('Done')], waiting: ['waiting', t('Needs you')], failed: ['failed', t('Stopped')], running: ['running', t('Running')] } as const;
    const [status, label] = badge[i.status];
    const facts = [i.edits ? (i.edits === 1 ? t('1 change') : t('{n} changes', { n: i.edits })) : '', i.commands ? (i.commands === 1 ? t('1 command') : t('{n} commands', { n: i.commands })) : '', i.failedCommands ? t('{n} failed', { n: i.failedCommands }) : ''].filter(Boolean).join(' · ');
    return (
      <Pressable key={i.sessionId} onPress={() => router.push(`/desktop/${i.sessionId}`)} accessibilityRole="button" style={[s.card, { backgroundColor: c.surface2, borderColor: i.status === 'waiting' ? c.codeChip : c.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text numberOfLines={2} style={{ fontFamily: font.semibold, fontSize: fs.base, color: c.text }}>{i.title}</Text>
            <Text style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>{i.project}{i.queued ? ` · ${t('from your queue')}` : ''}</Text>
          </View>
          <AnimatedBadge status={status} label={label} />
        </View>
        {i.summary ? <Text numberOfLines={4} style={{ fontFamily: font.sans, fontSize: fs.sm, lineHeight: 20, color: c.secondary }}>{i.summary}</Text> : null}
        {facts ? <Text style={{ fontFamily: font.medium, fontSize: fs.xs, color: i.failedCommands ? c.danger : c.muted }}>{facts}</Text> : null}
      </Pressable>
    );
  };

  const items = digest?.items ?? [];
  const needs = items.filter(i => i.status === 'waiting');
  const saved = digest ? referenceCost(digest.usage.free) : 0;

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottomPad + 36 }}>
      <Text style={{ fontFamily: font.serif, fontSize: 30, lineHeight: 36, color: c.text }}>
        {!digest ? t('While you were away') : items.length ? (items.length === 1 ? t('1 session moved in {period}', { period: ago(from) }) : t('{n} sessions moved in {period}', { n: items.length, period: ago(from) })) : t('Quiet in {period}', { period: ago(from) })}
      </Text>
      {digest && needs.length ? <Text style={{ fontFamily: font.medium, fontSize: fs.base, color: c.codeChip }}>{needs.length === 1 ? t('1 session waiting for your approval') : t('{n} sessions waiting for your approval', { n: needs.length })}</Text> : null}
      {!connected ? <Text style={{ fontFamily: font.sans, fontSize: fs.base, color: c.secondary }}>{t('Your desktop is offline. Open Neru there to see what it did.')}</Text> : null}
      {error ? <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.danger }}>{error}</Text> : null}
      {connected && !digest && !error ? (
        <Skeleton label={t('Loading the summary')} style={{ gap: 10 }}>
          <Bone height={96} radius={16} />
          <Bone height={96} radius={16} />
        </Skeleton>
      ) : null}
      {[...needs, ...items.filter(i => i.status !== 'waiting')].map(card)}
      {digest ? (
        <View style={[s.card, { backgroundColor: c.surface2, borderColor: c.border }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: fs.base, color: c.text }}>{t('Spent on your desktop: $0.00')}</Text>
          <Text style={{ fontFamily: font.sans, fontSize: fs.sm, lineHeight: 20, color: c.secondary }}>
            {t('The same work on {model} would have cost about {cost} so far.', { model: REFERENCE.name, cost: dollars(saved) })}{digest.usage.paid.replies ? ` ${digest.usage.paid.replies === 1 ? t('1 reply used your paid keys.') : t('{n} replies used your paid keys.', { n: digest.usage.paid.replies })}` : ''}
          </Text>
        </View>
      ) : null}
      {digest && items.length ? <ActionButton title={t('Mark as read')} variant="secondary" icon="check" onPress={markRead} /> : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  card: { gap: 8, padding: 16, borderRadius: 16, borderWidth: 1 },
});
