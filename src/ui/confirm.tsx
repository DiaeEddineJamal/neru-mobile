// Neru's own dialogs, replacing the platform alert: a bottom sheet in the app's type, colours and buttons.
// `confirm()` asks before something destructive; `notice()` explains a problem with a single action. Both work
// from anywhere (screens or plain modules) through the one <DialogHost /> mounted in the root layout.
import { useSyncExternalStore } from 'react';
import { Linking, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { haptic } from '@/haptics';
import { font, fs, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';

type Dialog = {
  title: string;
  message: string;
  icon?: IconName;
  /** Confirm button label; omitted for a notice. */
  action?: string;
  destructive?: boolean;
  /** A notice can offer to open the phone's settings for this app. */
  settings?: boolean;
  resolve: (ok: boolean) => void;
};

let open: Dialog | null = null;
const listeners = new Set<() => void>();
const show = (d: Dialog | null) => ((open = d), listeners.forEach(l => l()));

export function confirm(o: { title: string; message: string; action: string; destructive?: boolean; icon?: IconName }): Promise<boolean> {
  if (o.destructive) haptic.warning();
  return new Promise(resolve => show({ ...o, resolve }));
}

export function notice(o: { title: string; message: string; icon?: IconName; settings?: boolean }): Promise<void> {
  return new Promise(resolve => show({ ...o, resolve: () => resolve() }));
}

export function DialogHost() {
  const c = useColors();
  const d = useSyncExternalStore(l => (listeners.add(l), () => listeners.delete(l)), () => open);
  const close = (ok: boolean) => {
    d?.resolve(ok);
    show(null);
  };
  const tone = d?.destructive ? c.danger : c.moss;

  return (
    <BottomSheet open={!!d} onClose={() => close(false)}>
      {d ? (
        <View style={{ gap: 18, paddingTop: 4, paddingBottom: 8 }}>
          <View style={{ width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: `${tone}1f` }}>
            <Icon name={d.icon ?? (d.destructive ? 'trash' : 'alertCircle')} size={22} color={tone} />
          </View>
          <View style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.serif, fontSize: 28, lineHeight: 34, color: c.text }}>{d.title}</Text>
            <Text style={{ fontFamily: font.sans, fontSize: fs.base, lineHeight: 23, color: c.secondary }}>{d.message}</Text>
          </View>
          <View style={{ gap: 4 }}>
            {d.action ? (
              <>
                <ActionButton title={d.action} variant={d.destructive ? 'destructive' : 'primary'} onPress={() => close(true)} />
                <ActionButton title="Cancel" variant="ghost" onPress={() => close(false)} />
              </>
            ) : (
              <>
                {d.settings ? <ActionButton title="Open settings" onPress={() => (void Linking.openSettings(), close(true))} /> : null}
                <ActionButton title={d.settings ? 'Not now' : 'Got it'} variant={d.settings ? 'ghost' : 'primary'} onPress={() => close(true)} />
              </>
            )}
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}
