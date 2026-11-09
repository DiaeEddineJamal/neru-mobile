// Connectors (MCP): apps like Jira, Gmail and GitHub that chats can use, with any model, cloud or on this phone.
// The ones added here connect straight from the phone; while a paired desktop is connected, its connectors join in.
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { ConnectorLogo } from '@/components/connect/ConnectorLogo';
import { ConnectorSheet, useStatus } from '@/components/connect/ConnectorSheet';
import { useConnectFlow } from '@/components/connect/useConnectFlow';
import { Icon, IconButton } from '@/components/Icon';
import { t } from '@/i18n';
import { entryFor } from '@/mcp/catalog';
import { addConnector, available, connect, refresh, refreshDesktop, setUseDesktop, useMcp } from '@/mcp/store';
import { useRemote } from '@/remote/store';
import { updateSettings, useStore } from '@/store';
import { font, fs, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';
import { TextField } from '@/ui/input';
import { Loader } from '@/ui/loader';
import { Card, Group, PageScroll, Row, SectionLabel } from '@/ui/page';
import { useToast } from '@/ui/toast';

/** How many not-yet-added connectors to suggest at the bottom before "Browse connectors". */
const SUGGESTED = 4;

export default function Connectors() {
  const c = useColors();
  const toast = useToast();
  const flow = useConnectFlow();
  const status = useStatus();
  const connectors = useMcp(st => st.connectors);
  const live = useMcp(st => st.live);
  const useDesktop = useMcp(st => st.useDesktop);
  const desktopTools = useMcp(st => st.desktopTools);
  const desktopName = useRemote(st => st.desktopName);
  const connected = useRemote(st => st.status === 'connected');
  const enabled = useStore(st => st.settings.connectors !== false);
  const [open, setOpen] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState({ name: '', url: '', token: '' });

  useEffect(() => {
    void refreshDesktop();
  }, [connected, useDesktop]);

  const addCustom = () => {
    const url = draft.url.trim();
    if (!/^https:\/\//.test(url)) return toast.show({ title: t('Use an https:// address'), description: t('The phone connects to hosted MCP servers over Streamable HTTP.') });
    const token = draft.token.trim();
    const id = addConnector({ name: draft.name.trim() || url.replace(/^https:\/\//, '').split('/')[0], url, auth: token ? 'token' : 'oauth' });
    setCustom(false);
    setDraft({ name: '', url: '', token: '' });
    // No token: try without one; it asks to sign in if the server wants that.
    void flow.run(id, () => (token ? connect(id, token) : refresh(id)));
  };

  const suggestions = available().slice(0, SUGGESTED);
  const desktopServers = new Set(desktopTools.map(x => x.server)).size;
  const desktopLine = !desktopName
    ? t('Pair your desktop to also use its connectors, like Gmail or Slack')
    : !connected
      ? t('Offline. The connectors on this phone still work.')
      : !useDesktop
        ? t('Off')
        : desktopTools.length
          ? t('{tools} tools from {connectors} connectors', { tools: desktopTools.length, connectors: desktopServers })
          : t('No connectors running on the desktop');

  return (
    <>
      <Stack.Screen options={{ headerRight: () => <IconButton name="plus" label={t('Add a custom connector')} color={c.text} onPress={() => setCustom(true)} /> }} />
      <PageScroll>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <Row
            icon="connectors"
            title={t('Use connectors in chats')}
            subtitle={t('Chats can read and act in your apps, with any model. Neru asks before a tool changes anything.')}
            toggle={{ value: enabled, onChange: v => updateSettings({ connectors: v }) }}
          />
        </Card>

        {connectors.length ? (
          <Group>
            {connectors.map(x => {
              const st = status(x);
              const l = live[x.id];
              return (
                <Row
                  key={x.id}
                  icon={<ConnectorLogo name={x.name} logo={x.logo} color={entryFor(x)?.color} size={36} />}
                  title={x.name}
                  subtitle={st.ready ? undefined : st.text}
                  subtitleLines={2}
                  badge={st.ready ? l?.tools.length ?? 0 : undefined}
                  trailing={flow.busy === x.id ? <Loader size={18} /> : undefined}
                  chevron={!st.ready && flow.busy !== x.id}
                  onPress={() => setOpen(x.id)}
                />
              );
            })}
          </Group>
        ) : (
          <Text style={{ fontFamily: font.sans, fontSize: fs.base, lineHeight: 22, color: c.muted, paddingHorizontal: 16 }}>
            {t('No connectors yet. Add one below; it works without your desktop.')}
          </Text>
        )}

        <SectionLabel>{t('From your desktop')}</SectionLabel>
        <Group>
          <Row
            icon="desktop"
            title={desktopName ?? t('Your desktop')}
            subtitle={desktopLine}
            badge={desktopName && connected && useDesktop && desktopTools.length ? desktopTools.length : undefined}
            toggle={desktopName ? { value: useDesktop, onChange: setUseDesktop } : undefined}
            onPress={desktopName ? undefined : () => router.push('/pair')}
          />
        </Group>

        <SectionLabel>{t('Add a connector')}</SectionLabel>
        <Group>
          {suggestions.map(entry => (
            <Row
              key={entry.id}
              icon={<ConnectorLogo name={entry.name} logo={entry.logo} color={entry.color} size={36} />}
              title={entry.name}
              subtitle={t(entry.description)}
              subtitleLines={1}
              onPress={() => flow.add(entry)}
              trailing={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontFamily: font.semibold, fontSize: fs.base, color: c.secondary }}>{t('Connect')}</Text>
                  <Icon name="link" size={18} color={c.secondary} />
                </View>
              }
            />
          ))}
          <Row icon="search" title={t('Browse connectors')} subtitle={t('Find more by category')} onPress={() => router.push('/connectors-browse')} />
          <Row icon="plus" title={t('Add by address')} subtitle={t('Any hosted MCP server')} onPress={() => setCustom(true)} />
        </Group>
      </PageScroll>

      <ConnectorSheet id={open} onClose={() => setOpen(null)} flow={flow} />
      {flow.sheet}
      <BottomSheet open={custom} onClose={() => setCustom(false)} title={t('Add by address')}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Text style={{ fontFamily: font.sans, fontSize: fs.sm, lineHeight: 20, color: c.secondary }}>{t('Connect a hosted MCP server over Streamable HTTP. Leave the token empty to sign in in the browser.')}</Text>
          <TextField label={t('Name')} value={draft.name} onChangeText={name => setDraft(d => ({ ...d, name }))} placeholder={t('My server')} />
          <TextField label={t('Server address')} value={draft.url} onChangeText={url => setDraft(d => ({ ...d, url }))} placeholder="https://example.com/mcp" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <TextField label={t('Token (optional)')} value={draft.token} onChangeText={token => setDraft(d => ({ ...d, token }))} placeholder={t('Leave empty to sign in')} secureTextEntry autoCapitalize="none" autoCorrect={false} />
          <ActionButton title={t('Add')} disabled={!draft.url.trim()} onPress={addCustom} />
        </View>
      </BottomSheet>
    </>
  );
}
