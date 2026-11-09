// The page kit for Neru's full-screen pages (Settings, Profile, Connectors, Artifacts, Projects, Memory…), in the
// layout of Claude's Android app: grouped rows on a dark-gray card, a thin gap between rows, large rounded outer
// corners, an outline icon on the left and a subtitle under the title. Use these instead of one-off styles so
// every page reads the same.
import { Children, isValidElement, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewProps, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/Icon';
import { haptic } from '@/haptics';
import { font, fs, TAP, useBottomPad, useColors } from '@/theme';
import { SPRING_PRESS } from '@/ui/motion';
import { Switch } from '@/ui/switch';

/** Outer corner radius of a group of rows, and of single cards. */
export const CARD_RADIUS = 22;

/** Scrolling page body with the standard side gutter and room above the gesture bar. */
export function PageScroll({ children, contentContainerStyle, ...rest }: ScrollViewProps & { children: ReactNode }) {
  const c = useColors();
  const bottom = useBottomPad();
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={[{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: bottom + 24, gap: 16 }, contentContainerStyle]}
      {...rest}
    >
      {children}
    </ScrollView>
  );
}

/** A small muted heading above a group ("Weekly limits"). */
export function SectionLabel({ children }: { children: string }) {
  const c = useColors();
  return <Text accessibilityRole="header" style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.secondary, paddingHorizontal: 16, marginBottom: -6 }}>{children}</Text>;
}

/** Rows that share one card: the gaps between them show the page background, as in Claude. */
export function Group({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const items = Children.toArray(children).filter(isValidElement);
  return <View style={[{ borderRadius: CARD_RADIUS, overflow: 'hidden', gap: 2 }, style]}>{items}</View>;
}

/** A standalone card on the dark-gray surface. */
export function Card({ children, style, onPress, accent = false }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accent?: boolean }) {
  const c = useColors();
  // No border on the accent card: a hairline stroke on a large Android radius renders jagged corners.
  const body = <View style={[{ borderRadius: CARD_RADIUS, backgroundColor: accent ? c.mossDeep : c.surface2, padding: 18, gap: 6 }, style]}>{children}</View>;
  if (!onPress) return body;
  // The clip lives on a wrapper: a ripple on the rounded Pressable itself flashes square for a frame on Android.
  return (
    <View style={{ borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
      <Pressable onPress={() => (haptic.light(), onPress())} accessibilityRole="button" android_ripple={{ color: c.surface3 }}>{body}</Pressable>
    </View>
  );
}

type RowProps = {
  title: string;
  subtitle?: string;
  /** An icon name, or any element (a provider logo, an avatar). */
  icon?: IconName | ReactNode;
  /** Draws the icon inside a round chip, as in the + sheet. */
  iconChip?: boolean;
  onPress?: () => void;
  /** Shows a chevron at the end (default when there is an onPress and no other trailing content). */
  chevron?: boolean;
  /** A switch at the end; the whole row toggles it. */
  toggle?: { value: boolean; onChange: (value: boolean) => void; disabled?: boolean };
  /** A count badge at the end (connector tools). Numbers over 99 show as 99+. */
  badge?: number | string;
  trailing?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  /** Lines of subtitle before it truncates (default 3). */
  subtitleLines?: number;
  accessibilityLabel?: string;
};

/** One row of a Group: icon, title, optional subtitle, and a chevron, switch, badge or custom trailing part. */
export function Row({ title, subtitle, icon, iconChip, onPress, chevron, toggle, badge, trailing, destructive, disabled, subtitleLines = 3, accessibilityLabel }: RowProps) {
  const c = useColors();
  const press = toggle ? () => (haptic.toggle(!toggle.value), toggle.onChange(!toggle.value)) : onPress ? () => (haptic.light(), onPress()) : undefined;
  const glyph = typeof icon === 'string' ? <Icon name={icon as IconName} size={iconChip ? 22 : 24} color={destructive ? c.danger : c.text} /> : icon;
  const showChevron = chevron ?? (!!onPress && !toggle && badge === undefined && !trailing);
  const badgeText = typeof badge === 'number' && badge > 99 ? '99+' : badge;
  return (
    <Pressable
      onPress={press}
      disabled={disabled || (!press && !toggle)}
      accessibilityRole={toggle ? 'switch' : press ? 'button' : undefined}
      accessibilityState={toggle ? { checked: toggle.value, disabled } : { disabled }}
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
      android_ripple={press ? { color: c.surface3 } : undefined}
      style={[s.row, { backgroundColor: c.surface2, opacity: disabled ? 0.5 : 1 }]}
    >
      {glyph ? (iconChip ? <View style={[s.chip, { backgroundColor: c.surface3 }]}>{glyph}</View> : <View style={s.icon}>{glyph}</View>) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={{ fontFamily: font.semibold, fontSize: fs.md, color: destructive ? c.danger : c.text }}>{title}</Text>
        {subtitle ? <Text numberOfLines={subtitleLines} style={{ fontFamily: font.medium, fontSize: fs.base, lineHeight: 21, color: c.muted }}>{subtitle}</Text> : null}
      </View>
      {trailing}
      {badgeText !== undefined ? <Badge>{String(badgeText)}</Badge> : null}
      {toggle ? <Switch value={toggle.value} onValueChange={toggle.onChange} disabled={toggle.disabled} accessibilityLabel={title} /> : null}
      {showChevron ? <Icon name="chevronRight" size={20} color={c.muted} /> : null}
    </Pressable>
  );
}

/** Accent-tinted count pill. */
export function Badge({ children }: { children: string }) {
  const c = useColors();
  return (
    <View style={{ minWidth: 34, height: 30, paddingHorizontal: 10, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: c.mossDeep }}>
      <Text style={{ fontFamily: font.bold, fontSize: fs.base, color: c.sage }}>{children}</Text>
    </View>
  );
}

/** Rounded outline search box ("Search connectors"). */
export function SearchField({ style, ...props }: TextInputProps & { style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[s.search, { borderColor: c.border, backgroundColor: c.bg }, style]}>
      <Icon name="search" size={22} color={c.muted} />
      <TextInput
        placeholderTextColor={c.muted}
        autoCorrect={false}
        returnKeyType="search"
        style={{ flex: 1, fontFamily: font.medium, fontSize: fs.md, color: c.text, paddingVertical: 0 }}
        {...props}
      />
    </View>
  );
}

/** A labelled text field on the card surface (Profile, Create a project). */
export function Field({ label, style, multiline, ...props }: TextInputProps & { label?: string; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[{ gap: 8 }, style]}>
      {label ? <Text style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.secondary }}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={c.muted}
        multiline={multiline}
        style={[
          s.field,
          { borderColor: c.border, backgroundColor: c.surface2, color: c.text },
          multiline && { minHeight: 140, textAlignVertical: 'top', paddingTop: 16 },
        ]}
        {...props}
      />
    </View>
  );
}

/** Pressable that squishes slightly while held: the standard press feel for cards and pills. */
export function Squish({ children, onPress, style, accessibilityLabel, disabled }: { children: ReactNode; onPress: () => void; style?: StyleProp<ViewStyle>; accessibilityLabel?: string; disabled?: boolean }) {
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <Pressable
      onPress={() => (haptic.light(), onPress())}
      onPressIn={() => scale.set(withSpring(0.96, SPRING_PRESS))}
      onPressOut={() => scale.set(withSpring(1, SPRING_PRESS))}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
    >
      <Animated.View style={[anim, style, disabled && { opacity: 0.5 }]}>{children}</Animated.View>
    </Pressable>
  );
}

/** The high-contrast pill ("+ New session", "+ New project", "Connect"). `tone="muted"` for a disabled-looking gray. */
export function PillButton({ label, icon, onPress, tone = 'solid', disabled, style }: { label: string; icon?: IconName; onPress: () => void; tone?: 'solid' | 'muted' | 'outline'; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const bg = tone === 'solid' ? c.text : tone === 'muted' ? c.surface3 : 'transparent';
  const fg = tone === 'solid' ? c.bg : c.text;
  return (
    <Squish onPress={onPress} disabled={disabled} accessibilityLabel={label} style={[s.pill, { backgroundColor: bg, borderWidth: tone === 'outline' ? 1 : 0, borderColor: c.border }, style]}>
      {icon ? <Icon name={icon} size={22} color={fg} /> : null}
      <Text style={{ fontFamily: font.bold, fontSize: fs.md, color: fg }}>{label}</Text>
    </Squish>
  );
}

/** Centered empty state with an icon, a title and a hint. */
export function EmptyState({ icon, title, hint, children }: { icon: IconName; title: string; hint?: string; children?: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingVertical: 48, paddingHorizontal: 24 }}>
      <Icon name={icon} size={36} color={c.muted} />
      <Text style={{ fontFamily: font.semibold, fontSize: fs.lg, color: c.text, textAlign: 'center' }}>{title}</Text>
      {hint ? <Text style={{ fontFamily: font.sans, fontSize: fs.base, lineHeight: 22, color: c.muted, textAlign: 'center' }}>{hint}</Text> : null}
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 72, paddingHorizontal: 18, paddingVertical: 14, overflow: 'hidden' },
  icon: { width: 30, alignItems: 'center' },
  chip: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 54, borderRadius: 27, borderWidth: 1, paddingHorizontal: 18 },
  field: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 20, minHeight: TAP + 12, fontFamily: font.medium, fontSize: fs.md },
  pill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 56, paddingHorizontal: 26, borderRadius: 28 },
});
