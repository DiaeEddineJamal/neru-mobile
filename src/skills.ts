// Skills: reusable instructions picked from the + sheet or typed as "/slug" at the start of a message. A small
// built-in set ships with the app; the user's own live in kv. Picking one inserts "/slug " into the composer, and
// on send ChatView expands it (expandMessage) into the user's words plus a hidden block of instructions that the
// model reads and the user's bubble leaves out (visibleText).
import { useSyncExternalStore } from 'react';

import { kvGetSync, kvSet } from '@/db';
import { t } from '@/i18n';

export type Skill = {
  /** Lowercase letters, digits and dashes: what follows the "/". */
  slug: string;
  title: string;
  /** One or two sentences: when to use it. */
  description: string;
  /** What the model is told to do. */
  instructions: string;
  source: 'built-in' | 'mine';
};

/** The built-in set, with titles and descriptions in the current language. Instructions stay in English: the model
 * reads them, and it answers in the user's language anyway. */
export const builtInSkills = (): Skill[] => ([
  {
    slug: 'summarize',
    title: t('Summarize'),
    description: t('Turns a long text, article or thread into a short summary with the key points and any decisions or next steps.'),
    instructions: 'Summarize the text the user gives (or the conversation so far if they give none). Start with a one-sentence overview, then 3 to 7 bullet points with the key facts, and end with any decisions, deadlines or next steps. Keep names, numbers and dates exact. Do not add opinions.',
  },
  {
    slug: 'translate',
    title: t('Translate'),
    description: t('Translates text naturally, keeping tone and formatting. Name the target language, or it goes to English (or from English to your language).'),
    instructions: 'Translate the user\'s text. If they name a target language, use it; otherwise translate into English, or from English into the language the user writes to you in. Keep the meaning, tone, formatting, names and numbers. Output only the translation, then, if something was ambiguous or idiomatic, one short note after it.',
  },
  {
    slug: 'rewrite',
    title: t('Rewrite'),
    description: t('Rewrites your text in a clearer or different tone: formal, friendly, shorter, more confident. Say which tone you want.'),
    instructions: 'Rewrite the user\'s text. If they name a tone or goal (formal, friendly, shorter, persuasive, simpler…), follow it; otherwise make it clearer and more concise while keeping their voice. Keep every fact. Output the rewritten text first, then at most two short notes about notable changes.',
  },
  {
    slug: 'explain-code',
    title: t('Explain code'),
    description: t('Explains what a piece of code does, step by step, and points out bugs, edge cases and possible improvements.'),
    instructions: 'Explain the code the user shares. Start with what it does in one or two sentences, then walk through it step by step in plain language, referring to names in the code. Then list likely bugs, edge cases and security or performance issues, and suggest concrete improvements with short code snippets. Match the depth to how experienced the user seems.',
  },
  {
    slug: 'brainstorm',
    title: t('Brainstorm'),
    description: t('Generates a wide range of ideas on a topic, from safe to bold, then picks the most promising ones.'),
    instructions: 'Brainstorm on the user\'s topic. Give 10 to 15 varied ideas, grouped from practical to bold, each in one line. Then pick the 3 most promising, saying in a sentence each why, and suggest a first step for the best one. Ask one clarifying question at the end only if the topic is too vague.',
  },
  {
    slug: 'plan-a-trip',
    title: t('Plan a trip'),
    description: t('Builds a day-by-day itinerary from a destination, dates and budget, with places, transport and tips.'),
    instructions: 'Plan a trip from what the user gives (destination, dates or length, budget, interests, who is travelling). If key facts are missing, make sensible assumptions and state them first. Give a day-by-day itinerary (morning, afternoon, evening) with realistic travel times, a rough budget, how to get around, booking tips and a short packing list. Note anything that should be checked because it may have changed.',
  },
  {
    slug: 'draft-email',
    title: t('Draft an email'),
    description: t('Writes a ready-to-send email from a few notes: subject line, clear body, the right tone for the recipient.'),
    instructions: 'Draft an email from the user\'s notes. Give a subject line, then the email with a greeting, a clear and brief body that leads with the main point or request, and a sign-off. Match the tone to the recipient and situation (formal by default for work). Use placeholders like [Name] for anything unknown. Offer one shorter alternative only if the email is long.',
  },
  {
    slug: 'study-notes',
    title: t('Study notes'),
    description: t('Turns a topic or course material into structured study notes with key terms, examples and quiz questions.'),
    instructions: 'Make study notes from the user\'s topic or material. Use headings, short bullet points, bolded key terms with one-line definitions, a worked example where it helps, and a short "common mistakes" list. End with 5 quiz questions, with the answers listed separately after them.',
  },
] as Omit<Skill, 'source'>[]).map(sk => ({ ...sk, source: 'built-in' as const }));

// ---- the user's own skills ----

const KEY = 'skills.mine.v1';
type Mine = Omit<Skill, 'source'>;

function load(): Skill[] {
  try {
    const rows = JSON.parse(kvGetSync(KEY) ?? '[]') as Mine[];
    return rows.filter(r => r && typeof r.slug === 'string').map(r => ({ ...r, source: 'mine' as const }));
  } catch {
    return [];
  }
}

let mine: Skill[] | null = null;
const listeners = new Set<() => void>();
const getMine = () => (mine ??= load());
function setMine(next: Skill[]) {
  mine = next;
  void kvSet(KEY, JSON.stringify(next.map(({ source: _source, ...rest }) => rest)));
  listeners.forEach(l => l());
}
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/** The user's own skills, live. */
export const useMySkills = () => useSyncExternalStore(subscribe, getMine);

/** Every skill: the user's own first (they override a built-in with the same slug), then the built-ins, by slug. */
export function allSkills(): Skill[] {
  const own = getMine();
  const taken = new Set(own.map(s => s.slug));
  return [...own, ...builtInSkills().filter(s => !taken.has(s.slug))].sort((a, b) => a.slug.localeCompare(b.slug));
}

export function useSkills(): Skill[] {
  const own = useMySkills();
  const taken = new Set(own.map(s => s.slug));
  return [...own, ...builtInSkills().filter(s => !taken.has(s.slug))].sort((a, b) => a.slug.localeCompare(b.slug));
}

export const findSkill = (slug: string) => allSkills().find(s => s.slug === slug.toLowerCase());

/** "Plan my week!" → "plan-my-week". */
export const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** Adds or replaces one of the user's skills. `previous` is its old slug when renamed. */
export function saveSkill(skill: Mine, previous?: string) {
  const rest = getMine().filter(s => s.slug !== skill.slug && s.slug !== previous);
  setMine([...rest, { ...skill, source: 'mine' }]);
}

export function deleteSkill(slug: string) {
  setMine(getMine().filter(s => s.slug !== slug));
}

// ---- in messages ----

// A block the model reads and the user's bubble hides.
const BLOCK = /\s*<neru-context\b[^>]*>[\s\S]*?<\/neru-context>/g;
const block = (kind: string, body: string) => `\n\n<neru-context kind="${kind}">\n${body}\n</neru-context>`;

/** A message without its hidden instruction blocks: what the bubble, Copy and Edit show. */
export const visibleText = (text: string) => (text.includes('<neru-context') ? text.replace(BLOCK, '').trimEnd() : text);

/** The skill a message starts with ("/translate to French: …"), if it names one. */
export function leadingSkill(text: string): Skill | undefined {
  const m = /^\/([a-z0-9][a-z0-9-]*)(?=\s|$)/i.exec(text.trimStart());
  return m ? findSkill(m[1]) : undefined;
}

const RESEARCH = 'Research mode is on for this message. Before answering, use the available connector tools thoroughly: search every relevant connected source, open and read the most relevant results, and cross-check facts between them. Cite which source each key fact came from. If no tools are available or nothing relevant is found, say so and answer from what you know, marking what is uncertain.';

/** What is sent for what the user typed: a leading "/slug" gains the skill's instructions, and research mode adds
 * its own instructions. The visible part stays exactly as typed. */
export function expandMessage(text: string, opts: { research?: boolean } = {}): string {
  const base = visibleText(text);
  let out = base;
  const skill = leadingSkill(base);
  if (skill) {
    out += block('skill', `The user invoked the skill "/${skill.slug}" (${skill.title}). Apply these instructions to the rest of their message:\n${skill.instructions}`);
  }
  if (opts.research) out += block('research', RESEARCH);
  return out;
}
