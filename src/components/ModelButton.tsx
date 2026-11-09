import { Pressable, Text, useWindowDimensions } from 'react-native';

import { Icon } from '@/components/Icon';
import { haptic } from '@/haptics';
import { modelLabel, setModelSheet, useStore } from '@/store';
import { font, fs, TAP, useColors } from '@/theme';
import { t } from '@/i18n';

/** Opens the model sheet. `compact` is the small chip for a chat header: the model's glyph and a chevron. */
export function ModelButton({ compact = false }: { compact?: boolean }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const local = useStore(s => s.settings.providerId === 'on-device');
  const label = useStore(s => modelLabel(s.settings));
  return (
    <Pressable
      onPress={() => (haptic.light(), setModelSheet(true))}
      accessibilityRole="button"
      accessibilityLabel={t('Model: {model}. Change model', { model: label })}
      hitSlop={compact ? 6 : 0}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: compact ? 4 : 8, minHeight: compact ? 36 : TAP, paddingHorizontal: compact ? 10 : 14,
        borderRadius: 999, backgroundColor: c.surface2, transform: [{ scale: pressed ? 0.95 : 1 }],
      })}
    >
      <Icon name={local ? 'brain' : 'cloud'} size={compact ? 18 : 20} color={c.secondary} />
      {compact ? null : <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.text, maxWidth: Math.max(100, width - 208) }}>{label}</Text>}
      <Icon name="chevronDown" size={compact ? 14 : 18} color={c.muted} />
    </Pressable>
  );
}
