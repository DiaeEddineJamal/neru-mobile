// Connector tools in chats. Cloud models get them as native tool definitions; on-device models get a short text
// protocol instead (<tool_call>{...}</tool_call>), since the phone runtime has no tool API. Tools that change
// something wait for the user's OK in the chat, unless they said "Always allow".
import { useSyncExternalStore } from 'react';

import { kvGetSync, kvSet } from '@/db';
import { beforeCall, parseLocalCalls } from '@/llm/parse';
import type { ToolSpec } from '@/llm/stream';
import { cloudToolSupport, rejectsTools } from '@/llm/vendor';
import { localModel } from '@/local/catalog';
import { allowAlways, preapproved, type ChatTool } from '@/mcp/store';

export { beforeCall, parseLocalCalls, rejectsTools };

export const toolSpecs = (tools: ChatTool[]): ToolSpec[] => tools.map(t => ({ name: t.fn, description: t.description, parameters: t.schema }));

// Cloud models that answered "no tools" once, so later chats skip offering them, by provider and model.
const NO_TOOLS = 'tools.unsupported';
const refused = new Set<string>(JSON.parse(kvGetSync(NO_TOOLS) ?? '[]') as string[]);

/** Whether a model can call connector tools: on-device ones by their catalog entry, cloud ones by family, unless
 * the model refused tools before. 'unknown' still gets tools offered. */
export function toolSupport(providerId: string, model: string): 'yes' | 'no' | 'unknown' {
  if (providerId === 'on-device') return localModel(model)?.tools ? 'yes' : 'no';
  if (refused.has(`${providerId}\n${model}`)) return 'no';
  return cloudToolSupport(providerId, model);
}

export function rememberNoTools(providerId: string, model: string) {
  refused.add(`${providerId}\n${model}`);
  void kvSet(NO_TOOLS, JSON.stringify([...refused]));
}

/** The tools in a few lines each, for the on-device system prompt: small models have small contexts. */
export function localToolPrompt(tools: ChatTool[]) {
  const lines = tools.slice(0, 30).map(t => {
    const props = (t.schema.properties ?? {}) as Record<string, { type?: string }>;
    const required = new Set((t.schema.required as string[] | undefined) ?? []);
    const args = Object.entries(props).slice(0, 8).map(([k, v]) => `${k}${required.has(k) ? '' : '?'}: ${v?.type ?? 'any'}`).join(', ');
    return `- ${t.fn}(${args}): ${t.description.replace(/\s+/g, ' ').slice(0, 160)}`;
  });
  return [
    'You can use these tools from the user\'s connected apps:',
    ...lines,
    'To use one, reply with only this, and nothing after it:',
    '<tool_call>{"name": "tool_name", "arguments": {"key": "value"}}</tool_call>',
    'The result comes back in <tool_result>. Then answer the user, or call another tool. Use tools only when the request needs them.',
  ].join('\n');
}

export function parseArgs(args: string): Record<string, unknown> {
  try {
    const v = JSON.parse(args || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
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
