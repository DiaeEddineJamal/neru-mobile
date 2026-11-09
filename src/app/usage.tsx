// Settings → Usage: tokens by provider and model today and this week, what the free tiers allow, and what the same
// work would have cost on a paid model.
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { t } from '@/i18n';
import { desktopUsage, useRemote } from '@/remote/store';
import { providerPresets } from '@/shared/providerCatalog';
import type { UsageTotals } from '@/shared/types';
import { modelLabel, useStore } from '@/store';
import { font, fs, useColors } from '@/theme';
import { confirm } from '@/ui/confirm';
import { EASE_OUT } from '@/ui/motion';
import { Card, EmptyState, Group, PageScroll, Row, SectionLabel } from '@/ui/page';
import { dollars, referenceCost, REFERENCE, resetUsage, tokens, usageByModel, useUsage, useUsageLog, type ModelUsage } from '@/usage';

const providerName = (id: string) => (id === 'on-device' ? 'Pocket Lab' : providerPresets.find(p => p.id === id)?.name ?? id);

/** A thin bar: accent fill on the raised gray track, eased in from zero. */
function Bar({ share }: { share: number }) {
  const c = useColors();
  const w = useSharedValue(0);
  useEffect(() => w.set(withTiming(Math.max(0, Math.min(1, share)), { duration: 600, easing: EASE_OUT })), [share, w]);
  const fill = useAnimatedStyle(() => ({ width: `${w.get() * 100}%` }));
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: c.surface3, overflow: 'hidden' }}>
      <Animated.View style={[{ height: 8, borderRadius: 4, backgroundColor: c.mossAction }, fill]} />
    </View>
  );
}

function Period({ title, rows }: { title: string; rows: ModelUsage[] }) {
  const c = useColors();
  const settings = useStore(s => s.settings);
  const total = rows.reduce((n, r) => n + r.input + r.output, 0);
  const replies = rows.reduce((n, r) => n + r.replies, 0);
  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
        <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: fs.lg, color: c.text }}>{title}</Text>
        <Text style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.muted }}>{t('{tokens} tokens', { tokens: tokens(total) })}</Text>
      </View>
      {rows.length ? (
        rows.slice(0, 6).map(r => (
          <View key={`${r.providerId}\n${r.model}`} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.medium, fontSize: fs.base, color: c.text }}>{modelLabel({ ...settings, providerId: r.providerId, model: r.model })}</Text>
              <Text style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.muted }}>{tokens(r.input + r.output)}</Text>
            </View>
            <Bar share={total ? (r.input + r.output) / total : 0} />
            <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.muted }}>
              {[providerName(r.providerId), r.free ? t('Free') : t('Paid key'), r.replies === 1 ? t('1 reply') : t('{n} replies', { n: r.replies })].join(' · ')}
            </Text>
          </View>
        ))
      ) : (
        <Text style={{ fontFamily: font.medium, fontSize: fs.base, color: c.muted }}>{t('No replies yet')}</Text>
      )}
      {rows.length > 6 ? <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.muted }}>{t('and {n} more models', { n: rows.length - 6 })}</Text> : null}
      {replies ? <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.muted }}>{replies === 1 ? t('1 reply in all') : t('{n} replies in all', { n: replies })}</Text> : null}
    </Card>
  );
}

export default function UsagePage() {
  const c = useColors();
  const usage = useUsage();
  const log = useUsageLog();
  const keyed = useStore(s => s.keyed);
  const connected = useRemote(s => s.status === 'connected');
  const [desk, setDesk] = useState<UsageTotals | null>(null);
  useEffect(() => { if (connected) desktopUsage().then(setDesk).catch(() => setDesk(null)); }, [connected]);

  const today = usageByModel(log, 1);
  const week = usageByModel(log, 7);
  const freeTokens = usage.free.input + usage.free.output + (desk ? desk.free.input + desk.free.output : 0);
  const saved = referenceCost(usage.free) + (desk ? referenceCost(desk.free) : 0);
  // The free allowance of every saved key, as each provider publishes it.
  const limits = providerPresets.filter(p => p.freeLimit && keyed.includes(p.id));

  return (
    <PageScroll>
      {!week.length && !usage.free.replies && !usage.paid.replies ? <EmptyState icon="gauge" title={t('Nothing used yet')} hint={t('Token counts show up here after your first reply.')} /> : null}
      <Period title={t('Today')} rows={today} />
      <Period title={t('This week')} rows={week} />

      <SectionLabel>{t('Spent')}</SectionLabel>
      <Card accent>
        <Text style={{ fontFamily: font.title, fontSize: 40, lineHeight: 48, color: c.text }}>$0.00</Text>
        <Text style={{ fontFamily: font.sans, fontSize: fs.base, lineHeight: 22, color: c.secondary }}>
          {freeTokens
            ? desk
              ? t('{tokens} tokens on free models, here and on your desktop. On {model} that would have cost about {cost}.', { tokens: tokens(freeTokens), model: t(REFERENCE.name), cost: dollars(saved) })
              : t('{tokens} tokens on free models. On {model} that would have cost about {cost}.', { tokens: tokens(freeTokens), model: t(REFERENCE.name), cost: dollars(saved) })
            : t('Chats on free keys and Pocket Lab models cost nothing. Neru counts what the same tokens would cost on {model}.', { model: t(REFERENCE.name) })}
        </Text>
        {usage.paid.replies ? (
          <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.muted }}>
            {usage.paid.replies === 1
              ? t('1 reply used your paid keys ({tokens} tokens), billed by those providers.', { tokens: tokens(usage.paid.input + usage.paid.output) })
              : t('{n} replies used your paid keys ({tokens} tokens), billed by those providers.', { n: usage.paid.replies, tokens: tokens(usage.paid.input + usage.paid.output) })}
          </Text>
        ) : null}
      </Card>

      <SectionLabel>{t('Limits')}</SectionLabel>
      <Card>
        <Text style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.text }}>{t('Neru has no limits of its own')}</Text>
        <Text style={{ fontFamily: font.medium, fontSize: fs.base, lineHeight: 21, color: c.muted }}>
          {t('Each provider’s free tier sets the pace. When a model runs out, Neru moves to the next free model on your keys, and Pocket Lab models never run out.')}
        </Text>
        {limits.map(p => (
          <View key={p.id} style={{ flexDirection: 'row', gap: 10, paddingTop: 6 }}>
            <Text style={{ fontFamily: font.semibold, fontSize: fs.sm, color: c.text, minWidth: 96 }}>{p.name}</Text>
            <Text style={{ flex: 1, fontFamily: font.sans, fontSize: fs.sm, color: c.muted }}>{t(p.freeLimit!)}</Text>
          </View>
        ))}
      </Card>

      <Group>
        <Row
          icon="retry"
          title={t('Reset the counters')}
          subtitle={t('Token totals and the daily log on this phone start again from zero')}
          onPress={async () => { if (await confirm({ title: t('Reset the counters?'), message: t('The token totals on this phone start again from zero.'), action: t('Reset') })) resetUsage(); }}
          chevron={false}
        />
      </Group>
    </PageScroll>
  );
}
