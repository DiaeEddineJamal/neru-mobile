// One catalog and capability map for desktop and mobile Pocket Lab, plus phone-only extras: open (ungated)
// LiteRT-LM models from litert-community that download without a Hugging Face account.
import { localModels as gallery, type LocalModel } from '@/shared/lib/pocket/catalog';

export { modelUrl, sizeLabel, type LocalConfig, type LocalModel } from '@/shared/lib/pocket/catalog';

// Gemma 3, Gemma 3n and FunctionGemma ask for their license on Hugging Face before they download.
const GATED = /^google\/|^litert-community\/(Gemma3-|functiongemma)/;

// Revisions, sizes and hashes copied from each repo's Hugging Face file metadata (2026-10-05).
const extras: [id: string, name: string, repo: string, file: string, revision: string, bytes: number, sha256: string, memory: number, description: string][] = [
  ['qwen2.5-coder-3b', 'Qwen2.5 Coder 3B', 'litert-community/Qwen2.5-Coder-3B-Instruct', 'Qwen2.5_Coder_3B_It.litertlm', 'f02778f1b0bb06315051c1e212abd19a389bff34', 3433083824, '78d23da074383f52f852b945b8090870e6c9dded02a842f535ee3ccb9e2874f3', 8, 'Alibaba’s coding model. Writes, explains and fixes code in most languages. Apache 2.0.'],
  ['qwen3-4b-2507', 'Qwen3 4B Instruct 2507', 'litert-community/Qwen3-4B-Instruct-2507', 'qwen3_4b_instruct_2507_mixed_int4.litertlm', '4d409771b414d86b270ca54d27ffc45032a81142', 2659057664, '9e48b165836256f5344d9d044930607b9c47f6ef34e27f82e96881664f3ba2fd', 8, 'A strong all-rounder for writing, reasoning, maths and code. Apache 2.0.'],
  ['phi-4-mini', 'Phi 4 mini', 'litert-community/Phi-4-mini-instruct', 'Phi-4-mini-instruct_multi-prefill-seq_q8_ekv4096.litertlm', '8cd368be75fdb94d5a6f6f5b40f1ab22a6c2543e', 3910090752, '7764d4deb53800578307be33039476b38a6c370fff71bedb3c0552563e23ab02', 8, 'Microsoft’s small model, good at reasoning, maths and code. MIT license.'],
  ['ministral-3-3b', 'Ministral 3 3B', 'litert-community/Ministral-3-3B-Instruct-2512', 'Ministral-3-3B-Instruct-2512_q4_block32_ekv4096.litertlm', '613e437fea973ca9e04a4063953ee514f1d4075e', 2340982768, '57daeeb4d7127fbea4aa4585cbc2aaa4df2ea828f142f081e73823e1e467803e', 6, 'Mistral’s phone-sized model. Fluent in many languages, quick to answer. Apache 2.0.'],
  ['smollm3-3b', 'SmolLM3 3B', 'litert-community/SmolLM3-3B', 'SmolLM3-3B_q4_block32_ekv4096.litertlm', 'c29e7655125fe754c483dfdf5e31a10acf0a51fb', 2002257840, '119fc1f266c445e9ffbc8c16695eb325b629da3fd464e73a75e5db14ef3926c3', 6, 'Hugging Face’s fully open model for chat, writing and reasoning. Apache 2.0.'],
  ['qwen3-1.7b', 'Qwen3 1.7B', 'litert-community/Qwen3-1.7B', 'Qwen3_1.7B.litertlm', '73fbc3fe8271c162a603ee66f6e7ed25b6211195', 2056729520, '66064a4e9269cb693e124c4e3040bcb8a446b10bca42663896329495add3861c', 6, 'Small and capable, with a knack for step-by-step answers. Apache 2.0.'],
  ['lfm2.5-1.2b', 'LFM2.5 1.2B', 'litert-community/LFM2.5-1.2B-Instruct', 'LFM2.5-1.2B-Instruct_int4.litertlm', 'ee97a004876dc4d4ad0b8a5bfefbc45940f4c18c', 736015744, '96041e6c72b1d2e9b73a122870606bbf18a3819bf14c43c3f2b74685ed62c24d', 4, 'Liquid AI’s fast, light model for everyday questions. LFM Open License.'],
  ['qwen3-0.6b', 'Qwen3 0.6B', 'litert-community/Qwen3-0.6B', 'Qwen3-0.6B.litertlm', 'a3c5d805ae362dff7f580bc25f2dfb9a5a7eaa76', 614236160, '555579ff2f4fd13379abe69c1c3ab5200f7338bc92471557f1d6614a6e5ab0b4', 4, 'The smallest download here. Fast replies on almost any phone. Apache 2.0.'],
];

const defaults = { systemPrompt: 'You are Neru, a helpful assistant. Answer clearly and concisely.', maxTokens: 2048, contextTokens: 4096, topK: 40, topP: 0.95, temperature: 0.7, accelerator: 'cpu' as const, thinking: false, speculative: false };

export const localModels: (LocalModel & { gated?: boolean })[] = [
  ...gallery.map(m => ({ ...m, gated: GATED.test(m.repo) })),
  ...extras.map(([id, name, repo, file, revision, bytes, sha256, memory, description]) => ({
    id, name, repo, file, revision, bytes, sha256, memory, description, kind: 'chat' as const, vision: false,
    accelerators: ['cpu', 'gpu'] as ('cpu' | 'gpu')[], thinking: false, speculative: false, maxContext: 4096, defaults,
  })),
];
export const localModel = (id: string) => localModels.find(m => m.id === id);
