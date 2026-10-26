// What a model can do, as a small tag with one color per kind, so Chat, Vision, Thinking and tool use read apart at a
// glance in Pocket Lab and the model picker. Each ink keeps 4.5:1 or more on its own tint in both modes.
import { Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { t } from '@/i18n';
import { font, fs, useScheme } from '@/theme';

export type Capability = 'chat' | 'vision' | 'thinking' | 'functions' | 'tools' | 'noTools' | 'photo';

const kinds: Record<Capability, { label: string; icon: IconName; light: string; dark: string }> = {
  chat: { label: 'Chat', icon: 'chat', light: '#2a5db0', dark: '#8cb4f5' },
  vision: { label: 'Vision', icon: 'photo', light: '#7a3fb3', dark: '#c9a7f0' },
  thinking: { label: 'Thinking', icon: 'brain', light: '#8a5300', dark: '#e9b968' },
  functions: { label: 'Function calling', icon: 'code', light: '#1d6f66', dark: '#7fd0c2' },
  tools: { label: 'MCP tools', icon: 'wrench', light: '#2f6b36', dark: '#8fd09a' },
  noTools: { label: 'No tools', icon: 'wrench', light: '#5e665d', dark: '#9aa096' },
  photo: { label: 'Photo selection', icon: 'photo', light: '#a3365f', dark: '#f09bbd' },
};

export function CapabilityTag({ kind, small = false }: { kind: Capability; small?: boolean }) {
  const dark = useScheme() === 'dark';
  const k = kinds[kind];
  const ink = dark ? k.dark : k.light;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: small ? 7 : 10, paddingVertical: small ? 3 : 5, borderRadius: small ? 8 : 10, backgroundColor: `${ink}${dark ? '24' : '1a'}` }}>
      <Icon name={k.icon} size={small ? 11 : 13} color={ink} />
      <Text style={{ fontFamily: font.medium, fontSize: small ? 11 : fs.xs, lineHeight: small ? 14 : 18, color: ink }}>{t(k.label)}</Text>
    </View>
  );
}
