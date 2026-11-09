// Settings → Profile: photo, names, gender and the personal preferences that go into every conversation
// (profilePrompt() in store.ts reads them).
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { haptic } from '@/haptics';
import { t } from '@/i18n';
import { updateSettings, useStore, type Settings } from '@/store';
import { font, fs, useColors } from '@/theme';
import { Field, Group, PageScroll, PillButton, Row } from '@/ui/page';
import { SelectSheet } from '@/ui/select';
import { useToast } from '@/ui/toast';

const genders = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

const AVATARS = 'profile';
/** Keeps a picked photo in the app's own documents (the picker's copy lives in the cache, which Android clears). */
function keepPhoto(picked: string): string {
  const dir = new Directory(Paths.document, AVATARS);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  // A fresh name each time, so the image cache never shows the old photo.
  const dest = new File(dir, `avatar-${Date.now()}.jpg`);
  new File(picked).copySync(dest);
  return dest.uri;
}
function dropPhoto(uri: string | undefined) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {}
}

export default function Profile() {
  const c = useColors();
  const toast = useToast();
  const settings = useStore(s => s.settings);
  const [fullName, setFullName] = useState(settings.fullName ?? '');
  const [name, setName] = useState(settings.name ?? '');
  const [prefs, setPrefs] = useState(settings.preferences ?? '');
  const [sheet, setSheet] = useState(false);
  const changed = fullName.trim() !== (settings.fullName ?? '') || name.trim() !== (settings.name ?? '');
  const genderOptions = genders.map(g => ({ ...g, label: t(g.label) }));

  const saveProfile = () => {
    updateSettings({ fullName: fullName.trim() || undefined, name: name.trim() || undefined });
    haptic.success();
    toast.show({ title: t('Profile updated') });
  };
  const savePrefs = () => {
    const next = prefs.trim() || undefined;
    if (next === settings.preferences) return;
    updateSettings({ preferences: next });
    toast.show({ title: t('Preferences saved') });
  };

  const pickPhoto = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (r.canceled || !r.assets?.[0]) return;
    try {
      const uri = keepPhoto(r.assets[0].uri);
      dropPhoto(settings.avatarUri);
      updateSettings({ avatarUri: uri });
      haptic.success();
    } catch (err) {
      haptic.error();
      toast.show({ title: t('Couldn’t save the photo'), description: err instanceof Error ? err.message : String(err) });
    }
  };
  const removePhoto = () => {
    dropPhoto(settings.avatarUri);
    updateSettings({ avatarUri: undefined });
  };

  return (
    <PageScroll contentContainerStyle={{ gap: 20 }}>
      <View style={{ alignItems: 'center', gap: 14, paddingTop: 8 }}>
        <Avatar uri={settings.avatarUri} name={settings.fullName || settings.name || ''} size={128} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <PillButton label={t('Edit Photo')} tone="outline" onPress={() => void pickPhoto()} style={{ height: 46, paddingHorizontal: 22 }} />
          {settings.avatarUri ? <PillButton label={t('Remove')} tone="outline" onPress={removePhoto} style={{ height: 46, paddingHorizontal: 22 }} /> : null}
        </View>
      </View>

      <Field label={t('Full name')} value={fullName} onChangeText={setFullName} placeholder={t('Your full name')} autoCapitalize="words" returnKeyType="next" />
      <Field label={t('What should we call you?')} value={name} onChangeText={setName} placeholder={t('First name')} autoCapitalize="words" returnKeyType="done" onSubmitEditing={() => changed && saveProfile()} />
      <PillButton label={t('Update profile')} tone={changed ? 'solid' : 'muted'} disabled={!changed} onPress={saveProfile} />

      <Group>
        <Row icon="people" title={t('Gender')} subtitle={genderOptions.find(g => g.value === settings.gender)?.label ?? t('Not set')} onPress={() => setSheet(true)} />
      </Group>

      <View style={{ gap: 4 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: fs.lg, lineHeight: 26, color: c.text }}>{t('What personal preferences should Neru consider in responses?')}</Text>
        <Text style={{ fontFamily: font.medium, fontSize: fs.base, lineHeight: 21, color: c.muted }}>{t('Your preferences will apply to all conversations.')}</Text>
      </View>
      <Field value={prefs} onChangeText={setPrefs} onBlur={savePrefs} multiline placeholder={t('Ask clarifying questions before giving detailed answers')} />
      {prefs.trim() !== (settings.preferences ?? '') ? <PillButton label={t('Save preferences')} onPress={savePrefs} /> : null}

      <SelectSheet open={sheet} onClose={() => setSheet(false)} title={t('Gender')} options={genderOptions} value={settings.gender ?? ''} onChange={v => (updateSettings({ gender: v as Settings['gender'] }), setSheet(false))} />
    </PageScroll>
  );
}
