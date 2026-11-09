// The composer's + sheet, after Claude's "Add to session": Camera / Photos / Files tiles, then the chat's project,
// Devices (with a paired desktop), Research, Connectors, Skills and Memory. Project and Skills open sub-pages that
// slide in inside the sheet. SkillList and SkillDetails are shared with the /skills page.
import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInLeft, SlideInRight, useReducedMotion } from 'react-native-reanimated';

import { Icon, IconButton, type IconName } from '@/components/Icon';
import { pickFiles, pickPhotos, takePhoto } from '@/attach';
import { haptic } from '@/haptics';
import { t } from '@/i18n';
import { useChatMemory } from '@/memory';
import { useProjects } from '@/projects';
import { useRemote } from '@/remote/store';
import { useSkills, type Skill } from '@/skills';
import { setChatProject, setDraftChat, useStore, type Attachment } from '@/store';
import { font, fs, TAP, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { Group, Row, SearchField } from '@/ui/page';

type Page = 'main' | 'project' | 'skills' | { skill: Skill };

type Props = {
  open: boolean;
  onClose: () => void;
  /** Runs once the sheet has left the screen (ChatView launches a queued picker there). */
  onDismiss: () => void;
  chatId: string | null;
  /** Queues a picker; ChatView closes the sheet and launches it after. */
  onAttach: (pick: () => Promise<Attachment[]>) => void;
  /** A skill was picked: insert "/slug " into the composer. */
  onSkill: (skill: Skill) => void;
  research: boolean;
  onResearch: (on: boolean) => void;
};

export function PlusSheet({ open, onClose, onDismiss, chatId, onAttach, onSkill, research, onResearch }: Props) {
  const c = useColors();
  const reduce = useReducedMotion();
  const [page, setPage] = useState<Page>('main');
  const [forward, setForward] = useState(true);
  // Pages slide only when moving between them inside the sheet; the sheet's first page appears in place.
  const [moved, setMoved] = useState(false);
  const go = (next: Page, ahead = true) => (haptic.light(), setForward(ahead), setMoved(true), setPage(next));

  const projects = useProjects();
  const chatProject = useStore(st => (chatId ? st.chats.find(x => x.id === chatId)?.projectId : st.draftChat.projectId));
  const project = projects.find(p => p.id === chatProject);
  const desktop = useRemote(st => st.desktopName);
  const [memory, setMemory] = useChatMemory(chatId);

  const close = () => onClose();
  const dismissed = () => (setPage('main'), setMoved(false), onDismiss());
  const navigate = (path: '/connectors' | '/pair') => (close(), router.push(path));
  const chooseProject = (id: string | undefined) => {
    haptic.select();
    if (chatId) setChatProject(chatId, id);
    else setDraftChat({ projectId: id });
    go('main', false);
  };

  const tiles: [IconName, string, () => Promise<Attachment[]>][] = [
    ['camera', t('Camera'), () => takePhoto(chatId)],
    ['photo', t('Photos'), () => pickPhotos(chatId)],
    ['fileUp', t('Files'), pickFiles],
  ];

  const title = page === 'main' ? t('Add to session') : page === 'project' ? t('Add to project') : page === 'skills' ? t('Skills') : `/${page.skill.slug}`;
  const entering = !moved ? undefined : reduce ? FadeIn.duration(150) : (forward ? SlideInRight : SlideInLeft).springify().stiffness(360).damping(34).mass(0.6);
  const key = typeof page === 'string' ? page : `skill:${page.skill.slug}`;

  return (
    <BottomSheet open={open} onClose={close} onDismiss={dismissed} title={title} onBack={page !== 'main' ? () => go(typeof page === 'object' ? 'skills' : 'main', false) : undefined}>
      <Animated.View key={key} entering={entering} style={{ gap: 12, paddingBottom: 8 }}>

        {page === 'main' ? (
          <>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {tiles.map(([icon, label, pick]) => (
                <Pressable key={label} onPress={() => (haptic.light(), onAttach(pick))} accessibilityRole="button" android_ripple={{ color: c.surface3 }} style={[s.tile, { backgroundColor: c.surface2 }]}>
                  <View style={[s.chip, { backgroundColor: c.surface3 }]}>
                    <Icon name={icon} size={24} color={c.text} />
                  </View>
                  <Text style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.text }}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <Group>
              <Row icon="project" iconChip title={t('Add to project')} subtitle={project?.name ?? t('None')} onPress={() => go('project')} />
            </Group>
            {desktop ? (
              <Group>
                <Row icon="desktop" iconChip title={t('Devices')} subtitle={desktop} onPress={() => navigate('/pair')} />
              </Group>
            ) : null}
            <Group>
              <Row icon="research" iconChip title={t('Research')} subtitle={t('Searches your connectors thoroughly before answering')} subtitleLines={2} toggle={{ value: research, onChange: onResearch }} />
              <Row icon="connectors" iconChip title={t('Connectors')} onPress={() => navigate('/connectors')} />
              <Row icon="skills" iconChip title={t('Skills')} onPress={() => go('skills')} />
              <Row icon="brain" iconChip title={t('Memory')} toggle={{ value: memory, onChange: setMemory }} />
            </Group>
          </>
        ) : page === 'project' ? (
          <Group>
            {[{ id: undefined as string | undefined, name: t('None') }, ...projects.filter(p => !p.archived)].map(p => (
              <Row
                key={p.id ?? 'none'}
                icon={p.id ? 'project' : 'close'}
                iconChip
                title={p.name}
                onPress={() => chooseProject(p.id)}
                trailing={p.id === chatProject ? <Icon name="check" size={22} color={c.moss} /> : undefined}
                chevron={false}
              />
            ))}
          </Group>
        ) : page === 'skills' ? (
          <SkillList onPick={skill => (haptic.light(), onSkill(skill), close())} onInfo={skill => go({ skill })} />
        ) : (
          <SkillDetails skill={page.skill} onUse={() => (haptic.light(), onSkill(page.skill), close())} />
        )}
      </Animated.View>
    </BottomSheet>
  );
}

/** Searchable skills: "/slug" in bold, two lines of description with See more, and an info button. */
export function SkillList({ onPick, onInfo, skills: given }: { onPick: (skill: Skill) => void; onInfo: (skill: Skill) => void; skills?: Skill[] }) {
  const c = useColors();
  const all = useSkills();
  const skills = given ?? all;
  const [query, setQuery] = useState('');
  const [more, setMore] = useState<Set<string>>(new Set());
  const q = query.trim().toLowerCase().replace(/^\//, '');
  const shown = q ? skills.filter(sk => sk.slug.includes(q) || sk.title.toLowerCase().includes(q) || sk.description.toLowerCase().includes(q)) : skills;

  return (
    <View style={{ gap: 4 }}>
      <SearchField value={query} onChangeText={setQuery} placeholder={t('Search skills')} accessibilityLabel={t('Search skills')} style={{ marginBottom: 8 }} />
      {shown.length === 0 ? <Text style={{ fontFamily: font.sans, fontSize: fs.base, color: c.muted, textAlign: 'center', paddingVertical: 24 }}>{t('No skills match.')}</Text> : null}
      {shown.map(sk => {
        const open = more.has(sk.slug);
        return (
          <View key={sk.slug} style={s.skill}>
            <Pressable onPress={() => onPick(sk)} accessibilityRole="button" accessibilityLabel={t('Use skill {name}', { name: sk.slug })} style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: font.bold, fontSize: fs.md, color: c.text }}>/{sk.slug}</Text>
                {sk.source === 'mine' ? <Text style={{ fontFamily: font.medium, fontSize: fs.xs, color: c.muted }}>{t('Yours')}</Text> : null}
              </View>
              <Text numberOfLines={open ? undefined : 2} style={{ fontFamily: font.medium, fontSize: fs.base, lineHeight: 21, color: c.muted }}>{sk.description}</Text>
            </Pressable>
            <View style={{ alignItems: 'center' }}>
              <IconButton name="info" label={t('About {name}', { name: sk.slug })} color={c.text} onPress={() => (haptic.light(), onInfo(sk))} />
            </View>
            {sk.description.length > 70 ? (
              <Pressable
                onPress={() => (haptic.light(), setMore(prev => { const next = new Set(prev); if (open) next.delete(sk.slug); else next.add(sk.slug); return next; }))}
                accessibilityRole="button"
                hitSlop={10}
                style={s.seeMore}
              >
                <Text style={{ fontFamily: font.semibold, fontSize: fs.sm, color: c.secondary }}>{open ? t('See less') : t('See more')}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** A skill's full details: description and the instructions the model gets. */
export function SkillDetails({ skill, onUse, children }: { skill: Skill; onUse?: () => void; children?: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontFamily: font.bold, fontSize: fs.lg, color: c.text }}>/{skill.slug}</Text>
        <Text style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.muted }}>{skill.title} · {skill.source === 'mine' ? t('Your skill') : t('Built in')}</Text>
      </View>
      <Text style={{ fontFamily: font.sans, fontSize: fs.base, lineHeight: 22, color: c.text }}>{skill.description}</Text>
      <View style={[s.instructions, { backgroundColor: c.surface2 }]}>
        <Text style={{ fontFamily: font.semibold, fontSize: fs.sm, color: c.secondary }}>{t('Instructions')}</Text>
        <Text selectable style={{ fontFamily: font.sans, fontSize: fs.sm, lineHeight: 20, color: c.text }}>{skill.instructions}</Text>
      </View>
      {onUse ? (
        <Pressable onPress={onUse} accessibilityRole="button" style={[s.use, { backgroundColor: c.text }]}>
          <Text style={{ fontFamily: font.bold, fontSize: fs.md, color: c.bg }}>{t('Use /{name}', { name: skill.slug })}</Text>
        </Pressable>
      ) : null}
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  tile: { flex: 1, minHeight: 2 * TAP + 20, borderRadius: 22, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14, overflow: 'hidden' },
  chip: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  skill: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingVertical: 12 },
  seeMore: { width: '100%', marginTop: -6 },
  instructions: { borderRadius: 18, padding: 16, gap: 8 },
  use: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
});
