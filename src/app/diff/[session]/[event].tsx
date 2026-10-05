import { Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';

import { useRemote } from '@/remote/store';
import { font, useColors } from '@/theme';
import { FileDiffView } from '@/ui/file-diff';

/** A pending edit's diff (`event` = "pending"), or a file the agent wrote, shown as all-new lines. */
export default function DiffScreen() {
  const c = useColors();
  const { session, event } = useLocalSearchParams<{ session: string; event: string }>();
  const view = useRemote(s => s.views[session]);
  const fileId = decodeURIComponent(event);
  const file = view?.entries.flatMap(e => e.files ?? []).find(f => f.id === fileId);
  const diff =
    event === 'pending' && view?.pending?.diff
      ? { file: view.pending.label, patch: view.pending.diff }
      : file
        ? { file: file.path, patch: file.content.split('\n').map(l => `+${l}`).join('\n') }
        : null;

  if (!diff) return <Text style={{ color: c.muted, padding: 24, fontFamily: font.sans }}>These changes are no longer available.</Text>;
  return (
    <>
      <Stack.Screen options={{ title: diff.file.split(/[\\/]/).pop() }} />
      <FileDiffView file={diff.file} patch={diff.patch} />
    </>
  );
}
