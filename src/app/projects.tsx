// Projects: search, pinned then recent projects with their edit date, a Yours / Archived filter, and
// "+ New project". Long-press a project to pin, rename, archive or delete it.
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, IconButton } from '@/components/Icon';
import { t } from '@/i18n';
import { createProject, setProjectArchived, setProjectPinned, updateProject, useProjects, type Project } from '@/projects';
import { CreateProjectSheet } from '@/projects/CreateProjectSheet';
import { FilterMenu } from '@/projects/FilterMenu';
import { editedLabel } from '@/projects/format';
import { removeProject } from '@/projects/actions';
import { font, fs, useBottomPad, useColors } from '@/theme';
import { ContextMenu } from '@/ui/context-menu';
import { EmptyState, PageScroll, PillButton, SearchField } from '@/ui/page';

type Filter = 'yours' | 'archived';

export default function Projects() {
  const c = useColors();
  const bottom = useBottomPad();
  const [filter, setFilter] = useState<Filter>('yours');
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const active = useProjects();
  const archived = useProjects({ archived: true });
  const list = filter === 'archived' ? archived : active;
  const q = query.trim().toLowerCase();
  const shown = q ? list.filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)) : list;

  const row = (p: Project) => (
    <ContextMenu
      key={p.id}
      items={[
        ...(p.archived ? [] : [{ label: p.pinned ? t('Unpin') : t('Pin'), icon: 'pin' as const, onPress: () => setProjectPinned(p.id, !p.pinned) }]),
        { label: t('Edit details'), icon: 'pencil', onPress: () => setEditing(p) },
        { label: p.archived ? t('Unarchive') : t('Archive'), icon: 'archive', onPress: () => setProjectArchived(p.id, !p.archived) },
        { label: t('Delete'), icon: 'trash', destructive: true, onPress: () => void removeProject(p) },
      ]}
    >
      <Pressable
        onPress={() => router.push(`/project/${p.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`${p.name}, ${p.pinned ? `${t('Pinned')}, ` : ''}${editedLabel(p.updatedAt)}`}
        accessibilityHint={t('Long-press for more options')}
        android_ripple={{ color: c.surface3 }}
        style={s.row}
      >
        <View style={s.titleLine}>
          <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: font.bold, fontSize: fs.lg, color: c.text }}>{p.name}</Text>
          {p.pinned ? <Icon name="pin" size={18} color={c.secondary} /> : null}
        </View>
        <Text style={{ fontFamily: font.semibold, fontSize: fs.base, color: c.muted }}>{editedLabel(p.updatedAt)}</Text>
      </Pressable>
    </ContextMenu>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen
        options={{
          title: filter === 'archived' ? t('Archived') : t('Projects'),
          headerRight: () => <IconButton name="filter" label={t('Filter projects')} color={c.text} onPress={() => setMenu(true)} />,
        }}
      />
      <PageScroll contentContainerStyle={{ gap: 4, paddingBottom: bottom + 110 }}>
        <SearchField placeholder={t('Search projects')} value={query} onChangeText={setQuery} style={{ marginBottom: 12 }} />
        {shown.map(row)}
        {!shown.length ? (
          q ? (
            <EmptyState icon="search" title={t('No matching projects')} hint={t('Try another word.')} />
          ) : filter === 'archived' ? (
            <EmptyState icon="archive" title={t('No archived projects')} hint={t('Projects you archive are kept here.')} />
          ) : (
            <EmptyState icon="project" title={t('No projects yet')} hint={t('A project keeps chats, instructions and memory together for one piece of work.')} />
          )
        ) : null}
      </PageScroll>
      <View pointerEvents="box-none" style={[s.fab, { bottom: bottom + 12 }]}>
        <PillButton label={t('New project')} icon="plus" onPress={() => setCreating(true)} />
      </View>
      <FilterMenu
        open={menu}
        onClose={() => setMenu(false)}
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'yours', label: t('Yours'), icon: 'person' },
          { value: 'archived', label: t('Archived'), icon: 'archive' },
        ]}
      />
      <CreateProjectSheet
        open={creating}
        onClose={() => setCreating(false)}
        onSubmit={(name, description) => {
          const p = createProject(name, description);
          setFilter('yours');
          router.push(`/project/${p.id}`);
        }}
      />
      <CreateProjectSheet
        open={!!editing}
        initial={editing ?? undefined}
        onClose={() => setEditing(null)}
        onSubmit={(name, description) => editing && updateProject(editing.id, { name, description })}
      />
    </View>
  );
}

const s = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingVertical: 14, gap: 4, borderRadius: 16 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fab: { position: 'absolute', right: 16 },
});
