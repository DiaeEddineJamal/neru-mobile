// The connect flow shared by Connectors and Browse connectors: add a catalog entry, then sign in (browser or
// Google), ask for a token, or just connect; plus the token sheet that flow needs.
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { haptic } from '@/haptics';
import { t } from '@/i18n';
import { addConnector, connect, refresh, type Connector } from '@/mcp/store';
import { entryFor, type CatalogEntry } from '@/mcp/catalog';
import { font, fs, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';
import { TextField } from '@/ui/input';
import { useToast } from '@/ui/toast';

export function useConnectFlow() {
  const c = useColors();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [tokenFor, setTokenFor] = useState<Connector | null>(null);
  const [token, setToken] = useState('');

  const run = async (id: string, action: () => Promise<void>) => {
    setBusy(id);
    try {
      await action();
      haptic.success();
    } catch (err) {
      haptic.error();
      toast.show({ title: t('Could not connect'), description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const askToken = (x: Connector) => {
    setToken('');
    setTokenFor(x);
  };

  /** Adds a catalog entry and starts its sign-in. Returns the new connector's id. */
  const add = (entry: CatalogEntry) => {
    const id = addConnector({ name: entry.name, url: entry.url, auth: entry.auth, logo: entry.logo, scopes: entry.scopes });
    const added: Connector = { id, name: entry.name, url: entry.url, auth: entry.auth, enabled: true, allowed: [], logo: entry.logo, scopes: entry.scopes };
    if (entry.auth === 'token') askToken(added);
    else void run(id, () => (entry.auth === 'none' ? refresh(id) : connect(id)));
    return id;
  };

  const hint = tokenFor ? entryFor(tokenFor)?.tokenHint : undefined;
  const hintUrl = hint?.match(/[a-z0-9.-]+\.[a-z]{2,}\/[^\s]*/i)?.[0];

  const sheet = (
    <BottomSheet open={!!tokenFor} onClose={() => setTokenFor(null)} title={tokenFor ? t('{name} token', { name: tokenFor.name }) : undefined}>
      <View style={{ gap: 12, paddingBottom: 8 }}>
        {hint ? <Text style={{ fontFamily: font.sans, fontSize: fs.sm, lineHeight: 20, color: c.secondary }}>{t(hint)}</Text> : null}
        {hintUrl ? <ActionButton title={t('Get a token')} variant="ghost" icon="link" onPress={() => void Linking.openURL(`https://${hintUrl}`)} /> : null}
        <TextField label={t('Access token')} value={token} onChangeText={setToken} placeholder={t('Paste the token')} secureTextEntry autoCapitalize="none" autoCorrect={false} autoFocus />
        <ActionButton
          title={t('Connect')}
          disabled={!token.trim()}
          onPress={() => {
            const target = tokenFor;
            const value = token;
            setTokenFor(null);
            if (target) void run(target.id, () => connect(target.id, value));
          }}
        />
      </View>
    </BottomSheet>
  );

  return { busy, run, add, askToken, sheet };
}
