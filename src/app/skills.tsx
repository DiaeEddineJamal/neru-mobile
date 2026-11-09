// Skills: the built-in set and your own. Tap one for its details; "Use" starts a new chat with "/slug " typed in.
// The pill at the bottom creates a skill; yours can be edited and deleted.
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { SkillDetails, SkillList } from '@/components/PlusSheet';
import { useComposerDraft } from '@/drafts';
import { haptic } from '@/haptics';
import { t } from '@/i18n';
import { builtInSkills, deleteSkill, saveSkill, slugify, useMySkills, type Skill } from '@/skills';
import { font, fs, useBottomPad, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';
import { confirm } from '@/ui/confirm';
import { Field, PageScroll, PillButton } from '@/ui/page';

type Editing = { previous?: string; slug: string; description: string; instructions: string };

export default function SkillsPage() {
  const c = useColors();
  const bottom = useBottomPad();
  const mine = useMySkills();
  const { setText } = useComposerDraft('new');
  const [shown, setShown] = useState<Skill | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState('');

  const use = (skill: Skill) => {
    haptic.light();
    setShown(null);
    setText(`/${skill.slug} `);
    router.navigate('/');
  };

  const startNew = () => (haptic.light(), setError(''), setEditing({ slug: '', description: '', instructions: '' }));
  const startEdit = (skill: Skill) => {
    setShown(null);
    setError('');
    setEditing({ previous: skill.slug, slug: skill.slug, description: skill.description, instructions: skill.instructions });
  };

  const save = () => {
    if (!editing) return;
    const slug = slugify(editing.slug);
    if (!slug) return setError(t('Give the skill a name.'));
    if (!editing.instructions.trim()) return setError(t('Write the instructions Neru should follow.'));
    const taken = mine.some(s => s.slug === slug && s.slug !== editing.previous);
    if (taken) return setError(t('You already have a skill called /{name}.', { name: slug }));
    saveSkill({ slug, title: slug, description: editing.description.trim() || editing.instructions.trim().slice(0, 140), instructions: editing.instructions.trim() }, editing.previous);
    haptic.success();
    setEditing(null);
  };

  const remove = async (skill: Skill) => {
    const ok = await confirm({ title: t('Delete /{name}?', { name: skill.slug }), message: t('This skill will be removed from this phone.'), action: t('Delete'), destructive: true, icon: 'trash' });
    if (!ok) return;
    deleteSkill(skill.slug);
    haptic.success();
    setShown(null);
  };

  const overridesBuiltIn = (slug: string) => builtInSkills().some(s => s.slug === slug);

  return (
    <>
      <PageScroll contentContainerStyle={{ paddingBottom: bottom + 110 }}>
        <Text style={{ fontFamily: font.sans, fontSize: fs.base, lineHeight: 22, color: c.muted, paddingHorizontal: 4 }}>
          {t('Type /name at the start of a message, or pick a skill from the + menu, and Neru follows its instructions for that message.')}
        </Text>
        <SkillList onPick={setShown} onInfo={setShown} />
      </PageScroll>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: bottom + 8, alignItems: 'center' }} pointerEvents="box-none">
        <PillButton label={t('New skill')} icon="plus" onPress={startNew} />
      </View>

      <BottomSheet open={!!shown} onClose={() => setShown(null)} title={t('Skill')}>
        {shown ? (
          <SkillDetails skill={shown} onUse={() => use(shown)}>
            {shown.source === 'mine' ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <ActionButton title={t('Edit')} icon="pencil" variant="secondary" onPress={() => startEdit(shown)} style={{ flex: 1 }} />
                <ActionButton title={t('Delete')} icon="trash" variant="secondary" onPress={() => void remove(shown)} style={{ flex: 1 }} />
              </View>
            ) : null}
          </SkillDetails>
        ) : null}
      </BottomSheet>

      <BottomSheet open={!!editing} onClose={() => setEditing(null)} title={editing?.previous ? t('Edit skill') : t('New skill')}>
        {editing ? (
          <View style={{ gap: 16, paddingBottom: 8 }}>
            <Field
              label={t('Name')}
              value={editing.slug}
              onChangeText={slug => setEditing({ ...editing, slug })}
              placeholder={t('weekly-report')}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {editing.slug && slugify(editing.slug) !== editing.slug ? (
              <Text style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.muted, marginTop: -8 }}>{t('Used as /{name}', { name: slugify(editing.slug) || '…' })}</Text>
            ) : null}
            {overridesBuiltIn(slugify(editing.slug)) ? (
              <Text style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.muted, marginTop: -8 }}>{t('Replaces the built-in skill with the same name.')}</Text>
            ) : null}
            <Field label={t('Description')} value={editing.description} onChangeText={description => setEditing({ ...editing, description })} placeholder={t('When to use it, in a sentence')} />
            <Field label={t('Instructions')} value={editing.instructions} onChangeText={instructions => setEditing({ ...editing, instructions })} placeholder={t('What Neru should do with your message')} multiline />
            {error ? <Text style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.danger }} accessibilityLiveRegion="polite">{error}</Text> : null}
            <ActionButton title={t('Save')} onPress={save} />
          </View>
        ) : null}
      </BottomSheet>
    </>
  );
}
