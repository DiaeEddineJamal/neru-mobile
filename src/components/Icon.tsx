import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Platform, Pressable, type ViewStyle } from 'react-native';

import { TAP } from '@/theme';

// Native icons per platform: SF Symbols on iOS, Material Symbols on Android.
const names = {
  menu: { ios: 'line.3.horizontal', android: 'menu' },
  compose: { ios: 'square.and.pencil', android: 'edit_square' },
  plus: { ios: 'plus', android: 'add' },
  download: { ios: 'arrow.down.circle', android: 'download' },
  minus: { ios: 'minus', android: 'remove' },
  mic: { ios: 'mic', android: 'mic' },
  send: { ios: 'arrow.up', android: 'arrow_upward' },
  stop: { ios: 'stop.fill', android: 'stop' },
  close: { ios: 'xmark', android: 'close' },
  check: { ios: 'checkmark', android: 'check' },
  copy: { ios: 'doc.on.doc', android: 'content_copy' },
  settings: { ios: 'gearshape', android: 'settings' },
  cloud: { ios: 'cloud', android: 'cloud' },
  sliders: { ios: 'slider.horizontal.3', android: 'tune' },
  person: { ios: 'person', android: 'person' },
  language: { ios: 'globe', android: 'language' },
  palette: { ios: 'paintpalette', android: 'palette' },
  vibration: { ios: 'iphone.radiowaves.left.and.right', android: 'vibration' },
  star: { ios: 'star.fill', android: 'star' },
  trash: { ios: 'trash', android: 'delete' },
  desktop: { ios: 'desktopcomputer', android: 'desktop_windows' },
  laptop: { ios: 'laptopcomputer', android: 'laptop' },
  team: { ios: 'person.2', android: 'group' },
  chevronDown: { ios: 'chevron.down', android: 'expand_more' },
  chevronRight: { ios: 'chevron.right', android: 'keyboard_arrow_right' },
  camera: { ios: 'camera', android: 'photo_camera' },
  photo: { ios: 'photo', android: 'image' },
  file: { ios: 'paperclip', android: 'attach_file' },
  terminal: { ios: 'terminal', android: 'terminal' },
  doc: { ios: 'doc.text', android: 'description' },
  search: { ios: 'magnifyingglass', android: 'search' },
  qr: { ios: 'qrcode.viewfinder', android: 'qr_code_scanner' },
  retry: { ios: 'arrow.clockwise', android: 'refresh' },
  link: { ios: 'arrow.up.right.square', android: 'open_in_new' },
  sparkles: { ios: 'sparkles', android: 'auto_awesome' },
  chat: { ios: 'bubble.left', android: 'chat_bubble' },
  lab: { ios: 'flask', android: 'science' },
  compass: { ios: 'safari', android: 'explore' },
  chevronLeft: { ios: 'chevron.left', android: 'chevron_left' },
  share: { ios: 'square.and.arrow.up', android: 'share' },
  speaker: { ios: 'speaker.wave.2', android: 'volume_up' },
  code: { ios: 'chevron.left.forwardslash.chevron.right', android: 'code' },
  bell: { ios: 'bell', android: 'notifications' },
  wrench: { ios: 'wrench.and.screwdriver', android: 'build' },
  checkCircle: { ios: 'checkmark.circle', android: 'check_circle' },
  xCircle: { ios: 'xmark.circle', android: 'cancel' },
  shield: { ios: 'checkmark.shield', android: 'verified_user' },
  alertCircle: { ios: 'exclamationmark.circle', android: 'error' },
  warning: { ios: 'exclamationmark.triangle', android: 'warning' },
  checklist: { ios: 'checklist', android: 'checklist' },
  fileCode: { ios: 'doc.text', android: 'code' },
  lock: { ios: 'lock', android: 'lock' },
  eyeOff: { ios: 'eye.slash', android: 'visibility_off' },
  clock: { ios: 'clock', android: 'schedule' },
  moon: { ios: 'moon', android: 'bedtime' },
  sun: { ios: 'sun.max', android: 'wb_sunny' },
  savings: { ios: 'banknote', android: 'savings' },
  brain: { ios: 'brain', android: 'psychology' },
  inbox: { ios: 'tray', android: 'inbox' },
  people: { ios: 'person.2.badge.gearshape', android: 'groups' },
} satisfies Record<string, SymbolViewProps['name']>;

export type IconName = keyof typeof names;

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color: string }) {
  return <SymbolView name={names[name]} size={size} tintColor={color} />;
}

/** Icon with a 48dp touch target and a screen-reader label. */
export function IconButton({ name, label, color, onPress, size, style, disabled = false }: { name: IconName; label: string; color: string; onPress: () => void; size?: number; style?: ViewStyle; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ disabled }}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: 'rgba(128,128,128,0.2)', borderless: true, radius: TAP / 2 }}
      style={({ pressed }) => [{ width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : pressed && Platform.OS === 'ios' ? 0.5 : 1 }, style]}
    >
      <Icon name={name} color={color} size={size} />
    </Pressable>
  );
}
