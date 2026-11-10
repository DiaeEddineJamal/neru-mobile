// Memory: what Neru remembers about the user from past chats (viewable and editable), how it is made, and the
// switches for generating memory and for searching past chats.
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Markdown } from '@/components/Markdown';
import { t } from '@/i18n';
import { cancelMemoryUpdate, resetMemory, setMemoryText, updateMemoryNow, useMemory } from '@/memory';
import { formatWhen } from '@/projects/format';
import { updateSettings, useStore } from '@/store';
import { font, fs, useColors } from '@/theme';
import { ActionButton } from '@/ui/button-base';
import { confirm, notice } from '@/ui/confirm';
import { Card, Field, Group, PageScroll, Row, SectionLabel } from '@/ui/page';

export default function MemoryPage() {
  const c = useColors();
  const { text, updatedAt, running } = useMemory();
  const memoryOn = useStore(s => s.settings.memory !== false);
  const searchOn = useStore(s => s.settings.searchChats !== false);
  const onDevice = useStore(s => s.settings.providerId === 'on-device');
  const [draft, setDraft] = useState<string | null>(null);

  const updating = running?.scope === 'global';
  const progress = !updating ? '' : running.phase.startsWith('writing:') ? t('Writing… {n} characters', { n: running.phase.slice(8) }) : t('Reading your chats…');

  const update = async () => {
    try {
      const changed = await updateMemoryNow();
      if (!changed) void notice({ title: t('Nothing to learn yet'), message: t('Memory is built from your chats. Chat a little first, outside incognito.'), icon: 'brain' });
    } catch (e) {
      void notice({ title: t('Could not update memory'), message: e instanceof Error ? e.message : String(e) });
    }
  };
  const reset = async () => {
    const ok = await confirm({
      title: t('Reset memory?'),
      message: t('Neru will forget everything in this memory. Your chats are kept, and new memory is built only from chats after now.'),
      action: t('Reset memory'),
      destructive: true,
    });
    if (ok) {
      resetMemory();
      setDraft(null);
    }
  };

  return (
    <PageScroll>
      <Text style={{ fontFamily: font.sans, fontSize: fs.base, lineHeight: 23, color: c.secondary, paddingHorizontal: 4 }}>
        {t('Neru remembers useful facts from your chats, like your work, your preferences and your projects, and uses them in new chats. Incognito chats and chats with memory turned off are never used. You can edit or reset it at any time.')}
      </Text>

      <Group>
        <Row icon="brain" title={t('Generate memory from chat history')} subtitle={t('Learn from your past chats and use that in new ones.')} toggle={{ value: memoryOn, onChange: v => updateSettings({ memory: v }) }} />
        <Row icon="history" title={t('Search and reference chats')} subtitle={t('Let Neru look up relevant past chats when it helps.')} toggle={{ value: searchOn, onChange: v => updateSettings({ searchChats: v }) }} />
      </Group>

      <SectionLabel>{t('Memory')}</SectionLabel>
      {draft !== null ? (
        <View style={{ gap: 10 }}>
          <Field value={draft} onChangeText={setDraft} multiline autoFocus placeholder={t('Facts about you, one per line.')} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <ActionButton title={t('Cancel')} variant="ghost" onPress={() => setDraft(null)} style={{ flex: 1 }} />
            <ActionButton title={t('Save')} onPress={() => (setMemoryText(draft), setDraft(null))} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <Card onPress={updating ? undefined : () => setDraft(text)}>
          {/* Memory is written in Markdown (headings, lists, bold): shown rendered here, as source while editing. */}
          {text ? (
            <Markdown text={text} />
          ) : (
            <Text style={{ fontFamily: font.sans, fontSize: fs.base, lineHeight: 23, color: c.muted }}>{t('Nothing remembered yet. Memory is written from your chats as you use Neru.')}</Text>
          )}
          <Text style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.muted, marginTop: 6 }}>{t('Last updated: {when}', { when: formatWhen(updatedAt) })}</Text>
          {!updating ? <Text style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.muted }}>{t('Tap to edit')}</Text> : null}
        </Card>
      )}

      <View style={{ gap: 6 }}>
        <ActionButton title={updating ? progress : t('Update memory now')} icon="retry" variant="secondary" loading={updating && !running.phase.startsWith('writing:')} disabled={!!running || draft !== null} onPress={() => void update()} />
        {updating ? <ActionButton title={t('Stop')} variant="ghost" onPress={cancelMemoryUpdate} /> : null}
        <Text style={{ fontFamily: font.medium, fontSize: fs.sm, lineHeight: 20, color: c.muted, paddingHorizontal: 4 }}>
          {onDevice
            ? t('Your model runs on this phone, so memory updates only when you tap Update memory now.')
            : t('Memory also updates by itself every few hours while you chat, using your current model.')}
        </Text>
      </View>

      <Group style={{ marginTop: 8 }}>
        <Row icon="trash" title={t('Reset memory')} destructive chevron={false} disabled={!!running} onPress={() => void reset()} />
      </Group>
    </PageScroll>
  );
}
