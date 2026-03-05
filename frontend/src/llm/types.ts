// On-device LLM types for llama.rn integration

/** Model descriptor */
export interface ModelInfo {
  id: string;
  name: string;
  url: string;
  sizeBytes: number;
  filename: string;
  contextSize: number;
  description: string;
}

/** Model lifecycle status */
export type ModelStatus =
  | 'not_downloaded'
  | 'downloading'
  | 'downloaded'
  | 'loading'
  | 'ready'
  | 'error';

/** Download progress */
export interface DownloadProgress {
  totalBytes: number;
  downloadedBytes: number;
  percent: number;
}

/** Model role — fast for quick chat, heavy for reasoning + tool calling */
export type ModelRole = 'fast' | 'heavy';

/** Fast model — Qwen2.5-0.5B-Instruct Q4_K_M (~400MB, instant responses) */
export const FAST_MODEL: ModelInfo = {
  id: 'qwen2.5-0.5b-instruct-q4km',
  name: 'Qwen 2.5 0.5B Instruct',
  url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
  sizeBytes: 397_000_000,
  filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
  contextSize: 2048,
  description: 'Fast chat model (~400MB)',
};

/** Heavy model — Qwen2.5-3B-Instruct Q4_K_M (~1.8GB, tool calling + reasoning) */
export const HEAVY_MODEL: ModelInfo = {
  id: 'qwen2.5-3b-instruct-q4km',
  name: 'Qwen 2.5 3B Instruct',
  url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
  sizeBytes: 1_940_000_000,
  filename: 'qwen2.5-3b-instruct-q4_k_m.gguf',
  contextSize: 4096,
  description: 'On-device AI for offline use (~1.8GB)',
};

/** Default alias — kept for backward compat */
export const MODEL = HEAVY_MODEL;
