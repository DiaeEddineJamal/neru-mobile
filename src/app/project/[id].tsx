// One project: its goal, custom instructions, project memory, its chats, and "+ New chat in project".
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { IconButton } from '@/components/Icon';
import { t } from '@/i18n';
import { updateProjectMemory, useMemory } from '@/memory';
import { setProjectArchived, updateProject, useProject } from '@/projects';
import { removeProject } from '@/projects/actions';
import { CreateProjectSheet } from '@/projects/CreateProjectSheet';
import { formatDay, formatWhen } from '@/projects/format';
import { setDraftChat, useStore } from '@/store';
import { font, fs, useBottomPad, useColors } from '@/theme';
import { ActionButton } from '@/ui/button-base';
import { notice } from '@/ui/confirm';
import { Card, EmptyState, Field, Group, PageScroll, PillButton, Row, SectionLabel } from '@/ui/page';

/** A card that shows a text, and turns into a field with Save and Cancel while editing. */
function EditableCard({ value, placeholder, hint, onSave, footer }: { value: string; placeholder: string; hint?: string; onSave: (text: string) => void; footer?: ReactNode }) {
  const c = useColors();
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null)
    return (
      <View style={{ gap: 10 }}>
        <Field value={draft} onChangeText={setDraft} placeholder={placeholder} multiline autoFocus />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <ActionButton title={t('Cancel')} variant="ghost" onPress={() => setDraft(null)} style={{ flex: 1 }} />
          <ActionButton title={t('Save')} onPress={() => (onSave(draft.trim()), setDraft(null))} style={{ flex: 1 }} />
        </View>
      </View>
    );
  return (
    <Card onPress={() => setDraft(value)}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <Text style={{ flex: 1, fontFamily: font.sans, fontSize: fs.base, lineHeight: 23, color: value ? c.text : c.muted }}>{value || placeholder}</Text>
        <IconButton name="pencil" label={t('Edit')} color={c.secondary} size={20} onPress={() => setDraft(value)} />
      </View>
      {hint ? <Text style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.muted }}>{hint}</Text> : null}
      {footer}
    </Card>
  );
}

export default function ProjectPage() {
  const c = useColors();
  const bottom = useBottomPad();
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useProject(id);
  const allChats = useStore(s => s.chats);
  const chats = allChats.filter(ch => ch.projectId === id);
  const { running } = useMemory();
  const [editing, setEditing] = useState(false);

  if (!project)
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <Stack.Screen options={{ title: t('Project') }} />
        <EmptyState icon="project" title={t('This project is gone')} hint={t('It may have been deleted.')} />
      </View>
    );

  const updating = running?.scope === project.id;
  const phase = updating && running.phase.startsWith('writing:') ? t('Writing… {n} characters', { n: running.phase.slice(8) }) : updating ? t('Reading chats…') : '';
  const refresh = async () => {
    try {
      const changed = await updateProjectMemory(project.id);
      if (!changed) void notice({ title: t('Nothing to learn yet'), message: t('Chat in this project first; its memory is built from those chats.'), icon: 'brain' });
    } catch (e) {
      void notice({ title: t('Could not update memory'), message: e instanceof Error ? e.message : String(e) });
    }
  };
  const newChat = () => {
    setDraftChat({ projectId: project.id });
    router.navigate('/');
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: project.name, headerRight: () => <IconButton name="pencil" label={t('Edit details')} color={c.text} onPress={() => setEditing(true)} /> }} />
      <PageScroll contentContainerStyle={{ paddingBottom: bottom + 110 }}>
        {project.description ? <Text style={{ fontFamily: font.sans, fontSize: fs.md, lineHeight: 25, color: c.secondary, paddingHorizontal: 4 }}>{project.description}</Text> : null}

        <SectionLabel>{t('Instructions')}</SectionLabel>
        <EditableCard
          value={project.instructions ?? ''}
          placeholder={t('Add instructions to tailor replies in this project, like a tone, a format or what to focus on.')}
          onSave={instructions => updateProject(project.id, { instructions })}
        />

        <SectionLabel>{t('Project memory')}</SectionLabel>
        <EditableCard
          value={project.memory ?? ''}
          placeholder={t('Nothing remembered yet. Neru learns from the chats in this project.')}
          hint={t('Last updated: {when}', { when: formatWhen(project.memoryUpdatedAt ?? 0) })}
          onSave={memory => updateProject(project.id, { memory, memoryUpdatedAt: Date.now() }, false)}
          footer={<ActionButton title={updating ? phase : t('Update from chats')} icon="retry" variant="secondary" loading={updating && !phase} disabled={!!running} onPress={() => void refresh()} style={{ marginTop: 8 }} />}
        />

        <SectionLabel>{t('Chats')}</SectionLabel>
        {chats.length ? (
          <Group>
            {chats.map(ch => (
              <Row key={ch.id} icon="chat" title={ch.title} subtitle={formatDay(ch.updatedAt)} subtitleLines={1} onPress={() => router.push(`/chat/${ch.id}`)} />
            ))}
          </Group>
        ) : (
          <EmptyState icon="chat" title={t('No chats yet')} hint={t('Chats you start here use the project’s instructions and memory.')} />
        )}

        <Group style={{ marginTop: 8 }}>
          <Row icon="archive" title={project.archived ? t('Unarchive project') : t('Archive project')} onPress={() => setProjectArchived(project.id, !project.archived)} chevron={false} />
          <Row icon="trash" title={t('Delete project')} destructive chevron={false} onPress={() => void removeProject(project).then(gone => gone && router.back())} />
        </Group>
      </PageScroll>
      <View pointerEvents="box-none" style={{ position: 'absolute', right: 16, bottom: bottom + 12 }}>
        <PillButton label={t('New chat in project')} icon="plus" onPress={newChat} />
      </View>
      <CreateProjectSheet open={editing} initial={project} onClose={() => setEditing(false)} onSubmit={(name, description) => updateProject(project.id, { name, description })} />
    </View>
  );
}
