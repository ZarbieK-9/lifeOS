// Singleton LLM service — dual context: fast (0.5B chat) + heavy (3B reasoning/tools)
// Fast context stays loaded (tiny RAM footprint). Heavy context has idle timeout.

import type { LlamaContext } from 'llama.rn';
import { buildToolDefinitions, buildFilteredToolDefinitions, buildSystemPrompt, buildFastSystemPrompt } from './prompt';
import { toolRegistry, executeToolWithGoalContext } from '../agent/tools';
import type { MatchedIntent, ToolResult } from '../agent/types';
import { withTimeout } from '../utils/timeout';

/**
 * Cached require of llama.rn — avoids Metro re-bundling on every call.
 * Returns null if the native module isn't linked (Expo Go / no prebuild).
 */
let _cachedInitLlama: { fn: ((params: any) => Promise<LlamaContext>) | null } | undefined;
function getInitLlama(): ((params: any) => Promise<LlamaContext>) | null {
  if (_cachedInitLlama !== undefined) return _cachedInitLlama.fn;
  try {
    _cachedInitLlama = { fn: require('llama.rn').initLlama };
  } catch {
    _cachedInitLlama = { fn: null };
  }
  return _cachedInitLlama.fn;
}

async function safeInitLlama(params: any): Promise<LlamaContext> {
  const initLlama = getInitLlama();
  if (!initLlama) {
    throw new Error(
      'llama.rn native module not available. Run `npx expo prebuild --clean` and build a dev client.',
    );
  }
  return initLlama(params);
}

const HEAVY_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TURNS = 5;

export interface CompletionResult {
  message: string;
  intents: MatchedIntent[];
  results: ToolResult[];
}

export interface StreamCallbacks {
  /** Called for each generated token. */
  onToken?: (token: string) => void;
  /** Called at the start of each LLM turn (use to reset streaming buffer). */
  onTurnStart?: (turn: number) => void;
}

type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

class LlamaServiceImpl {
  // ── Fast context (0.5B — stays loaded, tiny footprint) ──
  private fastCtx: LlamaContext | null = null;
  private fastPath: string | null = null;
  private fastLoading = false;

  // ── Heavy context (3B — idle-unloaded) ──
  private heavyCtx: LlamaContext | null = null;
  private heavyPath: string | null = null;
  private heavyLoading = false;
  private heavyIdleTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Fast model ──

  async loadFast(modelPath: string, contextSize = 2048): Promise<void> {
    if (this.fastCtx && this.fastPath === modelPath) return;
    if (this.fastLoading) throw new Error('Fast model is currently loading');
    if (this.fastCtx) await this.releaseFast();

    this.fastLoading = true;
    try {
      this.fastCtx = await safeInitLlama({
        model: modelPath,
        n_ctx: contextSize,
        n_gpu_layers: 99,
        use_mlock: true,
        jinja: true,
      } as any);
      this.fastPath = modelPath;
    } finally {
      this.fastLoading = false;
    }
  }

  async releaseFast(): Promise<void> {
    if (this.fastCtx) {
      await this.fastCtx.release();
      this.fastCtx = null;
      this.fastPath = null;
    }
  }

  get isFastLoaded(): boolean {
    return this.fastCtx !== null;
  }

  // ── Heavy model ──

  /** Load heavy model. No-op if same model already loaded. */
  async loadHeavy(modelPath: string, contextSize = 4096): Promise<void> {
    if (this.heavyCtx && this.heavyPath === modelPath) {
      this.resetHeavyIdle();
      return;
    }
    if (this.heavyLoading) throw new Error('Heavy model is currently loading');
    if (this.heavyCtx) await this.releaseHeavy();

    this.heavyLoading = true;
    try {
      this.heavyCtx = await safeInitLlama({
        model: modelPath,
        n_ctx: contextSize,
        n_gpu_layers: 99,
        use_mlock: true,
        jinja: true,
      } as any);
      this.heavyPath = modelPath;
      this.resetHeavyIdle();
    } finally {
      this.heavyLoading = false;
    }
  }

  async releaseHeavy(): Promise<void> {
    this.clearHeavyIdle();
    if (this.heavyCtx) {
      await this.heavyCtx.release();
      this.heavyCtx = null;
      this.heavyPath = null;
    }
  }

  get isHeavyLoaded(): boolean {
    return this.heavyCtx !== null;
  }

  // ── Backward compat — old load/release map to heavy ──

  async load(modelPath: string, contextSize = 4096): Promise<void> {
    return this.loadHeavy(modelPath, contextSize);
  }

  async release(): Promise<void> {
    await this.releaseFast();
    await this.releaseHeavy();
  }

  get isLoaded(): boolean {
    return this.isHeavyLoaded;
  }

  get isLoading(): boolean {
    return this.heavyLoading;
  }

  // ── Fast completion — simple chat, no tools ──

  /**
   * Quick single-turn completion using the fast (0.5B) model.
   * No tool calling — just text in, text out.
   */
  async completeFast(
    userInput: string,
    contextJson: string,
    callbacks?: StreamCallbacks,
  ): Promise<CompletionResult> {
    if (!this.fastCtx) throw new Error('Fast model not loaded');

    callbacks?.onTurnStart?.(0);

    const systemPrompt = buildFastSystemPrompt(sanitizeForLlama(contextJson, 1500));
    const safeInput = sanitizeForLlama(userInput);

    try {
      const result = await withTimeout(
        this.fastCtx.completion(
          {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: safeInput },
            ] as any,
            n_predict: 512,
            temperature: 0.4,
            stop: ['<|endoftext|>', '<|im_end|>'],
          },
          (data: any) => {
            if (data?.token && callbacks?.onToken) callbacks.onToken(data.token);
          },
        ),
        30_000,
        'Fast LLM',
      );

      const text = (result?.text ?? '').trim();
      return {
        message: text || `Understood: "${safeInput.slice(0, 80)}"`,
        intents: [],
        results: [],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('HostFunction') || msg.includes('Exception') || msg.toLowerCase().includes('context is full')) {
        console.warn('[LlamaService] Native completion failed (fast):', msg);
        // Retry with no context if context overflow
        if (msg.toLowerCase().includes('context is full')) {
          try {
            const minimalPrompt = buildFastSystemPrompt('{}');
            const retryResult = await this.fastCtx!.completion(
              {
                messages: [
                  { role: 'system', content: minimalPrompt },
                  { role: 'user', content: safeInput },
                ] as any,
                n_predict: 256,
                temperature: 0.4,
                stop: ['<|endoftext|>', '<|im_end|>'],
              },
              (data: any) => {
                if (data?.token && callbacks?.onToken) callbacks.onToken(data.token);
              },
            );
            return { message: (retryResult?.text ?? '').trim(), intents: [], results: [] };
          } catch {
            // Fall through to friendly error
          }
        }
        return {
          message: `I had a hiccup on that one. Try rephrasing or say something shorter — or I can try again in a moment.`,
          intents: [],
          results: [],
        };
      }
      throw e;
    }
  }

  // ── Heavy completion — multi-turn agentic with tools ──

  /**
   * Multi-turn agentic completion using the heavy (3B) model:
   * 1. Send user input + tools to LLM
   * 2. If LLM calls tools → execute → feed results back → repeat (max 3 turns)
   * 3. Return final text + all intents/results
   * @param options.includeTools - When false, no tools are sent (avoids parse errors for query-only prompts like meal plan).
   */
  async complete(
    userInput: string,
    contextJson: string,
    callbacks?: StreamCallbacks,
    options?: { includeTools?: boolean },
  ): Promise<CompletionResult> {
    if (!this.heavyCtx) throw new Error('Heavy model not loaded');
    this.resetHeavyIdle();

  const safeContext = sanitizeForLlama(contextJson, 3000);
  const safeInput = sanitizeForLlama(userInput);
  let systemPrompt = buildSystemPrompt(safeContext, safeInput);
  const includeTools = options?.includeTools !== false;
  const tools = includeTools ? buildFilteredToolDefinitions(safeInput) : [];

  // Token budget check — estimate if total exceeds model's context (4096 tokens)
  // Reserve ~600 tokens for generation. 1 token ≈ 4 chars.
  const MAX_INPUT_TOKENS = 3500;
  const totalChars = systemPrompt.length + safeInput.length + (tools.length > 0 ? JSON.stringify(tools).length : 0);
  const estimatedTokens = Math.ceil(totalChars / 4);
  if (estimatedTokens > MAX_INPUT_TOKENS) {
    console.warn(`[LlamaService] Token budget exceeded: ~${estimatedTokens} tokens. Reducing context.`);
    // Re-build with tighter context budget
    const reducedContext = sanitizeForLlama(contextJson, 1500);
    systemPrompt = buildSystemPrompt(reducedContext, safeInput);
  }

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: safeInput },
  ];

  const allIntents: MatchedIntent[] = [];
  const allResults: ToolResult[] = [];
  let finalMessage = '';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
      callbacks?.onTurnStart?.(turn);

      try {
        var result = await withTimeout(
          this.heavyCtx.completion(
            {
              messages: messages as any,
              tools: tools as any,
              tool_choice: includeTools ? 'auto' : 'none',
              n_predict: 1024,
              temperature: 0.3,
              stop: ['<|endoftext|>', '<|im_end|>'],
            },
            (data: any) => {
              if (data?.token && callbacks?.onToken) callbacks.onToken(data.token);
            },
          ),
          60_000,
          'Heavy LLM',
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);

        // Context overflow — retry with minimal context on first turn
        if (msg.toLowerCase().includes('context is full') && turn === 0) {
          console.warn('[LlamaService] Context is full — retrying with stripped messages');
          // Strip system prompt context to bare minimum and retry once
          const minimalSystem = buildSystemPrompt('{"now":"' + new Date().toISOString() + '"}');
          messages[0] = { role: 'system', content: minimalSystem };
          try {
            var result = await this.heavyCtx!.completion(
              {
                messages: messages as any,
                tools: tools as any,
                tool_choice: includeTools ? 'auto' : 'none',
                n_predict: 512,
                temperature: 0.3,
                stop: ['<|endoftext|>', '<|im_end|>'],
              },
              (data: any) => {
                if (data?.token && callbacks?.onToken) callbacks.onToken(data.token);
              },
            );
            // Fall through to normal processing below
          } catch {
            return {
              message: `I'm running low on memory for that request. Try a shorter message or ask me something simpler.`,
              intents: allIntents,
              results: allResults,
            };
          }
        } else if (
          msg.includes('HostFunction') ||
          msg.includes('Exception') ||
          msg.toLowerCase().includes('context is full') ||
          msg.includes('failed to parse') ||
          msg.includes('type must be string')
        ) {
          console.warn('[LlamaService] Native completion failed (heavy):', msg);
          return {
            message: `Something went wrong on my side. Try a shorter message or ask again in a moment.`,
            intents: allIntents,
            results: allResults,
          };
        } else {
          throw e;
        }
      }

      const text = (result.text ?? '').trim();
      const rawToolCalls = (result as any).tool_calls ?? [];
      // Normalize so native layer never sees null type/name/arguments (avoids "type must be string but is null")
      const toolCalls: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }> = rawToolCalls
        .filter((tc: any) => tc && (tc.function?.name || tc.name))
        .map((tc: any) => ({
          id: typeof tc.id === 'string' ? tc.id : `tc-${turn}-${Math.random().toString(36).slice(2, 9)}`,
          type: 'function' as const,
          function: {
            name: typeof tc.function?.name === 'string' ? tc.function.name : (tc.name ?? 'unknown'),
            arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : (tc.arguments ?? '{}'),
          },
        }));

      console.log(`[LlamaService] turn ${turn + 1} — text length=${text.length}, tool_calls=${toolCalls.length}`, text ? `"${text.slice(0, 120)}${text.length > 120 ? '…' : ''}"` : '(empty)');

      // If model called tools, execute them and loop
      if (toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: text || ' ', tool_calls: toolCalls });

        for (const tc of toolCalls) {
          const toolName = tc.function.name;
          const tool = toolRegistry.get(toolName);
          let toolResult: ToolResult;

          try {
            const params = JSON.parse(tc.function.arguments || '{}');
            toolResult = await executeToolWithGoalContext(toolName, params);
          } catch (e) {
            toolResult = {
              success: false,
              message: `Error: ${e instanceof Error ? e.message : String(e)}`,
            };
          }

          allIntents.push({
            tool: toolName,
            params: safeParseJson(tc.function.arguments),
            priority: 100 - allIntents.length,
          });
          allResults.push(toolResult);

          messages.push({
            role: 'tool',
            content: JSON.stringify({
              success: toolResult.success,
              message: toolResult.message,
              data: toolResult.data,
              // Hint to LLM on failure: retry with different params or explain to user
              ...(toolResult.success ? {} : { hint: 'Tool failed. Try different parameters or explain the issue to the user.' }),
            }),
            tool_call_id: tc.id,
          });
        }
        continue; // next turn — LLM sees tool results
      }

      // No tool calls — this is the final text response
      finalMessage = text;
      break;
    }

    // Fallback if we exhausted turns without final text — synthesize from tool results
    if (!finalMessage && allResults.length > 0) {
      const successes = allResults.filter((r) => r.success);
      const failures = allResults.filter((r) => !r.success);
      const parts: string[] = [];
      if (successes.length > 0) parts.push(successes.map((r) => r.message).join('. '));
      if (failures.length > 0) parts.push(`Couldn't do: ${failures.map((r) => r.message).join(', ')}`);
      finalMessage = parts.join('\n\n');
    }

    // If model returned a placeholder (e.g. "hold a moment") but we have tool results, synthesize
    if (finalMessage && allResults.length > 0 && looksLikePlaceholder(finalMessage)) {
      console.log('[LlamaService] final text looks like placeholder; synthesizing from tool results');
      const successes = allResults.filter((r) => r.success);
      const failures = allResults.filter((r) => !r.success);
      const parts: string[] = [];
      if (successes.length > 0) parts.push(successes.map((r) => r.message).join('. '));
      if (failures.length > 0) parts.push(`Couldn't do: ${failures.map((r) => r.message).join(', ')}`);
      finalMessage = parts.join('\n\n');
    }

    const output = finalMessage || `Understood: "${userInput}"`;
    console.log('[LlamaService] AI output:', output.slice(0, 200) + (output.length > 200 ? '…' : ''));

    return {
      message: output,
      intents: allIntents,
      results: allResults,
    };
  }

  /**
   * Single-turn text-only completion with the heavy model (no tools).
   * Use for structured output like routine JSON. Heavy model must already be loaded.
   */
  async completeHeavyTextOnly(userPrompt: string, systemPrompt: string): Promise<string> {
    if (!this.heavyCtx) throw new Error('Heavy model not loaded');
    this.resetHeavyIdle();

    const safeUser = sanitizeForLlama(userPrompt, 1500);
    const safeSystem = sanitizeForLlama(systemPrompt, 2000);

    const result = await this.heavyCtx.completion(
      {
        messages: [
          { role: 'system', content: safeSystem },
          { role: 'user', content: safeUser },
        ] as any,
        n_predict: 512,
        temperature: 0.2,
        stop: ['<|endoftext|>', '<|im_end|>'],
      },
      () => {},
    );

    return (result?.text ?? '').trim();
  }

  // ── Heavy idle timeout ──

  private resetHeavyIdle(): void {
    this.clearHeavyIdle();
    this.heavyIdleTimer = setTimeout(() => {
      console.log('[LlamaService] Heavy model idle timeout — unloading');
      this.releaseHeavy();
    }, HEAVY_IDLE_TIMEOUT_MS);
  }

  private clearHeavyIdle(): void {
    if (this.heavyIdleTimer) {
      clearTimeout(this.heavyIdleTimer);
      this.heavyIdleTimer = null;
    }
  }
}

function safeParseJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

/** True if the model's reply is a placeholder (e.g. "hold a moment", "fetching") rather than a real answer. */
function looksLikePlaceholder(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (t.length < 10) return true;
  const placeholderPhrases = [
    'hold a moment',
    'hold on',
    'one moment',
    'just a moment',
    'fetching',
    'let me fetch',
    'getting that',
    'looking that up',
    'give me a moment',
    'wait a moment',
  ];
  return placeholderPhrases.some((p) => t.includes(p)) && t.length < 150;
}

/** Sanitize string for native llama.rn to avoid HostFunction exceptions (null bytes, huge length, bad chars). */
function sanitizeForLlama(s: string, maxLen = 8000): string {
  if (typeof s !== 'string') return '';
  let out = s
    .replace(/\0/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (out.length > maxLen) out = out.slice(0, maxLen) + '…';
  return out;
}

export const LlamaService = new LlamaServiceImpl();
