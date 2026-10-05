import { requireNativeModule } from 'expo';
import * as FS from 'expo-file-system/legacy';
import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { localModel } from '@/local/catalog';

export default function PocketCheck() {
  const [output, setOutput] = useState('Starting physical device check…');
  useEffect(() => {
    if (!__DEV__) return;
    const native = requireNativeModule('NeruLocalAi');
    const records: Record<string, unknown>[] = [];
    const report = async (record: Record<string, unknown>) => { records.push(record); setOutput(JSON.stringify(records, null, 2)); await FS.writeAsStringAsync(`${FS.documentDirectory}pocket-check.json`, JSON.stringify(records)); };
    void (async () => {
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
  }, []);
  return <ScrollView contentContainerStyle={{ padding: 24 }}><Text style={{ color: '#fff' }}>{output}</Text></ScrollView>;
}
