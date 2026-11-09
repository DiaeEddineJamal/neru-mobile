// Pure parts of memory: snippet search over past chats, prompt assembly, synthesis prompts and pacing.
// No React Native or '@/' imports, so `node src/memory.check.ts` can run them.

/** What memory reads of a chat. */
export type ChatDoc = { id: string; title: string; updatedAt: number; messages: { role: 'user' | 'assistant'; text: string; createdAt: number }[] };

const STOP = new Set(
  ('the and for are but not you your with this that have from was were what when where which who why how can could would should ' +
    'will just about into than then them they their there these those its it’s our out all any some one two also very more most ' +
    'like make made need want get got use using used does did done been being here please thanks thank yes ok okay hey hello ' +
    'les des une est pour pas que qui dans sur avec plus par mais comme tout cette ces son ses aux elle ils nous vous mon mes ton ' +
    'del los las por con para una como pero más este esta que').split(' '),
);

/** Lowercase words of 3+ letters without accents or stop words. */
export function tokenize(text: string): string[] {
  return (text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(w => !STOP.has(w));
}

/** Characters of each chat that search reads; older text beyond this is ignored. */
const DOC_CHARS = 4000;
const docText = (d: ChatDoc) => `${d.title}\n${d.messages.map(m => m.text).join('\n')}`.slice(0, DOC_CHARS);

/** TF-IDF score of each chat for `query`, best first; chats sharing no word are left out. */
export function scoreChats(query: string, docs: ChatDoc[]): { doc: ChatDoc; score: number }[] {
  const q = [...new Set(tokenize(query))];
  if (!q.length || !docs.length) return [];
  const tfs = docs.map(d => {
    const tf = new Map<string, number>();
    for (const w of tokenize(docText(d))) tf.set(w, (tf.get(w) ?? 0) + 1);
    // The title counts again: it names what the chat was about.
    for (const w of tokenize(d.title)) tf.set(w, (tf.get(w) ?? 0) + 2);
    return tf;
  });
  const n = docs.length;
  const idf = new Map(q.map(w => [w, Math.log(1 + n / (1 + tfs.filter(tf => tf.has(w)).length))]));
  return docs
    .map((doc, i) => {
      let score = 0;
      for (const w of q) {
        const f = tfs[i].get(w);
        if (f) score += (1 + Math.log(f)) * idf.get(w)!;
      }
      return { doc, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || b.doc.updatedAt - a.doc.updatedAt);
}

/** About `size` characters of `text` around its first word from `words`. */
export function excerpt(text: string, words: string[], size = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= size) return flat;
  const lower = flat.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const hit = words.map(w => lower.indexOf(w)).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, Math.min(hit - Math.floor(size / 3), flat.length - size));
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + size).trim()}${start + size < flat.length ? '…' : ''}`;
}

/**
 * Lines from past chats that match `query`, within `budget` characters: one line per chat, from the message that
 * shares the most words with the query. `clean` hides secrets.
 */
export function pastChatSnippets(query: string, docs: ChatDoc[], budget: number, date: (ms: number) => string, clean: (s: string) => string = s => s, maxChats = 3): string[] {
  const words = [...new Set(tokenize(query))];
  const out: string[] = [];
  let used = 0;
  for (const { doc } of scoreChats(query, docs).slice(0, maxChats)) {
    const best = doc.messages
      .map(m => ({ m, hits: new Set(tokenize(m.text).filter(w => words.includes(w))).size }))
      .sort((a, b) => b.hits - a.hits || (a.m.role === 'user' ? -1 : 1))[0];
    const size = Math.min(260, Math.max(80, Math.floor(budget / Math.min(maxChats, 3)) - doc.title.length - 30));
    const body = best ? clean(excerpt(best.m.text, words, size)) : '';
    const line = `- "${doc.title}" (${date(doc.updatedAt)})${body ? `: ${best!.m.role === 'user' ? 'the user wrote' : 'you replied'} “${body}”` : ''}`;
    if (used + line.length > budget) break;
    out.push(line);
    used += line.length + 1;
  }
  return out;
}

/** Cuts `text` to at most `max` characters at a line or word boundary. */
export function trimTo(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
  return `${cut.slice(0, at > max * 0.6 ? at : max).trimEnd()}…`;
}

/** Budgets, in characters, of what memory adds to a system prompt. */
export const BUDGET = {
  memory: { cloud: 2400, local: 600 },
  project: { cloud: 1500, local: 300 },
  search: { cloud: 1500, local: 400 },
};

/** The memory part of a system prompt; '' when there is nothing to add. */
export function assembleMemoryPrompt(o: { memory?: string; projectName?: string; projectMemory?: string; snippets?: string[]; local: boolean }): string {
  const size = o.local ? 'local' : 'cloud';
  const parts: string[] = [];
  const memory = o.memory?.trim();
  if (memory)
    parts.push(`What you remember about the user, from past conversations (use it when it helps; do not recite it or mention that you have a memory unless asked):\n${trimTo(memory, BUDGET.memory[size])}`);
  const project = o.projectMemory?.trim();
  if (project) parts.push(`What you remember about the project${o.projectName ? ` "${o.projectName}"` : ''} from its earlier conversations:\n${trimTo(project, BUDGET.project[size])}`);
  if (o.snippets?.length)
    parts.push(`Possibly relevant excerpts from the user's past conversations. Reference them only if they help with the current message, and say so when you do:\n${o.snippets.join('\n')}`);
  return parts.join('\n\n');
}

// ---- synthesis ----

/** Characters of conversation one synthesis reads. A phone model gets far less. */
export const SYNTH_INPUT = { cloud: 14000, local: 3500 };
/** Longest memory kept. */
export const MEMORY_MAX = 2400;

/**
 * Recent conversation text for synthesis: newest chats first, the user's words in full (they say who the user is)
 * and replies shortened, within `budget` characters. Only messages after `since`.
 */
export function transcript(docs: ChatDoc[], since: number, budget: number, date: (ms: number) => string, clean: (s: string) => string = s => s): string {
  const blocks: string[] = [];
  let used = 0;
  for (const d of [...docs].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const lines = d.messages
      .filter(m => m.createdAt > since && m.text.trim())
      .map(m => (m.role === 'user' ? `User: ${trimTo(clean(m.text), 700)}` : `Assistant: ${trimTo(clean(m.text), 220)}`));
    if (!lines.length) continue;
    let block = `## ${d.title} (${date(d.updatedAt)})\n${lines.join('\n')}`;
    if (used + block.length > budget) {
      const room = budget - used;
      if (room < 300) break;
      block = trimTo(block, room);
    }
    blocks.push(block);
    used += block.length + 2;
  }
  return blocks.join('\n\n');
}

const RULES = `Rules:
- Write short, factual bullet points in the third person ("Works as…", "Prefers…"), grouped under these Markdown headings when they have content: ## Work, ## Preferences, ## Projects, ## Personal context.
- Keep what the existing memory says unless the new conversations contradict or update it; then keep the newer fact.
- Remember only lasting facts that will help in future conversations: role, skills, tools, ongoing projects, goals, how they like answers. Skip one-off questions, small talk and anything the assistant said that the user did not confirm.
- Never store passwords, API keys, tokens, card or account numbers, addresses, phone numbers or other secrets, nor health, religious or political details unless the user plainly asked to remember them.
- At most 25 bullets and ${MEMORY_MAX} characters in total. Merge duplicates. Write in the language the user mostly writes in.
- Reply with the complete updated memory only: no introduction, no code fence. If there is nothing worth remembering, reply with the existing memory unchanged, or with nothing if it is empty.`;

/** System and user messages that ask a model to merge new conversations into the memory. */
export function synthesisPrompt(existing: string, conversations: string, project?: { name: string; description?: string }): { system: string; user: string } {
  const subject = project ? `the project "${project.name}"${project.description ? ` (${project.description.trim().slice(0, 300)})` : ''} and how the user works on it` : 'the user';
  return {
    system: `You keep a private memory about ${subject}, built from their past conversations with an assistant, so future conversations can be more helpful.\n\n${RULES}`,
    user: `Existing memory:\n${existing.trim() || '(empty)'}\n\nNew conversations:\n${conversations}\n\nUpdated memory:`,
  };
}

/** A model's reply cleaned into memory text: no thinking, fences or preamble, and capped. */
export function cleanMemory(reply: string, clean: (s: string) => string = s => s): string {
  let t = reply.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
  t = t.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  t = t.replace(/^(updated memory|memory)\s*:\s*/i, '').trim();
  if (/^\(?empty\)?$/i.test(t)) return '';
  return trimTo(clean(t), MEMORY_MAX);
}

/** Pacing of automatic synthesis. */
export const PACE = {
  /** Never more often than this. */
  minGapMs: 30 * 60_000,
  /** Exchanges that justify a run after minGap. */
  batch: 6,
  /** After this long, a single new exchange is enough. */
  maxGapMs: 6 * 3600_000,
};

/** Whether automatic synthesis should run now, after `pending` new exchanges since the run at `lastRun`. */
export function shouldSynthesize(now: number, lastRun: number, pending: number): boolean {
  if (pending <= 0) return false;
  const gap = now - lastRun;
  if (gap < PACE.minGapMs) return false;
  return pending >= PACE.batch || gap >= PACE.maxGapMs;
}
