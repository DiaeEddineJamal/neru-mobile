// Per-kind presentation: icon, label, file extension and MIME type for sharing.
import type { ArtifactKind, Artifact } from '@/artifacts/parse';
import type { IconName } from '@/components/Icon';
import { currentLang, t } from '@/i18n';

export const KIND_ICON: Record<ArtifactKind, IconName> = { html: 'desktop', svg: 'photo', markdown: 'doc', code: 'fileCode', mermaid: 'chart', slides: 'slides', sheet: 'sheet' };

/** The icon for one artifact: a Word document shows Word's, a PDF the document one. */
export const iconFor = (a: Artifact): IconName => (a.format === 'docx' ? 'word' : KIND_ICON[a.kind]);

export function kindLabel(kind: ArtifactKind): string {
  switch (kind) {
    case 'html': return t('Web page');
    case 'svg': return t('Image');
    case 'markdown': return t('Document');
    case 'code': return t('Code');
    case 'mermaid': return t('Diagram');
    case 'slides': return t('Presentation');
    case 'sheet': return t('Spreadsheet');
  }
}

/** What one artifact is, as a file type when it is meant to be one: "Word document", "PDF", "Presentation"… */
export function typeLabel(a: Artifact): string {
  if (a.format === 'docx') return t('Word document');
  if (a.format === 'pdf') return t('PDF');
  return kindLabel(a.kind);
}

export function kindsLabel(kind: ArtifactKind): string {
  switch (kind) {
    case 'html': return t('Web pages');
    case 'svg': return t('Images');
    case 'markdown': return t('Documents');
    case 'code': return t('Code');
    case 'mermaid': return t('Diagrams');
    case 'slides': return t('Presentations');
    case 'sheet': return t('Spreadsheets');
  }
}

/** The title to show, falling back to the kind when the model gave none. */
export const displayTitle = (a: Artifact) => a.title.trim() || kindLabel(a.kind);

const EXT: Record<string, string> = {
  javascript: 'js', js: 'js', jsx: 'jsx', typescript: 'ts', ts: 'ts', tsx: 'tsx', python: 'py', py: 'py', ruby: 'rb', rust: 'rs', go: 'go',
  java: 'java', kotlin: 'kt', swift: 'swift', c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', 'c#': 'cs', cs: 'cs', php: 'php', sql: 'sql',
  bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', powershell: 'ps1', json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', css: 'css',
  scss: 'scss', html: 'html', xml: 'xml', dart: 'dart', lua: 'lua', r: 'r', scala: 'scala', vue: 'vue', svelte: 'svelte',
};

export function fileFor(a: Artifact): { name: string; mime: string } {
  const base = (a.title || a.id || 'artifact').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'artifact';
  switch (a.kind) {
    case 'html': return { name: `${base}.html`, mime: 'text/html' };
    case 'svg': return { name: `${base}.svg`, mime: 'image/svg+xml' };
    case 'markdown':
    case 'slides': return { name: `${base}.md`, mime: 'text/markdown' };
    case 'sheet': return /^\s*\|/m.test(a.content) ? { name: `${base}.md`, mime: 'text/markdown' } : { name: `${base}.csv`, mime: 'text/csv' };
    case 'mermaid': return { name: `${base}.mmd`, mime: 'text/plain' };
    case 'code': return { name: `${base}.${EXT[a.language ?? ''] ?? 'txt'}`, mime: 'text/plain' };
  }
}

/** "Edited Sep 23" (with the year when it is not this year), in the app language. */
export function editedLabel(ts: number): string {
  const d = new Date(ts);
  const opts: Intl.DateTimeFormatOptions = d.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
  let date: string;
  try {
    date = new Intl.DateTimeFormat(currentLang(), opts).format(d);
  } catch {
    date = d.toDateString();
  }
  return t('Edited {date}', { date });
}
