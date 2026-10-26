// Deny with a reason: the agent hears why, and with "Remember" Neru keeps it as a rule for this project,
// so the same mistake does not come back in a later session.
import { useState } from 'react';
import { Text, View } from 'react-native';

import { font, fs, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';
import { TextField } from '@/ui/input';
import { Switch } from '@/ui/switch';
import { t } from '@/i18n';

export function DenySheet({ open, onClose, onDeny }: { open: boolean; onClose: () => void; onDeny: (reason: string, remember: boolean) => void }) {
  const c = useColors();
  const [reason, setReason] = useState('');
  const [remember, setRemember] = useState(true);
  const done = (why: string) => {
    onDeny(why, remember && !!why.trim());
    setReason('');
  };
  return (
    <BottomSheet open={open} onClose={onClose} title={t('Deny this change')}>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <TextField label={t('Why? (optional)')} value={reason} onChangeText={setReason} placeholder={t("Don't touch the generated files")} autoFocus multiline />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: font.sans, fontSize: fs.base, color: c.text }}>{t('Remember for this project')}</Text>
            <Text style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>{t('Neru reads it in every later session')}</Text>
          </View>
          <Switch value={remember} onValueChange={setRemember} accessibilityLabel={t('Remember for this project')} />
        </View>
        <ActionButton title={reason.trim() ? t('Deny and tell Neru') : t('Deny')} variant="destructive" onPress={() => done(reason)} />
      </View>
    </BottomSheet>
  );
}
