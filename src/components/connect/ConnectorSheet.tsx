// One connector's details: status, on/off, its tools, and reconnect, sign out and remove.
import { Text, View } from 'react-native';

import { ConnectorLogo } from '@/components/connect/ConnectorLogo';
import { t } from '@/i18n';
import { entryFor } from '@/mcp/catalog';
import { connect, refresh, removeConnector, setEnabled, signOut, useMcp, type Connector } from '@/mcp/store';
import { font, fs, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';
import { confirm } from '@/ui/confirm';
import { Loader } from '@/ui/loader';
import { Group, Row } from '@/ui/page';

type Flow = { busy: string | null; run: (id: string, action: () => Promise<void>) => Promise<void>; askToken: (x: Connector) => void };

/** Status line for a phone connector, and its tone. */
export function useStatus() {
  const c = useColors();
  const live = useMcp(st => st.live);
  return (x: Connector) => {
    const l = live[x.id];
    if (!x.enabled) return { text: t('Off'), color: c.muted, ready: false };
    if (!l || l.status === 'connecting') return { text: t('Connecting…'), color: c.muted, ready: false };
    if (l.status === 'ready') return { text: l.tools.length === 1 ? t('Connected · 1 tool') : t('Connected · {n} tools', { n: l.tools.length }), color: c.sage, ready: true };
    if (l.status === 'signin') return { text: x.auth === 'token' ? t('Add a token to connect') : t('Sign in to connect'), color: c.codeChip, ready: false };
    return { text: l.error ?? t('Not connected'), color: c.danger, ready: false };
  };
}

export function ConnectorSheet({ id, onClose, flow }: { id: string | null; onClose: () => void; flow: Flow }) {
  const c = useColors();
  const x = useMcp(st => st.connectors.find(k => k.id === id) ?? null);
  const l = useMcp(st => (id ? st.live[id] : undefined));
  const status = useStatus();
  const st = x ? status(x) : null;
  const busy = !!x && flow.busy === x.id;

  const signIn = (k: Connector) => (k.auth === 'token' ? (onClose(), flow.askToken(k)) : void flow.run(k.id, () => (k.auth === 'none' ? refresh(k.id) : connect(k.id))));

  return (
    <BottomSheet open={!!x} onClose={onClose} title={x?.name}>
      {x && st ? (
        <View style={{ gap: 16, paddingBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <ConnectorLogo name={x.name} logo={x.logo} color={entryFor(x)?.color} size={48} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text numberOfLines={3} style={{ fontFamily: font.medium, fontSize: fs.base, color: st.color }}>{st.text}</Text>
              <Text numberOfLines={1} style={{ fontFamily: font.mono, fontSize: 11, color: c.muted }}>{x.url.replace(/^https:\/\//, '')}</Text>
            </View>
            {busy ? <Loader size={20} /> : null}
          </View>

          <Group>
            <Row title={t('Use in chats')} subtitle={t('Chats can call its tools; Neru asks before a tool changes anything')} toggle={{ value: x.enabled, onChange: v => setEnabled(x.id, v) }} />
          </Group>

          {x.enabled && l?.status === 'signin' ? (
            <ActionButton title={x.auth === 'token' ? t('Add token') : x.auth === 'google' ? t('Sign in with Google') : t('Sign in')} icon={x.auth === 'token' ? 'lock' : 'link'} onPress={() => signIn(x)} loading={busy} />
          ) : null}
          {x.enabled && l?.status === 'error' ? <ActionButton title={t('Retry')} icon="retry" onPress={() => void flow.run(x.id, () => refresh(x.id))} loading={busy} /> : null}

          {st.ready && l?.tools.length ? (
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="header" style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.secondary, paddingHorizontal: 4 }}>
                {l.tools.length === 1 ? t('1 tool') : t('{n} tools', { n: l.tools.length })}
              </Text>
              <Group>
                {l.tools.map(tool => (
                  <Row
                    key={tool.name}
                    title={tool.title ?? tool.name}
                    subtitle={[tool.readOnly ? t('Read only') : x.allowed.includes(tool.name) ? t('Always allowed') : t('Asks first'), tool.description].filter(Boolean).join(' · ')}
                    subtitleLines={2}
                  />
                ))}
              </Group>
            </View>
          ) : null}

          <View style={{ gap: 8 }}>
            {x.enabled && (st.ready || l?.status === 'error') ? (
              <ActionButton title={t('Reconnect')} variant="secondary" icon="retry" loading={busy} onPress={() => signIn(x)} />
            ) : null}
            {l?.status === 'ready' && x.auth !== 'none' ? <ActionButton title={t('Sign out')} variant="ghost" icon="logout" onPress={() => void signOut(x.id)} /> : null}
            <ActionButton
              title={t('Remove')}
              variant="destructive"
              icon="trash"
              onPress={async () => {
                if (await confirm({ title: t('Remove {name}?', { name: x.name }), message: t('Chats stop using it, and its sign-in is deleted from this phone.'), action: t('Remove'), destructive: true })) {
                  onClose();
                  await removeConnector(x.id);
                }
              }}
            />
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}
