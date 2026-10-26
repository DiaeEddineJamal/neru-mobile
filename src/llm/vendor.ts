// Who makes a model, and whether it can call tools (MCP connectors), from its id alone. No imports, so Node checks can
// load it (vendor.check.ts).

export type Vendor = { logo: string; name: string };

// Order matters: "DeepSeek-R1-Distill-Qwen" is DeepSeek's, "gpt-oss" is OpenAI's before any host name matches.
const MAKERS: [RegExp, string, string][] = [
  [/deepseek/, 'deepseek', 'DeepSeek'],
  [/gemma/, 'gemma', 'Google Gemma'],
  [/gemini/, 'gemini', 'Google Gemini'],
  [/magic[ _-]?touch|mediapipe|^google\//, 'google', 'Google'],
  [/qwen|qwq/, 'qwen', 'Qwen'],
  [/\bphi[-_ ]?\d|microsoft\//, 'microsoft', 'Microsoft'],
  [/mistral|ministral|codestral|devstral|magistral|pixtral|mixtral|voxtral/, 'mistral', 'Mistral AI'],
  [/smollm|huggingface|huggingfacetb/, 'huggingface', 'Hugging Face'],
  [/\blfm|liquid/, 'liquid', 'Liquid AI'],
  [/claude|anthropic/, 'claude', 'Anthropic'],
  [/gpt|\bo[134](-|$)|openai\/|codex|chatgpt/, 'openai', 'OpenAI'],
  [/llama|meta\/|meta-/, 'meta', 'Meta'],
  [/kimi|moonshot/, 'kimi', 'Moonshot AI'],
  [/glm|zhipu|z-ai|zai-org/, 'zai', 'Z.ai'],
  [/minimax/, 'minimax', 'MiniMax'],
  [/grok|x-ai\//, 'grok', 'xAI'],
  [/nemotron|nvidia\//, 'nvidia', 'NVIDIA'],
  [/command|cohere|\baya/, 'cohere', 'Cohere'],
  [/granite|ibm/, 'ibm', 'IBM'],
  [/stepfun|\bstep-/, 'stepfun', 'StepFun'],
  [/ernie|baidu/, 'baidu', 'Baidu'],
  [/doubao|bytedance|seed-oss/, 'bytedance', 'ByteDance'],
  [/hunyuan|tencent/, 'hunyuan', 'Tencent Hunyuan'],
  [/internlm|intern-s/, 'internlm', 'InternLM'],
  [/\byi-|01-ai/, 'yi', '01.AI'],
];

// The provider's own mark, for a model whose maker is not recognized.
const HOSTS: Record<string, Vendor> = {
  nvidia: { logo: 'nvidia', name: 'NVIDIA' }, openrouter: { logo: 'openrouter', name: 'OpenRouter' }, groq: { logo: 'groq', name: 'Groq' },
  cerebras: { logo: 'cerebras', name: 'Cerebras' }, gemini: { logo: 'gemini', name: 'Google Gemini' }, mistral: { logo: 'mistral', name: 'Mistral AI' },
  huggingface: { logo: 'huggingface', name: 'Hugging Face' }, ollama: { logo: 'ollama', name: 'Ollama' }, openai: { logo: 'openai', name: 'OpenAI' },
  anthropic: { logo: 'claude', name: 'Anthropic' }, deepseek: { logo: 'deepseek', name: 'DeepSeek' }, qwen: { logo: 'qwen', name: 'Qwen' },
  modelscope: { logo: 'qwen', name: 'ModelScope' }, kimi: { logo: 'kimi', name: 'Moonshot AI' }, zai: { logo: 'zai', name: 'Z.ai' },
  minimax: { logo: 'minimax', name: 'MiniMax' }, xai: { logo: 'grok', name: 'xAI' },
};

/** The model's maker from its id or repo, else the provider serving it, else null. */
export function vendorOf(model: string, providerId?: string): Vendor | null {
  const id = model.toLowerCase();
  for (const [re, logo, name] of MAKERS) if (re.test(id)) return { logo, name };
  return (providerId && HOSTS[providerId]) || null;
}

/**
 * Whether a cloud model takes tool definitions: 'yes' for families trained for function calling, 'no' for ones
 * known to reject them, 'unknown' otherwise (Neru still offers tools and learns from the answer).
 */
export function cloudToolSupport(providerId: string, model: string): 'yes' | 'no' | 'unknown' {
  const id = model.toLowerCase();
  // OpenRouter's list is already filtered to models that support tools (stream.ts listModels).
  if (providerId === 'openrouter') return 'yes';
  if (/r1-distill|deepseek-r1(?!-0528)|gemma-?[123](?!\d)|gemma-3n|llama-?2|llama-3\.2-[13]b|phi-[123]\b|tinyllama|qwq-32b-preview|vision-instruct/.test(id)) return 'no';
  if (/gpt-(4|5)|gpt-oss|\bo[134](-|$)|claude|gemini-(1\.5|2|3)|qwen-?(2\.5|3)|qwen-(max|plus|turbo|flash|coder)|llama-?(3\.[13]|4)|mistral|codestral|devstral|ministral|magistral|deepseek-(v3|chat|v4)|kimi|glm-?(4\.[5-9]|[5-9])|minimax|grok|command-[ra]|nemotron|hermes|granite-?[34]|step-|hunyuan|gemma-?4/.test(id)) return 'yes';
  return 'unknown';
}

/** A request failed because the model or its host does not accept tool definitions. */
export function rejectsTools(error: string) {
  const e = error.toLowerCase();
  if (e.includes('no endpoints found that support tool use')) return true;
  if (!/http 4\d\d/.test(e)) return false;
  if (/enable-auto-tool-choice|tool-call-parser/.test(e)) return true; // vLLM hosts started without tool parsing
  return /\b(tools?|tool_choice|tool use|tool calling|function[ _]call(ing)?|functions)\b/.test(e) && /not support|unsupported|does not support|doesn't support|not available|not enabled|not allowed|invalid|unknown|unrecognized|extra (inputs|fields)|unexpected/.test(e);
}
