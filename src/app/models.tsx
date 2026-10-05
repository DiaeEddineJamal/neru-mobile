import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';

import { Icon } from '@/components/Icon';
import { localModels, sizeLabel, type LocalModel } from '@/local/catalog';
import { configForLocal, saveLocalConfig } from '@/local/config';
import { account, openHub, openLicense, saveToken, signIn, signInAvailable, signOut } from '@/local/huggingface';
import { deviceMemoryGB, downloadModel, fitsMemory, GatedError, pauseDownload, refreshDownloads, removeModel, useDownloads } from '@/local/models';
import { localAvailable, unloadLocal } from '@/local/runtime';
import { chooseModel, updateSettings, useStore } from '@/store';
import { font, fs, useColors } from '@/theme';
import { AnimatedBadge } from '@/ui/animated-badge';
import { ActionButton } from '@/ui/button-base';
import { BottomSheet } from '@/ui/bottom-sheet';
import { confirm } from '@/ui/confirm';
import { TextField } from '@/ui/input';
import { SegmentedTabs } from '@/ui/tabs';
import { Switch } from '@/ui/switch';
import { useToast } from '@/ui/toast';

export default function Models() {
  const c = useColors();
  const toast = useToast();
  const downloads = useDownloads();
  const selected = useStore(s => s.settings);
  const streaming = useStore(s => s.streamingChat !== null);
  const [hfUser, setHfUser] = useState<string | null>(null);
  const [configModel, setConfigModel] = useState<LocalModel | null>(null);
  const [filter, setFilter] = useState('all');
  const [token, setToken] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const page = useRef<KeyboardAwareScrollViewRef>(null);
  const run = (p: Promise<unknown>) => p.catch(e => toast.show({ title: 'On-device models', description: String(e?.message ?? e) }));
  useEffect(() => { void refreshDownloads().catch(() => {}); void account().then(setHfUser); }, []);
  // Gated models, as in Edge Gallery: sign in with Hugging Face when asked, accept the license when asked,
  // and pick the download back up after each step without another tap.
  const get = async (m: LocalModel) => {
    for (let step = 0; ; step++) {
      try { return await downloadModel(m); }
      catch (e) {
        if (!(e instanceof GatedError) || step >= 2) throw e;
        if (e.status === 401) {
          // No sign-in app in this build: the token field below is the way in.
          if (!signInAvailable) { page.current?.scrollToEnd({ animated: true }); throw e; }
          await signIn();
          setHfUser(await account());
        } else {
          toast.show({ title: 'Accept the license', description: `Agree to ${m.name}'s terms on the page that opens, then come back.` });
          await openLicense(m.repo);
        }
      }
    }
  };
  // Straight into a new chat with the model, from wherever Pocket Lab was opened (Settings or the model sheet).
  const choose = (id: string) => { chooseModel('on-device', id); updateSettings({ onboarded: true }); toast.show({ title: 'On-device model selected', description: 'Your messages stay on this phone.' }); router.dismissAll(); router.navigate('/'); };
  const addToken = async () => {
    setSavingToken(true);
    setTokenError('');
    try { setHfUser(await saveToken(token)); setToken(''); toast.show({ title: 'Hugging Face token saved', description: 'Gated models download with your account now.' }); }
    catch (e) { setTokenError(e instanceof Error ? e.message : String(e)); }
    finally { setSavingToken(false); }
  };
  const remove = async (m: LocalModel) => {
    const ok = await confirm({ title: `Remove ${m.name}?`, message: `This frees ${sizeLabel(m.bytes)} on your phone. Your conversations stay, and you can download the model again any time.`, action: 'Remove download', destructive: true });
    if (!ok) return;
    await run((async () => { await unloadLocal(); await removeModel(m.id); if (selected.providerId === 'on-device' && selected.model === m.id) chooseModel('on-device', ''); toast.show({ title: `${m.name} removed` }); })());
  };
  return (
    <><KeyboardAwareScrollView ref={page} bottomOffset={96} style={{ backgroundColor: c.bg }} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <View style={{ gap: 8 }}>
        <Icon name="sparkles" size={28} color={c.sage} />
        <Text style={[s.title, { color: c.text }]}>Big ideas. Pocket-sized.</Text>
        <Text style={[s.body, { color: c.secondary }]}>Welcome to Pocket Lab. Download once, then run models offline: every model in Google AI Edge Gallery, plus open models for coding and everyday chat that need no account.</Text>
        <Text style={[s.caption, { color: c.muted }]}>{deviceMemoryGB ? `${deviceMemoryGB.toFixed(1)} GB device memory · ` : ''}Text, documents and photos with Gemma 4 and Gemma 3n · No API key for chat</Text>
        {!localAvailable ? <Text style={[s.body, { color: c.danger }]}>Available in the Neru Android build with LiteRT-LM. On-device inference is unavailable in Expo Go, the web app and iOS.</Text> : null}
      </View>
      <SegmentedTabs items={[{ value: 'all', label: `All ${localModels.length}` }, { value: 'chat', label: 'Chat' }, { value: 'tools', label: 'Tools' }, { value: 'segmenter', label: 'Vision' }]} value={filter} onChange={setFilter} />
      {localModels.filter(m => filter === 'all' || m.kind === filter).map(m => {
        const d = downloads[m.id];
        const phase = d?.phase ?? 'available';
        const busy = phase === 'downloading' || phase === 'verifying';
        const ready = phase === 'ready';
        const current = selected.providerId === 'on-device' && selected.model === m.id;
        const compatible = fitsMemory(m);
        return (
          <View key={m.id} style={[s.card, { backgroundColor: c.surface2, borderColor: current ? c.moss : c.border }]}>
            <View style={s.row}><Text style={[s.name, { color: c.text }]}>{m.name}</Text>{ready ? <AnimatedBadge status="done" label={current ? 'Selected' : 'Downloaded'} /> : null}</View>
            <Text style={[s.caption, { color: c.sage }]}>{sizeLabel(m.bytes)}{m.memory ? ` · ${m.memory} GB RAM recommended` : ''} · {m.kind === 'segmenter' ? 'Photo selection' : m.kind === 'tools' ? 'Function calling' : 'Chat'}</Text>
            <Text style={[s.body, { color: c.secondary }]}>{m.description}</Text>
            {m.gated && !ready ? <Text style={[s.caption, { color: c.muted }]}>{hfUser ? 'License on Hugging Face · accept it once when asked' : 'Needs a Hugging Face account · add your token below'}</Text> : null}
            {!compatible ? <Text style={[s.caption, { color: c.danger }]}>This model exceeds Google’s memory recommendation for this phone.</Text> : null}
            {busy || phase === 'paused' ? <View style={{ gap: 8 }}><View style={[s.track, { backgroundColor: c.surface3 }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round((d?.progress ?? 0) * 100) }}><View style={{ width: `${(d?.progress ?? 0) * 100}%`, height: 4, backgroundColor: c.moss }} /></View><Text style={[s.caption, { color: c.muted }]}>{phase === 'verifying' ? 'Checking the download…' : d?.note && phase === 'downloading' ? `${d.note} · ${Math.round((d?.progress ?? 0) * 100)}%` : `${phase === 'paused' ? 'Paused · ' : ''}${Math.round((d?.progress ?? 0) * 100)}%`}</Text></View> : null}
            {d?.error ? <Text style={[s.caption, { color: c.danger }]}>{d.error}</Text> : null}
            {ready ? <View style={{ gap: 4 }}><ActionButton title={m.kind === 'segmenter' ? 'Try Magic Touch' : current ? 'Start chatting' : 'Use this model'} disabled={streaming} onPress={() => m.kind === 'segmenter' ? router.push('/magic-touch') : choose(m.id)} /><ActionButton title="Remove download" variant="ghost" disabled={streaming} onPress={() => void remove(m)} /></View>
              : phase === 'downloading' ? <ActionButton title="Pause download" variant="secondary" onPress={() => run(pauseDownload(m.id))} />
              : <ActionButton title={phase === 'verifying' ? 'Checking download' : phase === 'paused' ? 'Resume download' : `Download · ${sizeLabel(m.bytes)}`} icon="download" loading={phase === 'verifying'} disabled={!localAvailable || !compatible || Object.values(downloads).some(d => d.phase === 'downloading' || d.phase === 'verifying')} variant="secondary" onPress={() => run(get(m))} />}
            <ActionButton title="Model configuration" variant="secondary" disabled={streaming} onPress={() => setConfigModel(m)} />
            <ActionButton title="Model details and terms" variant="ghost" onPress={() => run(m.url ? Linking.openURL('https://developers.google.com/edge/mediapipe/solutions/vision/interactive_segmenter') : openLicense(m.repo))} />
          </View>
        );
      })}
      {/* Gemma 3, Gemma 3n and FunctionGemma need a Hugging Face account that accepted their license. */}
      <View style={[s.card, { backgroundColor: c.surface2, borderColor: c.border }]}>
        <Text style={[s.name, { color: c.text }]}>Hugging Face</Text>
        {hfUser ? <>
          <Text style={[s.body, { color: c.secondary }]}>Signed in as {hfUser}. Models with a license, like Gemma 3 and Gemma 3n, download with this account.</Text>
          <ActionButton title="Sign out" variant="ghost" onPress={() => run(signOut().then(() => { setHfUser(null); toast.show({ title: 'Signed out of Hugging Face' }); }))} />
        </> : <>
          <Text style={[s.body, { color: c.secondary }]}>Gemma 3, Gemma 3n and FunctionGemma ask you to accept Google’s license first. Create an access token with Read access on Hugging Face and paste it here. It stays in this phone’s secure storage.</Text>
          {signInAvailable ? <ActionButton title="Sign in with Hugging Face" onPress={() => run(signIn().then(account).then(setHfUser))} /> : null}
          <TextField label="Access token" value={token} onChangeText={t => (setToken(t), setTokenError(''))} placeholder="hf_…" autoCapitalize="none" autoCorrect={false} secureTextEntry error={tokenError} />
          <ActionButton title="Save token" loading={savingToken} disabled={!token.trim()} onPress={() => void addToken()} />
          <ActionButton title="Create a token on Hugging Face" variant="ghost" onPress={() => run(openHub('settings/tokens/new?tokenType=read'))} />
        </>}
      </View>
    </KeyboardAwareScrollView>{configModel ? <ModelConfig key={configModel.id} model={configModel} onClose={() => setConfigModel(null)} /> : null}</>
  );
}

function ModelConfig({ model: m, onClose }: { model: LocalModel; onClose: () => void }) {
  const c = useColors();
  const toast = useToast();
  const [config, setConfig] = useState(() => configForLocal(m.id));
  const [numbers, setNumbers] = useState(() => Object.fromEntries(['contextTokens', 'maxTokens', 'topK', 'topP', 'temperature'].map(k => [k, String(config[k as keyof typeof config])])));
  const [error, setError] = useState('');
  const reset = () => { setConfig(m.defaults); setNumbers(Object.fromEntries(['contextTokens', 'maxTokens', 'topK', 'topP', 'temperature'].map(k => [k, String(m.defaults[k as keyof typeof config])]))); setError(''); };
  const save = async () => {
    try { await saveLocalConfig(m.id, { ...config, ...Object.fromEntries(Object.entries(numbers).map(([k, v]) => [k, Number(v)])) }); toast.show({ title: 'Configuration saved', description: m.name }); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <BottomSheet open onClose={onClose} title={`${m.name} · Configuration`}><View style={{ gap: 16, paddingTop: 12 }}>
    <Text style={[s.name, { color: c.text }]}>Accelerator</Text>
    <SegmentedTabs items={m.accelerators.map(value => ({ value, label: value.toUpperCase() }))} value={config.accelerator} onChange={value => setConfig({ ...config, accelerator: value as 'cpu' | 'gpu' })} />
    <Text style={[s.caption, { color: c.secondary }]}>{m.accelerators.length === 1 ? 'This model supports CPU only.' : 'CPU uses the processor. GPU uses graphics acceleration; availability depends on your phone.'}</Text>
    {m.kind !== 'segmenter' ? <>
      <TextField label="System prompt" value={config.systemPrompt} onChangeText={systemPrompt => setConfig({ ...config, systemPrompt })} multiline />
      {([['contextTokens', `Context tokens · 512–${m.maxContext}`], ['maxTokens', 'Max output tokens'], ['topK', 'Top K · 1–128'], ['topP', 'Top P · 0–1'], ['temperature', 'Temperature · 0–2']] as const).map(([key, label]) => <TextField key={key} label={label} value={numbers[key]} keyboardType="decimal-pad" onChangeText={value => setNumbers({ ...numbers, [key]: value })} />)}
      {(['thinking', 'speculative'] as const).map(key => <View key={key} style={[s.row, { justifyContent: 'space-between' }]}><View style={{ flex: 1 }}><Text style={[s.name, { color: c.text }]}>{key === 'thinking' ? 'Thinking' : 'Speculative decoding'}</Text><Text style={[s.caption, { color: c.muted }]}>{m[key] ? key === 'thinking' ? 'Show the model’s reasoning.' : 'Use this model’s draft tokens to speed up decoding.' : 'Not supported by this model.'}</Text></View><Switch value={config[key]} disabled={!m[key]} onValueChange={value => setConfig({ ...config, [key]: value })} accessibilityLabel={key === 'thinking' ? 'Enable thinking' : 'Enable speculative decoding'} /></View>)}
    </> : <Text style={[s.body, { color: c.secondary }]}>Magic Touch selects objects in photos. Language sampling, prompts and thinking do not apply to this model.</Text>}
    {error ? <Text accessibilityRole="alert" style={[s.body, { color: c.danger }]}>{error}</Text> : null}
    <ActionButton title="Save configuration" onPress={save} /><ActionButton title="Reset to defaults" variant="ghost" onPress={reset} />
  </View></BottomSheet>;
}
const s = StyleSheet.create({ page: { padding: 20, paddingBottom: 48, gap: 20 }, title: { fontFamily: font.serif, fontSize: 34, lineHeight: 40 }, body: { fontFamily: font.sans, fontSize: fs.sm, lineHeight: 21 }, caption: { fontFamily: font.sans, fontSize: fs.xs, lineHeight: 18 }, card: { padding: 16, borderRadius: 18, borderWidth: 1, gap: 10 }, row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, name: { fontFamily: font.semibold, fontSize: fs.base }, track: { height: 4, borderRadius: 2, overflow: 'hidden' } });
