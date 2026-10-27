import { requireNativeModule } from 'expo';
import * as FS from 'expo-file-system/legacy';
import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { localModel } from '@/local/catalog';
import { useLocalSearchParams } from 'expo-router';
import { installUpdate } from '@/update';

export default function PocketCheck() {
  const { performance, documents, updater } = useLocalSearchParams<{ performance?: string; documents?: string; updater?: string }>();
  const [output, setOutput] = useState('Starting physical device check…');
  useEffect(() => {
    if (!__DEV__) return;
    const native = requireNativeModule('NeruLocalAi');
    const records: Record<string, unknown>[] = [];
    const report = async (record: Record<string, unknown>) => { records.push(record); setOutput(JSON.stringify(records, null, 2)); await FS.writeAsStringAsync(`${FS.documentDirectory}pocket-check.json`, JSON.stringify(records)); };
    void (async () => {
      if (updater === '1') {
        const release = await fetch('https://api.github.com/repos/DiaeEddineJamal/neru-mobile/releases/tags/v0.14.0').then(r => r.json());
        const apk = release.assets.find((asset: { name: string }) => asset.name.endsWith('.apk'));
        await installUpdate({ version: '0.14.0-check', title: 'Installer check', notes: '', url: apk.browser_download_url, size: apk.size, sha256: apk.digest?.replace('sha256:', '') }, progress => setOutput(`Downloading APK inside Neru: ${Math.round(progress * 100)}%`));
        await report({ downloadedInsideApp: true, verified: true, installerOpened: true });
        return;
      }
      if (documents === '1') {
        await report({ google: native.googleAuthInfo() });
        const fixtures = JSON.parse(await FS.readAsStringAsync(`${FS.documentDirectory}document-fixtures/manifest.json`)) as { name: string; contains?: string[]; error?: boolean }[];
        for (const fixture of fixtures) {
          try {
            const result = await native.readDocument(`${FS.documentDirectory}document-fixtures/${fixture.name}`, fixture.name, 'application/octet-stream');
            await report({ file: fixture.name, pass: !fixture.error && fixture.contains?.every(text => result.text.includes(text)), ...result });
          } catch (error) { await report({ file: fixture.name, pass: !!fixture.error, error: String(error) }); }
        }
        await report({ complete: true });
        return;
      }
      if (performance === '1') {
        const m = localModel('qwen3-0.6b')!;
        const uri = `${FS.documentDirectory}models/${m.file}`;
        const config = { ...m.defaults, maxTokens: 64, contextTokens: 2048, temperature: 0.1, vision: false, reuseConversation: false, systemPrompt: 'Answer in one short sentence. /no_think' };
        await native.unload();
        let started = Date.now();
        await native.load(uri, config);
        await report({ preloadMs: Date.now() - started });
        started = Date.now();
        await native.load(uri, config);
        await report({ alreadyLoadedMs: Date.now() - started });
        const messages: { role: string; text: string; images: string[] }[] = [];
        for (const [country, capital] of [['France', 'Paris'], ['Italy', 'Rome'], ['Spain', 'Madrid']]) {
          messages.push({ role: 'user', text: `What is the capital of ${country}? Answer in one sentence.\n\n/no_think`, images: [] });
          const id = `perf-${country}`;
          let answer = '';
          let firstTokenMs: number | undefined;
          started = Date.now();
          const listener = native.addListener('token', (event: { requestId: string; text?: string }) => {
            if (event.requestId !== id || !event.text) return;
            firstTokenMs ??= Date.now() - started;
            answer += event.text;
          });
          try { await native.generate(id, uri, messages, config); }
          finally { listener.remove(); }
          await report({ country, firstTokenMs, totalMs: Date.now() - started, answer, correct: answer.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').includes(capital) });
          messages.push({ role: 'assistant', text: answer.replace(/<think>[\s\S]*?(<\/think>|$)/g, ''), images: [] });
        }
        await native.generate('perf-context', uri, [{ role: 'user', text: `${'Some background information. '.repeat(400)}\nReply briefly. /no_think`, images: [] }], {
          ...config, contextTokens: 512, maxTokens: 16, systemPrompt: 'Be helpful and concise. '.repeat(500),
        });
        await report({ boundedContext: 'PASS' });
        await report({ complete: true });
        return;
      }
      const m = localModel('gemma-4-e2b')!;
      const uri = `${FS.documentDirectory}models/${m.file}`;
      if (!await native.verifyFile(uri, m.sha256)) throw Error('Phone model checksum failed');
      await report({ checksum: 'PASS' });
      for (const accelerator of ['cpu', 'gpu'] as const) {
        let text = '';
        const listener = native.addListener('token', (event: { text: string }) => { text += event.text ?? ''; });
        try {
          await native.generate(`check-${accelerator}`, uri, [{ role: 'user', text: 'What is 2 + 2? Answer briefly.' }], { ...m.defaults, maxTokens: 64, temperature: .2, accelerator, thinking: accelerator === 'gpu', speculative: accelerator === 'gpu' });
          if (!/4|four/i.test(text)) throw Error(`Unexpected ${accelerator} answer: ${text}`);
          await report({ accelerator, inference: 'PASS', text });
        } finally { listener.remove(); await native.unload(); }
      }
      for (const accelerator of ['cpu', 'gpu']) {
        const result = await native.segment(`${FS.documentDirectory}models/interactive_segmentation.task`, `${FS.documentDirectory}pocket-photo.png`, .5, .53, accelerator);
        await report({ vision: accelerator, result });
      }
      await report({ complete: true });
    })().catch(error => report({ error: String(error) }));
  }, [performance, documents, updater]);
  return <ScrollView style={{ backgroundColor: '#fff' }} contentContainerStyle={{ padding: 24 }}><Text style={{ color: '#171717' }}>{output}</Text></ScrollView>;
}
