// What a provider does with your prompts, as a small tag: from the provider catalog's `privacy`.
import { Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { privacyLabels, privacyOf } from '@/shared/providerCatalog';
import { font, useColors } from '@/theme';
import { t } from '@/i18n';

const icons: Record<string, IconName> = { local: 'lock', 'no-training': 'shield', 'may-train': 'warning', unknown: 'alertCircle' };

export function PrivacyTag({ providerId }: { providerId: string }) {
  const c = useColors();
  const privacy = privacyOf(providerId);
  const tone = privacy === 'local' ? c.moss : privacy === 'no-training' ? c.sage : privacy === 'may-train' ? c.danger : c.muted;
  return (
    <View accessibilityLabel={t('Privacy: {label}', { label: t(privacyLabels[privacy].label) })} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
      <Icon name={icons[privacy]} size={12} color={tone} />
      <Text style={{ fontFamily: font.medium, fontSize: 11, color: tone }}>{t(privacyLabels[privacy].label)}</Text>
    </View>
  );
}
