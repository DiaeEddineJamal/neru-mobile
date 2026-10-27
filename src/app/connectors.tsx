// Connectors (MCP): apps like Jira, Gmail and GitHub that chats can use, with any model, cloud or on this phone.
// The ones added here connect straight from the phone; while a paired desktop is connected, its connectors join in.
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { haptic } from '@/haptics';
import { t as tx } from '@/i18n';
import { available, addConnector, connect, refresh, refreshDesktop, removeConnector, setEnabled, setUseDesktop, signOut, useMcp, type Connector } from '@/mcp/store';
import { logoUrl, type CatalogEntry } from '@/mcp/catalog';
import { useRemote } from '@/remote/store';
import { updateSettings, useStore } from '@/store';
import { font, fs, TAP, useBottomPad, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';
import { confirm } from '@/ui/confirm';
import { TextField } from '@/ui/input';
import { Loader } from '@/ui/loader';
import { Switch } from '@/ui/switch';
import { useToast } from '@/ui/toast';

function Logo({ logo, name }: { logo?: string; name: string }) {
  const c = useColors();
  const [failed, setFailed] = useState(false);
  const uri = logoUrl(logo);
  return (
    <View style={[s.logo, { backgroundColor: c.surface3 }]}>
      {uri && !failed ? (
        <Image source={{ uri }} style={{ width: 20, height: 20 }} contentFit="contain" onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
      ) : (
        <Text style={{ fontFamily: font.semibold, fontSize: fs.base, color: c.text }}>{name[0]}</Text>
      )}
    </View>
  );
}

export default function Connectors() {
  const c = useColors();
  const toast = useToast();
  const bottomPad = useBottomPad();
  const connectors = useMcp(st => st.connectors);
  const live = useMcp(st => st.live);
  const useDesktop = useMcp(st => st.useDesktop);
  const desktopTools = useMcp(st => st.desktopTools);
  const desktopName = useRemote(st => st.desktopName);
  const connected = useRemote(st => st.status === 'connected');
  const enabled = useStore(st => st.settings.connectors !== false);
  const [busy, setBusy] = useState<string | null>(null);
  const [tokenFor, setTokenFor] = useState<Connector | null>(null);
  const [token, setToken] = useState('');
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState({ name: '', url: '', token: '' });

  useEffect(() => {
    void refreshDesktop();
  }, [connected, useDesktop]);

  const run = async (id: string, action: () => Promise<void>) => {
    setBusy(id);
    try {
      await action();
      haptic.success();
    } catch (err) {
      toast.show({ title: tx('Could not connect'), description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const add = (entry: CatalogEntry) => {
    const id = addConnector({ name: entry.name, url: entry.url, auth: entry.auth, logo: entry.logo, scopes: entry.scopes });
    const added = { id, name: entry.name, url: entry.url, auth: entry.auth, enabled: true, allowed: [] } as Connector;
    if (entry.auth === 'token') return (setToken(''), setTokenFor(added));
    void run(id, () => (entry.auth === 'none' ? refresh(id) : connect(id)));
  };

  const addCustom = () => {
    const url = draft.url.trim();
    if (!/^https:\/\//.test(url)) return toast.show({ title: tx('Use an https:// address'), description: tx('The phone connects to hosted MCP servers over Streamable HTTP.') });
    const id = addConnector({ name: draft.name.trim() || url.replace(/^https:\/\//, '').split('/')[0], url, auth: draft.token.trim() ? 'token' : 'oauth' });
    setCustom(false);
    void run(id, async () => {
      if (draft.token.trim()) await connect(id, draft.token);
      else {
        // No token: try without one, and sign in if the server asks.
        await refresh(id);
      }
    });
    setDraft({ name: '', url: '', token: '' });
  };

  const statusLine = (x: Connector) => {
    const l = live[x.id];
    if (!x.enabled) return { text: tx('Off'), color: c.muted };
    if (!l || l.status === 'connecting') return { text: tx('Connecting…'), color: c.muted };
    if (l.status === 'ready') return { text: `${tx('Connected')} · ${l.tools.length === 1 ? tx('1 tool') : tx('{n} tools', { n: l.tools.length })}`, color: c.moss };
    if (l.status === 'signin') return { text: x.auth === 'token' ? tx('Add a token to connect') : tx('Sign in to connect'), color: c.codeChip };
    return { text: l.error ?? tx('Not connected'), color: c.danger };
  };

  const catalog = available();

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottomPad + 36 }} keyboardShouldPersistTaps="handled">
      <Text style={{ fontFamily: font.sans, fontSize: fs.base, color: c.secondary, lineHeight: 22 }}>
        {tx('Let chats read and act in your apps: Jira, Gmail, GitHub, Notion and more. They work with free models and with models running on this phone.')}
      </Text>
      <View style={[s.row, { backgroundColor: c.surface2, borderColor: c.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: font.medium, fontSize: fs.base, color: c.text }}>{tx('Use connectors in chats')}</Text>
          <Text style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>{tx('Neru asks before a tool changes anything')}</Text>
        </View>
        <Switch value={enabled} onValueChange={v => updateSettings({ connectors: v })} accessibilityLabel={tx('Use connectors in chats')} />
      </View>

      <Text style={[s.section, { color: c.muted }]}>{tx('ON THIS PHONE')}</Text>
      {connectors.length === 0 ? <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.muted }}>{tx('None yet. Add one below; it works without your desktop.')}</Text> : null}
      {connectors.map(x => {
        const st = statusLine(x);
        const l = live[x.id];
        return (
          <View key={x.id} style={[s.card, { backgroundColor: c.surface2, borderColor: c.border }]}>
            <View style={s.head}>
              <Logo logo={x.logo} name={x.name} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: fs.base, color: c.text }}>{x.name}</Text>
                <Text numberOfLines={2} style={{ fontFamily: font.sans, fontSize: fs.xs, color: st.color }}>{st.text}</Text>
              </View>
              {busy === x.id ? <Loader size={18} /> : <Switch value={x.enabled} onValueChange={v => setEnabled(x.id, v)} accessibilityLabel={tx('{name} on', { name: x.name })} />}
            </View>
            {l?.status === 'ready' && l.tools.length ? (
              <Text numberOfLines={2} style={{ fontFamily: font.mono, fontSize: 11, color: c.muted }}>{l.tools.map(t => t.name).join(' · ')}</Text>
            ) : null}
            <View style={s.actions}>
              {x.enabled && l?.status === 'signin' ? (
                x.auth === 'token' ? (
                  <ActionButton title={tx('Add token')} variant="secondary" icon="lock" onPress={() => (setToken(''), setTokenFor(x))} style={{ flex: 1 }} />
                ) : (
                  <ActionButton title={x.auth === 'google' ? tx('Sign in with Google') : tx('Sign in')} variant="secondary" icon="link" onPress={() => void run(x.id, () => connect(x.id))} style={{ flex: 1 }} />
                )
              ) : null}
              {x.enabled && l?.status === 'error' ? <ActionButton title={tx('Retry')} variant="secondary" icon="retry" onPress={() => void run(x.id, () => refresh(x.id))} style={{ flex: 1 }} /> : null}
              {l?.status === 'ready' && x.auth !== 'none' ? <ActionButton title={tx('Sign out')} variant="ghost" onPress={() => void signOut(x.id)} style={{ flex: 1 }} /> : null}
              <ActionButton
                title={tx('Remove')}
                variant="ghost"
                icon="trash"
                onPress={async () => {
                  if (await confirm({ title: tx('Remove {name}?', { name: x.name }), message: tx('Chats stop using it, and its sign-in is deleted from this phone.'), action: tx('Remove'), destructive: true })) await removeConnector(x.id);
                }}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        );
      })}

      <Text style={[s.section, { color: c.muted }]}>{tx('FROM YOUR DESKTOP')}</Text>
      <View style={[s.card, { backgroundColor: c.surface2, borderColor: c.border }]}>
        <View style={s.head}>
          <View style={[s.logo, { backgroundColor: c.surface3 }]}><Icon name="desktop" size={18} color={c.text} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: font.semibold, fontSize: fs.base, color: c.text }}>{desktopName ?? tx('Your desktop')}</Text>
            <Text style={{ fontFamily: font.sans, fontSize: fs.xs, color: connected && desktopTools.length ? c.moss : c.muted }}>
              {!desktopName ? tx('Pair your desktop to also use its connectors, like Gmail or Slack') : !connected ? tx('Offline. The connectors on this phone still work.') : !useDesktop ? tx('Off') : desktopTools.length ? `${tx('Connected')} · ${tx('{tools} tools from {connectors} connectors', { tools: desktopTools.length, connectors: new Set(desktopTools.map(t => t.server)).size })}` : tx('No connectors running on the desktop')}
            </Text>
          </View>
          {desktopName ? <Switch value={useDesktop} onValueChange={setUseDesktop} accessibilityLabel={tx("Use the desktop's connectors")} /> : null}
        </View>
        {!desktopName ? <ActionButton title={tx('Pair a desktop')} variant="secondary" icon="qr" onPress={() => router.push('/pair')} /> : null}
      </View>

      <Text style={[s.section, { color: c.muted }]}>{tx('ADD A CONNECTOR')}</Text>
      {catalog.map(entry => {
        return (
          <Pressable key={entry.id} onPress={() => add(entry)} accessibilityRole="button" android_ripple={{ color: c.surface3 }} style={[s.row, { backgroundColor: c.surface2, borderColor: c.border }]}>
            <Logo logo={entry.logo} name={entry.name} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontFamily: font.medium, fontSize: fs.base, color: c.text }}>{entry.name}</Text>
              <Text numberOfLines={2} style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>{tx(entry.description)}</Text>
            </View>
            <Icon name={entry.auth === 'none' ? 'plus' : entry.auth === 'token' ? 'lock' : 'link'} size={18} color={c.muted} />
          </Pressable>
        );
      })}
      <ActionButton title={tx('Add by address')} variant="secondary" icon="plus" onPress={() => setCustom(true)} />

      <BottomSheet open={!!tokenFor} onClose={() => setTokenFor(null)} title={tokenFor ? tx('{name} token', { name: tokenFor.name }) : undefined}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <TextField label={tx('Access token')} value={token} onChangeText={setToken} placeholder={tx('Paste the token')} secureTextEntry autoCapitalize="none" autoCorrect={false} autoFocus />
          <ActionButton
            title={tx('Connect')}
            disabled={!token.trim()}
            onPress={() => {
              const target = tokenFor;
              setTokenFor(null);
              if (target) void run(target.id, () => connect(target.id, token));
            }}
          />
        </View>
      </BottomSheet>
      <BottomSheet open={custom} onClose={() => setCustom(false)} title={tx('Add by address')}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <TextField label={tx('Name')} value={draft.name} onChangeText={name => setDraft(d => ({ ...d, name }))} placeholder={tx('My server')} />
          <TextField label={tx('Server address')} value={draft.url} onChangeText={url => setDraft(d => ({ ...d, url }))} placeholder="https://example.com/mcp" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <TextField label={tx('Token (optional)')} value={draft.token} onChangeText={t => setDraft(d => ({ ...d, token: t }))} placeholder={tx('Leave empty to sign in')} secureTextEntry autoCapitalize="none" autoCorrect={false} />
          <ActionButton title={tx('Add')} disabled={!draft.url.trim()} onPress={addCustom} />
        </View>
      </BottomSheet>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  section: { fontFamily: font.medium, fontSize: fs.xs, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: TAP + 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  card: { gap: 10, padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actions: { flexDirection: 'row', gap: 8 },
  logo: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
