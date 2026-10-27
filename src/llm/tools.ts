// Connector tools in chats. Cloud models that take tool definitions get them natively; on-device models, and cloud
// models whose API refuses tool definitions, get a text protocol instead (<tool_call>{...}</tool_call>), so every
// chat model can use every connector. Tools that change
// something wait for the user's OK in the chat, unless they said "Always allow".
import { useSyncExternalStore } from 'react';

import { kvGetSync, kvSet } from '@/db';
import { beforeCall, coerceArgs, localArgumentShape, parseLocalCalls } from '@/llm/parse';
import type { ToolSpec } from '@/llm/stream';
import { cloudToolSupport, rejectsTools } from '@/llm/vendor';
import { localModel } from '@/local/catalog';
import { allowAlways, preapproved, type ChatTool } from '@/mcp/store';

export { beforeCall, coerceArgs, parseLocalCalls, rejectsTools };
export { parseArgs } from '@/llm/parse';
export { unsupportedTools } from '@/llm/vendor';

export const toolSpecs = (tools: ChatTool[]): ToolSpec[] => tools.map(t => ({ name: t.fn, description: t.description, parameters: t.schema }));

// Cloud models that answered "no tools" once, so later chats skip offering them, by provider and model.
// Older builds also cached schema/argument failures as "no tools". Retry those models with the repaired schemas.
const NO_TOOLS = 'tools.unsupported.v2';
const refused = new Set<string>(JSON.parse(kvGetSync(NO_TOOLS) ?? '[]') as string[]);

/** Whether a model can call connector tools: on-device ones by their catalog entry, cloud ones by family, unless
 * the model refused tools before. 'unknown' still gets tools offered. */
export function toolSupport(providerId: string, model: string): 'yes' | 'no' | 'unknown' {
  if (providerId === 'on-device') return localModel(model)?.tools ? 'yes' : 'no';
  if (refused.has(`${providerId}\n${model}`)) return 'no';
  return cloudToolSupport(providerId, model);
}

/** How a model gets connector tools: as native definitions, as the text protocol, or not at all (only the on-device
 * fine-tunes that know nothing but their own fixed functions). */
export function toolMode(providerId: string, model: string): 'native' | 'text' | 'none' {
  if (providerId === 'on-device') return localModel(model)?.tools ? 'text' : 'none';
  return toolSupport(providerId, model) === 'no' ? 'text' : 'native';
}

export function rememberNoTools(providerId: string, model: string) {
  refused.add(`${providerId}\n${model}`);
  void kvSet(NO_TOOLS, JSON.stringify([...refused]));
}

/** About 800 tokens of tool list: a phone model's context is small, and every token of it is read before replying.
 * Cloud models on the text protocol have room for every tool. */
const LOCAL_TOOLS_CHARS = 2100;
export const CLOUD_TOOLS_CHARS = 24000;

/** A named app gets the small context budget instead of unrelated connectors crowding it out. */
export function localToolsForTask(tools: ChatTool[], task: string): ChatTool[] {
  const request = task.toLowerCase();
  const named = tools.filter(tool => tool.label.toLowerCase().split(/[^a-z0-9]+/).some(word => word.length >= 4 && word !== 'google' && new RegExp(`\\b${word}\\b`).test(request)));
  return named.length ? named : tools;
}

/** The tools in a line each, for the on-device system prompt. The list stays the same from turn to turn, so the
 * phone's kept conversation (which has already read it) can carry on. */
export function localToolPrompt(tools: ChatTool[], budget = LOCAL_TOOLS_CHARS) {
  const describe = budget > LOCAL_TOOLS_CHARS ? 400 : 100;
  const lines: string[] = [];
  let used = 0;
  const rank = (name: string) => /search/.test(name) ? 0 : /fetch|get_page|retrieve_page/.test(name) ? 1 : /create[-_]pages?|post[-_]page|update[-_]page|append.*block/.test(name) ? 2 : 3;
  for (const t of [...tools].sort((a, b) => rank(a.fn) - rank(b.fn))) {
    const line = `- ${t.fn}(${localArgumentShape(t.schema)}): ${t.description.replace(/\s+/g, ' ').slice(0, describe)}`;
    if (used + line.length > budget) continue;
    lines.push(line);
    used += line.length;
  }
  return [
    'You can use these tools from the user\'s connected apps:',
    ...lines,
    'To use one, reply with only this, and nothing after it:',
    '<tool_call>{"name": "tool_name", "arguments": {"key": "value"}}</tool_call>',
    'Use the exact nested argument shapes above. Find and fetch a named destination first; use returned IDs and exact database property names.',
    'The result comes back in <tool_result>. Then answer the user, or call another tool. Use tools only when the request needs them.',
  ].join('\n');
}

// ---- approvals ----

export type ToolAsk = { chatId: string; tool: ChatTool; args: Record<string, unknown> };
let asking: (ToolAsk & { resolve: (answer: 'once' | 'always' | 'deny') => void }) | null = null;
const listeners = new Set<() => void>();
const show = (next: typeof asking) => ((asking = next), listeners.forEach(l => l()));
export const useToolAsk = () => useSyncExternalStore(l => (listeners.add(l), () => void listeners.delete(l)), () => asking);

/** Resolves true when the tool may run: read-only, allowed before, or the user taps Allow. */
export function mayRun(chatId: string, tool: ChatTool, args: Record<string, unknown>, signal: AbortSignal): Promise<boolean> {
  if (preapproved(tool)) return Promise.resolve(true);
  return new Promise(resolve => {
    const done = (answer: 'once' | 'always' | 'deny') => {
      show(null);
      if (answer === 'always') allowAlways(tool.source);
      resolve(answer !== 'deny');
    };
    signal.addEventListener('abort', () => asking?.chatId === chatId && done('deny'));
    show({ chatId, tool, args, resolve: done });
  });
}

export const answerToolAsk = (answer: 'once' | 'always' | 'deny') => asking?.resolve(answer);
