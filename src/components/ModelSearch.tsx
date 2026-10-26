import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Icon, IconButton } from '@/components/Icon';
import { t } from '@/i18n';
import { font, fs, TAP, useColors } from '@/theme';

export function ModelSearch({ value, onChangeText }: { value: string; onChangeText: (value: string) => void }) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  return <View style={[s.field, { backgroundColor: c.surface3, borderColor: focused ? c.text : c.border }]}>
    <Icon name="search" size={21} color={c.muted} />
    <TextInput accessibilityLabel={t('Search models')} placeholder={t('Search models')} placeholderTextColor={c.muted} value={value} onChangeText={onChangeText} autoCapitalize="none" autoCorrect={false} returnKeyType="search" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={[s.input, { color: c.text }]} />
    {value ? <IconButton name="close" label={t('Clear search')} size={18} color={c.secondary} onPress={() => onChangeText('')} /> : null}
  </View>;
}

const s = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', minHeight: TAP + 4, borderRadius: 18, borderWidth: 1, paddingStart: 16, paddingEnd: 4, gap: 10 },
  input: { flex: 1, minWidth: 0, minHeight: TAP, fontFamily: font.sans, fontSize: fs.base, paddingVertical: 12 },
});
