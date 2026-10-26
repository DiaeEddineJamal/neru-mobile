// Neru's mascot in the accent theme's color, like the launcher icon (scripts/theme-icons.py makes the variants).
import { Image, type ImageProps } from 'expo-image';

import { useStore } from '@/store';

const MASCOTS: Record<string, number> = {
  moss: require('@/assets/images/neru-mascot.png'),
  glacier: require('@/assets/images/themes/glacier/mascot.png'),
  heather: require('@/assets/images/themes/heather/mascot.png'),
  terracotta: require('@/assets/images/themes/terracotta/mascot.png'),
  saffron: require('@/assets/images/themes/saffron/mascot.png'),
  tidepool: require('@/assets/images/themes/tidepool/mascot.png'),
  twilight: require('@/assets/images/themes/twilight/mascot.png'),
};

export function MascotImage(props: Omit<ImageProps, 'source'>) {
  const palette = useStore(s => s.settings.palette);
  return <Image {...props} source={MASCOTS[palette ?? 'moss'] ?? MASCOTS.moss} />;
}
