// "Create a project" (and "Rename project") bottom sheet: what you are working on, and what you want to achieve.
import { useState } from 'react';
import { View } from 'react-native';

import { t } from '@/i18n';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';
import { Field } from '@/ui/page';

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called with the trimmed name and description. */
  onSubmit: (name: string, description: string) => void;
  /** Editing an existing project: its current values, and the sheet's labels change. */
  initial?: { name: string; description: string };
};

export function CreateProjectSheet({ open, onClose, onSubmit, initial }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [shownFor, setShownFor] = useState(open);
  // Start from the given values each time the sheet opens.
  if (open !== shownFor) {
    setShownFor(open);
    if (open) {
      setName(initial?.name ?? '');
      setDescription(initial?.description ?? '');
    }
  }
  const ready = name.trim().length > 0;
  const submit = () => {
    if (!ready) return;
    onSubmit(name.trim(), description.trim());
    onClose();
  };
  return (
    <BottomSheet open={open} onClose={onClose} title={initial ? t('Edit project') : t('Create a project')}>
      <View style={{ gap: 20, paddingTop: 4, paddingBottom: 8 }}>
        <Field label={t('What are you working on?')} placeholder={t('Name your project')} value={name} onChangeText={setName} autoFocus={!initial} returnKeyType="next" maxLength={80} />
        <Field label={t('What are you trying to achieve?')} placeholder={t('Describe your project, goals, subject, etc…')} value={description} onChangeText={setDescription} multiline maxLength={2000} />
        <ActionButton title={initial ? t('Save') : t('Create project')} onPress={submit} disabled={!ready} />
      </View>
    </BottomSheet>
  );
}
