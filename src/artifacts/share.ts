// Sharing an artifact in the format the reader needs: Word, PowerPoint or Excel files built on the phone
// (office.ts), a PDF printed by the system's web engine (expo-print), the page itself, or the source as written.
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { mermaidHtml, pageHtml } from '@/artifacts/ArtifactView';
import { figureKey, renderFigures, type Figure } from '@/artifacts/figures';
import { deckHtml, documentHtml, sheetHtml, type Figures } from '@/artifacts/html';
import { displayTitle, fileFor } from '@/artifacts/kinds';
import { docx, pptx, sheetsFrom, splitSlides, xlsx, type FigureLookup } from '@/artifacts/office';
import type { Artifact } from '@/artifacts/parse';
import type { IconName } from '@/components/Icon';
import { parse } from '@/components/markdown/parse';
import { t } from '@/i18n';

export type ShareFormat = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'html' | 'source';
export type ShareOption = { format: ShareFormat; label: string; description: string; icon: IconName };

/** The formats an artifact can be shared as, the one it was made for first. */
export function shareOptions(a: Artifact): ShareOption[] {
  const pdf: ShareOption = { format: 'pdf', label: t('PDF'), description: t('Ready to read, print or send'), icon: 'doc' };
  const word: ShareOption = { format: 'docx', label: t('Word document'), description: t('Opens in Word, Google Docs or Pages'), icon: 'word' };
  const html: ShareOption = { format: 'html', label: t('Web page (HTML)'), description: t('Opens in any browser'), icon: 'language' };
  switch (a.kind) {
    case 'markdown': {
      const md: ShareOption = { format: 'source', label: t('Markdown'), description: t('The text as written, with its formatting marks'), icon: 'fileCode' };
      return a.format === 'pdf' ? [pdf, word, html, md] : [word, pdf, html, md];
    }
    case 'slides':
      return [
        { format: 'pptx', label: t('PowerPoint'), description: t('Opens in PowerPoint, Google Slides or Keynote'), icon: 'slides' },
        { ...pdf, description: t('One page per slide') },
        { format: 'source', label: t('Markdown'), description: t('The slides as text'), icon: 'fileCode' },
      ];
    case 'sheet':
      return [
        { format: 'xlsx', label: t('Excel'), description: t('Opens in Excel, Google Sheets or Numbers'), icon: 'sheet' },
        { format: 'source', label: fileFor(a).name.endsWith('.csv') ? t('CSV') : t('Markdown'), description: t('The table as text'), icon: 'fileCode' },
      ];
    case 'html':
      return [{ ...html, description: t('The page itself, interactive') }, { ...pdf, description: t('A printed copy of the page') }];
    case 'svg':
      return [{ format: 'source', label: t('SVG image'), description: t('Sharp at any size'), icon: 'photo' }, pdf];
    case 'mermaid':
      return [{ ...html, description: t('Draws the diagram in a browser') }, { format: 'source', label: t('Mermaid source'), description: t('The diagram as text'), icon: 'fileCode' }];
    case 'code':
      return [{ format: 'source', label: t('Source file'), description: fileFor(a).name, icon: 'fileCode' }, pdf];
  }
}

const MIME: Record<Exclude<ShareFormat, 'source'>, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  html: 'text/html',
};
const UTI: Partial<Record<ShareFormat, string>> = { pdf: 'com.adobe.pdf', docx: 'org.openxmlformats.wordprocessingml.document', pptx: 'org.openxmlformats.presentationml.presentation', xlsx: 'org.openxmlformats.spreadsheetml.sheet', html: 'public.html' };

/** Writes the artifact as a file in that format and returns it (in the app's cache). */
export async function artifactFile(a: Artifact, format: ShareFormat): Promise<{ file: File; mime: string }> {
  const source = fileFor(a);
  if (format === 'source') return { file: write(source.name, a.content), mime: source.mime };
  const base = source.name.replace(/\.[^.]+$/, '');
  const name = `${base}.${format}`;
  const title = displayTitle(a);
  // Charts and diagrams in the text: SVG for pages and PDFs, PNG as well for Word and PowerPoint.
  const office = format === 'docx' || format === 'pptx';
  const figures = a.kind === 'markdown' || a.kind === 'slides' ? await renderFigures(a.content, office) : new Map<string, Figure>();
  const lookup: FigureLookup = (lang, text) => {
    const f = figures.get(figureKey(lang, text));
    return f?.png ? { png: f.png, width: f.width, height: f.height, alt: f.alt } : undefined;
  };
  switch (format) {
    case 'pdf': {
      const deck = a.kind === 'slides';
      // Slides print one per landscape page; everything else on A4.
      const { uri } = await Print.printToFileAsync(
        deck ? { html: deckHtml(a, figures), width: 960, height: 540, margins: { top: 0, bottom: 0, left: 0, right: 0 } } : { html: printableHtml(a, figures), width: 595, height: 842, margins: { top: 48, bottom: 48, left: 0, right: 0 } },
      );
      const file = fresh(name);
      await new File(uri).move(file);
      return { file, mime: MIME.pdf };
    }
    case 'docx':
      return { file: write(name, docx(parse(a.content), title, lookup)), mime: MIME.docx };
    case 'pptx':
      return { file: write(name, pptx(splitSlides(a.content, parse), title, lookup)), mime: MIME.pptx };
    case 'xlsx':
      return { file: write(name, xlsx(sheetsFrom(a.content, parse), title)), mime: MIME.xlsx };
    case 'html': {
      const html = a.kind === 'html' ? pageHtml(a.content) : a.kind === 'mermaid' ? mermaidHtml(a.content, false) : a.kind === 'slides' ? deckHtml(a, figures) : a.kind === 'sheet' ? sheetHtml(a) : documentHtml(a, figures);
      return { file: write(name, html), mime: MIME.html };
    }
  }
}

export async function shareArtifact(a: Artifact, format: ShareFormat) {
  if (!(await Sharing.isAvailableAsync())) throw new Error(t('Sharing is not available on this device.'));
  const { file, mime } = await artifactFile(a, format);
  await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: displayTitle(a), UTI: UTI[format] });
}

function fresh(name: string): File {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  return file;
}

function write(name: string, content: string | Uint8Array): File {
  const file = fresh(name);
  file.create();
  file.write(content);
  return file;
}

/** What the PDF printer gets: the page for web pages and images, a typeset document for the rest. */
function printableHtml(a: Artifact, figures: Figures): string {
  if (a.kind === 'html') return pageHtml(a.content);
  if (a.kind === 'svg') return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;display:flex;justify-content:center}svg{max-width:100%;height:auto}</style></head><body>${a.content}</body></html>`;
  if (a.kind === 'sheet') return sheetHtml(a);
  return documentHtml(a, figures);
}
