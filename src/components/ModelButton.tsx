import { Pressable, Text, useWindowDimensions } from 'react-native';

import { Icon } from '@/components/Icon';
import { modelLabel, setModelSheet, useStore } from '@/store';
import { font, fs, TAP, useColors } from '@/theme';
import { t } from '@/i18n';

export function ModelButton() {
  const c = useColors();
  const { width } = useWindowDimensions();
  const local = useStore(s => s.settings.providerId === 'on-device');
  const label = useStore(s => modelLabel(s.settings));
  return (
    <Pressable
      onPress={() => setModelSheet(true)}
      accessibilityRole="button"
      accessibilityLabel={t('Model: {model}. Change model', { model: label })}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: TAP, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.surface2 }}
    >
      <Icon name={local ? 'brain' : 'cloud'} size={20} color={c.secondary} />
      <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.text, maxWidth: Math.max(100, width - 208) }}>{label}</Text>
      <Icon name="chevronDown" size={18} color={c.muted} />
    </Pressable>
  );
}
