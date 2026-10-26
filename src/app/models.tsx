import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';

import { Icon, IconButton } from '@/components/Icon';
import { ModelMark } from '@/components/ModelMark';
import { ModelSearch } from '@/components/ModelSearch';
import { t as tx } from '@/i18n';
import { vendorOf } from '@/llm/vendor';
import { localModels, sizeLabel, type LocalModel } from '@/local/catalog';
import { configForLocal, saveLocalConfig } from '@/local/config';
import { account, openHub, openLicense, saveToken, signIn, signInAvailable, signOut } from '@/local/huggingface';
import { cancelDownload, deviceMemoryGB, downloadModel, fitsMemory, GatedError, pauseDownload, refreshDownloads, removeModel, useDownloads } from '@/local/models';
import { localAvailable, unloadLocal } from '@/local/runtime';
import { chooseModel, getState, updateSettings, useStore } from '@/store';
import { appVersion } from '@/components/WhatsNew';
import { askForNotifications } from '@/notify';
import { font, fs, useBottomPad, useColors } from '@/theme';
import { ActionButton } from '@/ui/button-base';
import { BottomSheet } from '@/ui/bottom-sheet';
import { CapabilityTag, type Capability } from '@/ui/capability-tag';
import { confirm } from '@/ui/confirm';
import { TextField } from '@/ui/input';
import { SegmentedTabs } from '@/ui/tabs';
import { Switch } from '@/ui/switch';
import { useToast } from '@/ui/toast';

export default function Models() {
  const c = useColors();
  const toast = useToast();
  const bottomPad = useBottomPad();
  const downloads = useDownloads();
  const selected = useStore(s => s.settings);
  const streaming = useStore(s => s.streamingChat !== null);
  const [hfUser, setHfUser] = useState<string | null>(null);
  const [configModel, setConfigModel] = useState<LocalModel | null>(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [token, setToken] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const page = useRef<KeyboardAwareScrollViewRef>(null);
  const run = (p: Promise<unknown>) => p.catch(e => toast.show({ title: tx('On-device models'), description: String(e?.message ?? e) }));
  useEffect(() => { void refreshDownloads().catch(() => {}); void account().then(setHfUser); }, []);
  // Gated models, as in Edge Gallery: sign in with Hugging Face when asked, accept the license when asked,
  // and pick the download back up after each step without another tap.
  const get = async (m: LocalModel) => {
    // Asked right as it pays off: the download's progress lives in the notification shade while you're away.
    await askForNotifications().catch(() => false);
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
          toast.show({ title: tx('Accept the license'), description: tx('Agree to the {name} terms on the page that opens, then come back.', { name: m.name }) });
          await openLicense(m.repo);
        }
      }
    }
  };
  // Straight into a new chat with the model, from wherever Pocket Lab was opened (Settings or the model sheet).
  const choose = (id: string) => { chooseModel('on-device', id); if (!getState().settings.onboarded) updateSettings({ onboarded: true, seenVersion: appVersion, tour: 'pending' }); toast.show({ title: tx('On-device model selected'), description: tx('Your messages stay on this phone.') }); router.dismissAll(); router.navigate('/'); };
  const addToken = async () => {
    setSavingToken(true);
    setTokenError('');
    try { setHfUser(await saveToken(token)); setToken(''); toast.show({ title: tx('Hugging Face token saved'), description: tx('Gated models download with your account now.') }); }
    catch (e) { setTokenError(e instanceof Error ? e.message : String(e)); }
    finally { setSavingToken(false); }
  };
  const cancel = async (m: LocalModel) => {
    const ok = await confirm({ title: tx('Stop downloading {name}?', { name: m.name }), message: tx('The part downloaded so far is deleted. You can start again any time.'), action: tx('Stop and delete'), destructive: true });
    if (ok) await run(cancelDownload(m.id).then(() => toast.show({ title: tx('Download canceled'), description: m.name })));
  };
  const remove = async (m: LocalModel) => {
    const ok = await confirm({ title: tx('Remove {name}?', { name: m.name }), message: tx('This frees {size} on your phone. Your conversations stay, and you can download the model again any time.', { size: sizeLabel(m.bytes) }), action: tx('Remove download'), destructive: true });
    if (!ok) return;
    await run((async () => { await unloadLocal(); await removeModel(m.id); if (selected.providerId === 'on-device' && selected.model === m.id) chooseModel('on-device', ''); toast.show({ title: tx('{name} removed', { name: m.name }) }); })());
  };
  const q = query.trim().toLowerCase();
  const visible = localModels.filter(m => (filter === 'all' || (filter === 'vision' ? m.vision || m.kind === 'segmenter' : filter === 'tools' ? m.kind === 'tools' || m.tools : m.kind === filter)) && (!q || `${m.name} ${m.description}`.toLowerCase().includes(q)));
  const installed = visible.filter(m => downloads[m.id]?.phase === 'ready');
  const browse = visible.filter(m => downloads[m.id]?.phase !== 'ready');
  const downloading = Object.values(downloads).some(d => d.phase === 'downloading' || d.phase === 'verifying');
  return (
    <><KeyboardAwareScrollView ref={page} bottomOffset={96} style={{ backgroundColor: c.bg }} contentContainerStyle={[s.page, { paddingBottom: bottomPad + 24 }]} keyboardShouldPersistTaps="handled">
      <View style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={[s.title, { color: c.text }]}>{tx('Browse models')}</Text>
        <Text style={[s.body, { color: c.secondary }]}>{tx('Download once. Chat offline. Your messages stay on this phone.')}</Text>
        {deviceMemoryGB ? <Text style={[s.caption, { color: c.muted }]}>{tx('{gb} GB device memory', { gb: deviceMemoryGB.toFixed(1) })}</Text> : null}
        {!localAvailable ? <Text style={[s.body, { color: c.danger }]}>{tx('Available in the Neru Android build with LiteRT-LM. On-device inference is unavailable in Expo Go, the web app and iOS.')}</Text> : null}
      </View>
      <ModelSearch value={query} onChangeText={setQuery} />
      <SegmentedTabs items={[{ value: 'all', label: tx('All') }, { value: 'chat', label: tx('Chat') }, { value: 'tools', label: tx('Tools') }, { value: 'vision', label: tx('Vision') }]} value={filter} onChange={setFilter} />
      {!visible.length ?<View style={[s.card, { backgroundColor: c.surface2 }]}><Icon name="search" color={c.muted} /><Text style={[s.body, { color: c.secondary }]}>{tx('No match.')}</Text><ActionButton title={tx('Clear search')} variant="secondary" onPress={() => { setQuery(''); setFilter('all'); }} /></View> : null}
      {[{ title: tx('Installed models'), models: installed }, { title: tx('Browse models'), models: browse }].filter(section => section.models.length > 0).map(section => <View key={section.title} style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={[s.section, { color: c.secondary }]}>{section.title} · {section.models.length}</Text>
      {byMaker(section.models).map(([maker, models]) => <View key={maker} style={{ gap: 12 }}>
      <View accessibilityRole="header" style={s.maker}>
        <ModelMark model={maker === 'Google' ? 'google/' : models[0].repo} size={26} />
        <Text style={[s.makerName, { color: c.text }]}>{maker}</Text>
        <Text style={[s.caption, { color: c.muted }]}>{models.length}</Text>
      </View>
      {models.map(m => {
        const d = downloads[m.id];
        const phase = d?.phase ?? 'available';
        const busy = phase === 'downloading' || phase === 'verifying';
        const ready = phase === 'ready';
        const current = selected.providerId === 'on-device' && selected.model === m.id;
        const compatible = fitsMemory(m);
        const progress = Math.max(0, Math.min(100, Math.round((d?.progress ?? 0) * 100)));
        const tags: Capability[] = [m.kind === 'segmenter' ? 'photo' : m.kind === 'tools' ? 'functions' : 'chat', ...(m.vision ? ['vision' as const] : []), ...(m.thinking ? ['thinking' as const] : []), ...(m.tools ? ['tools' as const] : [])];
        return (
          <View key={m.id} style={[s.card, { backgroundColor: c.surface2, borderColor: current ? c.text : 'transparent' }]}>
            <View style={s.cardHeader}>
              <ModelMark model={m.repo} vision={m.vision || m.kind === 'segmenter'} />
              <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
                <Text style={[s.name, { color: c.text }]}>{m.name}</Text>
                <Text style={[s.caption, { color: c.muted }]}>{sizeLabel(m.bytes)}{ready ? ` · ${current ? tx('Selected') : tx('Downloaded')}` : ''}</Text>
              </View>
              <IconButton name="sliders" size={21} label={`${tx('Model configuration')}: ${m.name}`} color={c.secondary} disabled={streaming} onPress={() => setConfigModel(m)} />
            </View>
            <Text style={[s.body, { color: c.secondary }]}>{tx(m.description)}</Text>
            <View style={s.row}>{tags.map(tag => <CapabilityTag key={tag} kind={tag} />)}</View>
            {m.memory ? <Text style={[s.caption, { color: c.muted }]}>{tx('{gb} GB RAM recommended', { gb: m.memory })}</Text> : null}
            {m.gated && !ready ? <Text style={[s.caption, { color: c.muted }]}>{hfUser ? tx('License on Hugging Face · accept it once when asked') : tx('Needs a Hugging Face account · add your token below')}</Text> : null}
            {!compatible ? <Text style={[s.caption, { color: c.danger }]}>{tx('This model needs more memory than this phone has.')}</Text> : null}
            {busy || phase === 'paused' ? <View style={{ gap: 12 }}>
              <View style={[s.row, { justifyContent: 'space-between' }]}><Text style={[s.caption, { color: c.secondary }]}>{phase === 'verifying' ? tx('Checking the download…') : phase === 'paused' ? tx('Paused') : tx('Downloading')}</Text><Text style={[s.caption, { color: c.text }]}>{progress}%</Text></View>
              <View style={[s.track, { backgroundColor: c.surface3 }]} accessibilityRole="progressbar" accessibilityLabel={m.name} accessibilityValue={{ min: 0, max: 100, now: progress }}><View style={{ width: `${progress}%`, height: '100%', backgroundColor: c.sage }} /></View>
              {d?.note && phase === 'downloading' ? <Text style={[s.caption, { color: c.muted }]}>{d.note}</Text> : null}
              {phase !== 'verifying' ? <View style={{ flexDirection: 'row', gap: 10 }}>
                <ActionButton title={tx('Cancel')} variant="secondary" style={{ flex: 1 }} onPress={() => void cancel(m)} />
                <ActionButton title={phase === 'paused' ? tx('Resume download') : tx('Pause download')} variant="secondary" style={{ flex: 1 }} disabled={phase === 'paused' && (downloading || !localAvailable)} onPress={() => run(phase === 'paused' ? get(m) : pauseDownload(m.id))} />
              </View> : null}
            </View> : null}
            {d?.error ? <Text accessibilityRole="alert" style={[s.caption, { color: c.danger }]}>{d.error}</Text> : null}
            {ready ? <View style={{ gap: 6 }}><ActionButton title={m.kind === 'segmenter' ? tx('Try Magic Touch') : current ? tx('Start chatting') : tx('Use this model')} icon={current ? 'check' : undefined} disabled={streaming || !localAvailable} onPress={() => m.kind === 'segmenter' ? router.push('/magic-touch') : choose(m.id)} /><ActionButton title={tx('Remove download')} icon="trash" variant="ghost" disabled={streaming} onPress={() => void remove(m)} /></View>
              : !busy && phase !== 'paused' ? <ActionButton title={`${tx('Download')} · ${sizeLabel(m.bytes)}`} icon="download" disabled={!localAvailable || !compatible || downloading} variant="secondary" onPress={() => run(get(m))} /> : null}
          </View>
        );
      })}</View>)}</View>)}
      {/* Gemma 3, Gemma 3n and FunctionGemma need a Hugging Face account that accepted their license. */}
      <View style={[s.card, { backgroundColor: c.surface2, borderColor: c.border }]}>
        <Text style={[s.name, { color: c.text }]}>Hugging Face</Text>
        {hfUser ? <>
          <Text style={[s.body, { color: c.secondary }]}>{tx('Signed in as {user}. Models with a license, like Gemma 3 and Gemma 3n, download with this account.', { user: hfUser })}</Text>
          <ActionButton title={tx('Sign out')} variant="ghost" onPress={() => run(signOut().then(() => { setHfUser(null); toast.show({ title: tx('Signed out of Hugging Face') }); }))} />
        </> : <>
          <Text style={[s.body, { color: c.secondary }]}>{tx('Gemma 3, Gemma 3n and FunctionGemma ask you to accept Google’s license first. Create an access token with Read access on Hugging Face and paste it here. It stays in this phone’s secure storage.')}</Text>
          {signInAvailable ? <ActionButton title={tx('Sign in with Hugging Face')} onPress={() => run(signIn().then(account).then(setHfUser))} /> : null}
          <TextField label={tx('Access token')} value={token} onChangeText={t => (setToken(t), setTokenError(''))} placeholder="hf_…" autoCapitalize="none" autoCorrect={false} secureTextEntry error={tokenError} />
          <ActionButton title={tx('Save token')} loading={savingToken} disabled={!token.trim()} onPress={() => void addToken()} />
          <ActionButton title={tx('Create a token on Hugging Face')} variant="ghost" onPress={() => run(openHub('settings/tokens/new?tokenType=read'))} />
        </>}
      </View>
    </KeyboardAwareScrollView>{configModel ? <ModelConfig key={configModel.id} model={configModel} onClose={() => setConfigModel(null)} /> : null}</>
  );
}

/** Models by who makes them, in catalog order; Gemma and Magic Touch both under Google. */
function byMaker<M extends LocalModel>(models: M[]) {
  const groups = new Map<string, M[]>();
  for (const m of models) {
    const name = vendorOf(m.repo)?.name ?? tx('Other');
    const maker = name.startsWith('Google') ? 'Google' : name;
    groups.set(maker, [...(groups.get(maker) ?? []), m]);
  }
  return [...groups];
}

function ModelConfig({ model: m, onClose }: { model: LocalModel; onClose: () => void }) {
  const c = useColors();
  const toast = useToast();
  const [config, setConfig] = useState(() => configForLocal(m.id));
  const [numbers, setNumbers] = useState(() => Object.fromEntries(['contextTokens', 'maxTokens', 'topK', 'topP', 'temperature'].map(k => [k, String(config[k as keyof typeof config])])));
  const [error, setError] = useState('');
  const reset = () => { setConfig(m.defaults); setNumbers(Object.fromEntries(['contextTokens', 'maxTokens', 'topK', 'topP', 'temperature'].map(k => [k, String(m.defaults[k as keyof typeof config])]))); setError(''); };
  const save = async () => {
    try { await saveLocalConfig(m.id, { ...config, ...Object.fromEntries(Object.entries(numbers).map(([k, v]) => [k, Number(v)])) }); toast.show({ title: tx('Configuration saved'), description: m.name }); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <BottomSheet open onClose={onClose} title={`${m.name} · ${tx('Configuration')}`}><View style={{ gap: 16, paddingTop: 12 }}>
    <ActionButton title={tx('Model details and terms')} variant="secondary" icon="link" onPress={() => void (m.url ? Linking.openURL('https://developers.google.com/edge/mediapipe/solutions/vision/interactive_segmenter') : openLicense(m.repo)).catch(e => toast.show({ title: tx('Model details and terms'), description: String(e) }))} />
    <Text style={[s.name, { color: c.text }]}>{tx('Accelerator')}</Text>
    <SegmentedTabs items={m.accelerators.map(value => ({ value, label: value.toUpperCase() }))} value={config.accelerator} onChange={value => setConfig({ ...config, accelerator: value as 'cpu' | 'gpu' })} />
    <Text style={[s.caption, { color: c.secondary }]}>{m.accelerators.length === 1 ? tx('This model supports CPU only.') : tx('CPU uses the processor. GPU uses graphics acceleration; availability depends on your phone.')}</Text>
    {m.kind !== 'segmenter' ? <>
      <TextField label={tx('System prompt')} value={config.systemPrompt} onChangeText={systemPrompt => setConfig({ ...config, systemPrompt })} multiline />
      {([['contextTokens', `${tx('Context tokens')} · 512–${m.maxContext}`], ['maxTokens', tx('Max output tokens')], ['topK', 'Top K · 1–128'], ['topP', 'Top P · 0–1'], ['temperature', `${tx('Temperature')} · 0–2`]] as const).map(([key, label]) => <TextField key={key} label={label} value={numbers[key]} keyboardType="decimal-pad" onChangeText={value => setNumbers({ ...numbers, [key]: value })} />)}
      {(['thinking', 'speculative'] as const).map(key => <View key={key} style={[s.row, { justifyContent: 'space-between' }]}><View style={{ flex: 1 }}><Text style={[s.name, { color: c.text }]}>{key === 'thinking' ? tx('Thinking') : tx('Speculative decoding')}</Text><Text style={[s.caption, { color: c.muted }]}>{m[key] ? key === 'thinking' ? tx('Show the model’s reasoning.') : tx('Use this model’s draft tokens to speed up decoding.') : tx('Not supported by this model.')}</Text></View><Switch value={config[key]} disabled={!m[key]} onValueChange={value => setConfig({ ...config, [key]: value })} accessibilityLabel={key === 'thinking' ? tx('Enable thinking') : tx('Enable speculative decoding')} /></View>)}
    </> : <Text style={[s.body, { color: c.secondary }]}>{tx('Magic Touch selects objects in photos. Language sampling, prompts and thinking do not apply to this model.')}</Text>}
    {error ? <Text accessibilityRole="alert" style={[s.body, { color: c.danger }]}>{error}</Text> : null}
    <ActionButton title={tx('Save configuration')} onPress={save} /><ActionButton title={tx('Reset to defaults')} variant="ghost" onPress={reset} />
  </View></BottomSheet>;
}
const s = StyleSheet.create({
  page: { padding: 20, gap: 20 },
  title: { fontFamily: font.semibold, fontSize: 30, lineHeight: 38 },
  section: { fontFamily: font.semibold, fontSize: fs.sm, paddingHorizontal: 4, paddingTop: 4 },
  body: { fontFamily: font.sans, fontSize: fs.sm, lineHeight: 22 },
  caption: { fontFamily: font.sans, fontSize: fs.xs, lineHeight: 18 },
  card: { padding: 18, borderRadius: 26, borderWidth: 1.5, gap: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  maker: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4, paddingTop: 4 },
  makerName: { fontFamily: font.semibold, fontSize: fs.sm, flexShrink: 1 },
  name: { fontFamily: font.semibold, fontSize: fs.base },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
});
