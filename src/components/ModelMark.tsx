import { Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { Icon } from '@/components/Icon';
import { vendorOf } from '@/llm/vendor';
import { font, useColors, useScheme } from '@/theme';
import * as logos from '@/ui/model-logos/logos';

const LOGOS = logos as Record<string, string>;

/** The model maker's logo on a light tile (as AgentLogo draws agents), its initial when it has no logo, or a
 * capability mark when the maker is unknown. `model` is the id or repo; `providerId` names the host as a fallback. */
export function ModelMark({ model, providerId, local = true, vision = false, size = 40 }: { model?: string; providerId?: string; local?: boolean; vision?: boolean; size?: number }) {
  const c = useColors();
  const light = useScheme() === 'light';
  const vendor = model ? vendorOf(model, providerId) : null;
  const radius = size * 0.3;
  const logo = vendor?.logo ? LOGOS[vendor.logo] : undefined;
  if (logo)
    return <View accessibilityLabel={vendor!.name} style={{ width: size, height: size, borderRadius: radius, backgroundColor: light ? '#ffffff' : '#f7f6f1', borderWidth: 1, borderColor: light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
      <SvgXml xml={logo} width={size * 0.6} height={size * 0.6} color="#191a18" />
    </View>;
  if (vendor)
    return <View accessibilityLabel={vendor.name} style={{ width: size, height: size, borderRadius: radius, backgroundColor: `${c.secondary}26`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: font.semibold, fontSize: size * 0.44, color: c.secondary }}>{vendor.name.charAt(0)}</Text>
    </View>;
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface3 }}>
    <Icon name={vision ? 'photo' : local ? 'brain' : 'cloud'} size={size * 0.52} color={c.text} />
  </View>;
}
