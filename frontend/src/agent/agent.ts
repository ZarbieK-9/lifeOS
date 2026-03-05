// PicoClaw Agent — Main Orchestrator
// Two modes:
//   ONLINE:  send to backend → Gemini agentic loop → execute tools locally
//   OFFLINE: on-device LLM (llama.rn) → agentic loop → execute tools locally

import type { AgentResponse, ToolResult, Routine, MatchedIntent } from './types';
import { toolRegistry } from './tools';
import { gatherContext, detectContextNeeds } from './context';
import { routeIntent } from './router';
import { api } from '../services/api';
import { uid } from '../db/database';
import { useStore } from '../store/useStore';
import { LlamaService } from '../llm/LlamaService';
import { FAST_MODEL, HEAVY_MODEL } from '../llm/types';

export interface RunOptions {
  /** Whether the device is online and authenticated with backend. */
  online?: boolean;
  /** Command ID (pre-created by the store). */
  cmdId?: string;
}

/**
 * Run the PicoClaw agent against user input.
 *
 * Online path:
 *   1. Gather app context → send to backend (Gemini agentic loop)
 *   2. Execute tools locally → send results back → repeat
 *
 * Offline path:
 *   1. Load on-device LLM (llama.rn) → send input + context
 *   2. Execute tools locally → feed results back → repeat (max 3 turns)
 */
export async function run(
  input: string,
  _userRoutines: Routine[] = [],
  options: RunOptions = {}
): Promise<AgentResponse> {
  const { online = false, cmdId } = options;
  const tag = `[PicoClaw run] "${input.slice(0, 40)}"`;
  console.time(tag);
  console.log(`${tag} — online=${online}, cmdId=${cmdId}`);

  // ── Online path: backend + Gemini ──
  if (online) {
    try {
      const result = await runOnline(input, cmdId);
      console.timeEnd(tag);
      return result;
    } catch (e) {
      console.warn('[PicoClaw] Online path failed, falling back to offline:', e);
    }
  }

  // ── Offline path: on-device LLM ──
  const result = await runOffline(input);
  console.timeEnd(tag);
  console.log('[PicoClaw] AI output:', result.output?.slice(0, 300) + (result.output && result.output.length > 300 ? '…' : ''));
  return result;
}

/**
 * Online path: agentic multi-turn loop.
 *
 * 1. Send input + context to backend → Gemini may return tool calls
 * 2. Execute tools locally → send results back to backend
 * 3. Gemini sees results → decides: more tools or final answer
 * 4. Repeat (max MAX_AGENT_TURNS)
 */
const MAX_AGENT_TURNS = 5;

async function runOnline(
  input: string,
  cmdId?: string
): Promise<AgentResponse> {
  const tag = '[PicoClaw online]';
  console.time(`${tag} total`);

  const id = cmdId || uid();

  // Smart context — only gather what the input needs
  const needs = detectContextNeeds(input);
  console.time(`${tag} gatherContext`);
  const contextJson = await gatherContext(needs);
  console.timeEnd(`${tag} gatherContext`);

  // Accumulate across turns
  const allIntents: MatchedIntent[] = [];
  const allResults: ToolResult[] = [];
  let aiMessage = '';

  // ── Turn 1: send user input + context ──
  console.time(`${tag} agentTurn #1`);
  const firstResult = await api.agentTurn({
    input,
    context_json: contextJson,
  });
  console.timeEnd(`${tag} agentTurn #1`);

  if (!firstResult.ok) {
    throw new Error(firstResult.error || 'Backend request failed');
  }

  let sessionId = firstResult.data.session_id;
  aiMessage = firstResult.data.output || '';
  let turnData = firstResult.data;

  // ── Agentic loop ──
  let turnCount = 0;
  console.log(`${tag} turn1 done=${turnData.done}, intents=${turnData.intents?.length ?? 0}`);
  while (!turnData.done && turnData.intents?.length > 0 && turnCount < MAX_AGENT_TURNS) {
    turnCount++;

    // Parse intents from this turn
    const turnIntents: MatchedIntent[] = (turnData.intents || []).map((intent, i) => ({
      tool: intent.tool,
      params: JSON.parse(intent.params_json || '{}'),
      priority: 100 - i,
    }));

    // Execute tools locally
    console.time(`${tag} tools turn#${turnCount}`);
    const turnResults: ToolResult[] = [];
    for (const intent of turnIntents) {
      const tool = toolRegistry.get(intent.tool);
      if (!tool) {
        turnResults.push({ success: false, message: `Unknown tool: ${intent.tool}` });
        continue;
      }
      try {
        console.time(`${tag} tool:${intent.tool}`);
        const toolResult = await tool.execute(intent.params);
        console.timeEnd(`${tag} tool:${intent.tool}`);
        turnResults.push(toolResult);
      } catch (e) {
        console.timeEnd(`${tag} tool:${intent.tool}`);
        turnResults.push({
          success: false,
          message: `Error executing ${intent.tool}: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
    console.timeEnd(`${tag} tools turn#${turnCount}`);

    allIntents.push(...turnIntents);
    allResults.push(...turnResults);

    // Send tool results back to backend for next Gemini turn
    const toolResultMsgs = turnIntents.map((intent, i) => ({
      tool: intent.tool,
      success: turnResults[i].success,
      message: turnResults[i].message,
      data_json: turnResults[i].data ? JSON.stringify(turnResults[i].data) : '',
    }));

    console.time(`${tag} agentTurn #${turnCount + 1}`);
    const contResult = await api.agentTurn({
      session_id: sessionId,
      tool_results: toolResultMsgs,
    });
    console.timeEnd(`${tag} agentTurn #${turnCount + 1}`);

    if (!contResult.ok) {
      // If continuation fails, use what we have so far
      console.warn('[PicoClaw] Continuation turn failed:', contResult.error);
      break;
    }

    turnData = contResult.data;
    console.log(`${tag} turn${turnCount + 1} done=${turnData.done}, intents=${turnData.intents?.length ?? 0}`);
    // Update AI message — the final turn's output is the synthesized answer
    if (turnData.output) {
      aiMessage = turnData.output;
    }
  }

  // Build final output
  let finalOutput: string;

  if (allIntents.length === 0) {
    // Pure conversational response
    finalOutput = aiMessage || `Understood: "${input}"`;
  } else if (aiMessage) {
    // Gemini's final message already incorporates tool results (agentic loop)
    finalOutput = aiMessage;
  } else {
    // Fallback: just tool output
    finalOutput = allResults.map(r => r.message).join('\n');
  }

  await extractAndStoreMemories(finalOutput, id);

  console.log(`${tag} done — ${turnCount} agentic turns, ${allIntents.length} tools called`);
  console.timeEnd(`${tag} total`);

  return {
    input,
    intents: allIntents,
    results: allResults,
    output: finalOutput,
  };
}

// ── Proactive AI ──────────────────────────────────────

export type ProactiveType = 'morning' | 'checkin' | 'evening' | 'calendar_alert' | 'calendar_gap' | 'email_alert' | 'notification_alert';

export interface ProactiveOptions {
  type: ProactiveType;
  cmdId?: string;
  /** Extra context for event-driven triggers (event summary, email subjects, etc.) */
  detail?: string;
}

/**
 * Run a proactive AI message (scheduled or event-driven).
 * Uses backend when online and authenticated; otherwise falls back to offline (local) response.
 */
export async function runProactive(options: ProactiveOptions): Promise<AgentResponse> {
  const prompt = buildProactivePrompt(options.type, options.detail);
  const state = useStore.getState();
  const online = !!(state.isOnline && state.isAuthenticated);
  return run(prompt, [], { online, cmdId: options.cmdId });
}

function buildProactivePrompt(type: ProactiveType, detail?: string): string {
  switch (type) {
    case 'morning':
      return '[SYSTEM: MORNING BRIEFING] Generate the user\'s morning briefing. Review their calendar, tasks, and emails for today. Be cheerful and helpful.';
    case 'checkin':
      return '[SYSTEM: CHECK-IN] Quick midday check-in. Pick one or two relevant nudges based on their current state (hydration, upcoming meetings, tasks). Keep it brief.';
    case 'evening':
      return '[SYSTEM: EVENING REFLECTION] Generate the user\'s evening reflection. Summarize what they accomplished today, what carries over, and preview tomorrow.';
    case 'calendar_alert':
      return `[SYSTEM: CALENDAR ALERT] ${detail || 'An upcoming event needs attention.'}. Give the user a brief heads-up about this event. Mention any related tasks or prep they might need. If they haven't logged water today, suggest a quick log. If focus mode is off, you may suggest starting a short focus session before the event.`;
    case 'calendar_gap':
      return `[SYSTEM: CALENDAR GAP] ${detail || 'The user has free time before their next event.'}. Suggest one or two quick actions: e.g. log water, add a task, or take a short break. Keep it to one short sentence.`;
    case 'email_alert':
      return `[SYSTEM: NEW EMAILS] ${detail || 'New emails have arrived.'}. Briefly summarize what came in and highlight anything that looks important or needs action. Keep it concise.`;
    case 'notification_alert':
      return `[SYSTEM: APP NOTIFICATION] ${detail || 'The user received a notification from another app.'}. Briefly tell them what it says. If it's a message, suggest a natural reply they could send back. Keep it short.`;
  }
}

// ── Memory extraction ─────────────────────────────────

const REMEMBER_PATTERN = /\[REMEMBER:\s*(.+?)\]/g;

/**
 * Parse [REMEMBER: ...] tags from AI output and store as memories.
 * Returns the cleaned output (tags stripped).
 */
export async function extractAndStoreMemories(
  output: string,
  cmdId?: string
): Promise<void> {
  const matches = [...output.matchAll(REMEMBER_PATTERN)];
  if (matches.length === 0) return;

  for (const match of matches) {
    const fact = match[1].trim();
    if (fact) {
      await useStore.getState().addAiMemory(fact, 'general', cmdId);
    }
  }
}

/** Strip [SYSTEM: ...] tags from output (model sometimes echoes these). */
const SYSTEM_TAG_PATTERN = /\[SYSTEM:\s*[^\]]*\]/g;

/**
 * Strip [REMEMBER: ...] and [SYSTEM: ...] tags from output for display.
 */
export function cleanOutput(output: string): string {
  return output
    .replace(REMEMBER_PATTERN, '')
    .replace(SYSTEM_TAG_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Model routing via Intent Pre-Router ──────────────

/**
 * Offline path: dual-model routing via llama.rn.
 * Uses the intent pre-router for smarter model/context/tool selection.
 *
 * Fast path (0.5B): chat + simple queries — instant responses (~1-3s)
 * Heavy path (3B): actions + complex reasoning — slower but capable (~10-30s)
 */
async function runOffline(input: string): Promise<AgentResponse> {
  const tag = '[PicoClaw offline]';
  console.time(`${tag} total`);

  const routing = routeIntent(input);
  const state = useStore.getState();
  console.log(`${tag} intent=${routing.intent}, useHeavy=${routing.useHeavy}, tools=${routing.includeTools}, fastPath=${!!state.llmFastModelPath}, heavyPath=${!!state.llmModelPath}`);

  // ── Fast path: 0.5B model for chat + simple queries ──
  if (!routing.useHeavy) {
    const result = await runOfflineFast(input, routing);
    console.timeEnd(`${tag} total`);
    return result;
  }

  // ── Heavy path: 3B model for actions + complex reasoning ──
  const result = await runOfflineHeavy(input, routing);
  console.timeEnd(`${tag} total`);
  return result;
}

/** Streaming helper: wraps completion with stream buffer management. */
function makeStreamCallbacks() {
  let streamBuffer = '';
  useStore.setState({ llmStreamingText: '' });
  return {
    callbacks: {
      onToken: (token: string) => {
        streamBuffer += token;
        useStore.setState({ llmStreamingText: streamBuffer });
      },
      onTurnStart: () => {
        streamBuffer = '';
        useStore.setState({ llmStreamingText: '' });
      },
    },
    clear: () => useStore.setState({ llmStreamingText: null }),
  };
}

/** Fast offline path — 0.5B model, no tools, instant responses. */
async function runOfflineFast(input: string, routing?: import('./router').RoutingDecision): Promise<AgentResponse> {
  const tag = '[PicoClaw fast]';
  console.time(`${tag} total`);

  const state = useStore.getState();

  // Fast model not available → fall through to heavy
  if (!state.llmFastModelPath || state.llmFastModelStatus === 'not_downloaded' || state.llmFastModelStatus === 'error') {
    console.log(`${tag} fast model not available, falling through to heavy`);
    console.timeEnd(`${tag} total`);
    return runOfflineHeavy(input, routing);
  }

  if (state.llmFastModelStatus === 'downloading') {
    // Fast model still downloading — try heavy, or show downloading message
    console.log(`${tag} fast model downloading, trying heavy`);
    console.timeEnd(`${tag} total`);
    return runOfflineHeavy(input, routing);
  }

  // Load fast model
  console.time(`${tag} loadFast`);
  try {
    await LlamaService.loadFast(state.llmFastModelPath, FAST_MODEL.contextSize);
  } catch (e: any) {
    console.timeEnd(`${tag} loadFast`);
    console.warn(`${tag} fast model load failed, falling through to heavy:`, e.message);
    console.timeEnd(`${tag} total`);
    return runOfflineHeavy(input, routing);
  }
  console.timeEnd(`${tag} loadFast`);

  // Context — use router's needs + budget, or fall back to defaults
  const needs = routing?.contextNeeds ?? detectContextNeeds(input);
  const budget = routing?.contextBudget ?? 1500;
  console.time(`${tag} gatherContext`);
  const contextJson = await gatherContext(needs, budget, input);
  console.timeEnd(`${tag} gatherContext`);

  // Run fast completion with streaming
  const stream = makeStreamCallbacks();
  console.time(`${tag} completeFast`);
  try {
    const result = await LlamaService.completeFast(input, contextJson, stream.callbacks);
    console.timeEnd(`${tag} completeFast`);
    stream.clear();

    await extractAndStoreMemories(result.message);

    console.timeEnd(`${tag} total`);
    return {
      input,
      intents: result.intents,
      results: result.results,
      output: result.message,
    };
  } catch (e) {
    console.timeEnd(`${tag} completeFast`);
    stream.clear();
    throw e;
  }
}

/** Heavy offline path — 3B model with tool calling + reasoning. */
async function runOfflineHeavy(input: string, routing?: import('./router').RoutingDecision): Promise<AgentResponse> {
  const tag = '[PicoClaw heavy]';
  console.time(`${tag} total`);

  const state = useStore.getState();

  // Model not ready — tell the user
  if (!state.llmModelPath || state.llmModelStatus === 'not_downloaded' || state.llmModelStatus === 'error') {
    console.timeEnd(`${tag} total`);
    return {
      input,
      intents: [],
      results: [],
      output: "I'm offline and the AI model isn't available yet. Please connect to the internet so I can help you.",
    };
  }

  if (state.llmModelStatus === 'downloading') {
    const pct = state.llmDownloadProgress?.percent ?? 0;
    console.timeEnd(`${tag} total`);
    return {
      input,
      intents: [],
      results: [],
      output: `I'm downloading the reasoning model (${pct}%)... I'll be ready to help offline soon. Try again in a moment.`,
    };
  }

  // Load heavy model (no-op if already loaded)
  console.time(`${tag} loadHeavy`);
  useStore.setState({ llmModelStatus: 'loading' });
  try {
    await LlamaService.loadHeavy(state.llmModelPath, HEAVY_MODEL.contextSize);
  } catch (e: any) {
    console.timeEnd(`${tag} loadHeavy`);
    useStore.setState({ llmModelStatus: 'error', llmError: e.message });
    return {
      input,
      intents: [],
      results: [],
      output: "Offline AI isn't available in this build. Run `npx expo prebuild --clean` and build a dev client to use on-device AI.",
    };
  }
  console.timeEnd(`${tag} loadHeavy`);
  useStore.setState({ llmModelStatus: 'ready', llmLoaded: true });

  // Smart context — use router's needs + budget, or fall back to defaults
  const needs = routing?.contextNeeds ?? detectContextNeeds(input);
  const budget = routing?.contextBudget ?? 3000;
  console.time(`${tag} gatherContext`);
  const contextJson = await gatherContext(needs, budget, input);
  console.timeEnd(`${tag} gatherContext`);
  console.log(`${tag} calling LLM with context (${contextJson.length} chars)`);

  // Run agentic completion with streaming
  const stream = makeStreamCallbacks();
  console.time(`${tag} complete`);
  try {
    const result = await LlamaService.complete(input, contextJson, stream.callbacks);
    console.timeEnd(`${tag} complete`);
    stream.clear();

    await extractAndStoreMemories(result.message);

    console.timeEnd(`${tag} total`);
    return {
      input,
      intents: result.intents,
      results: result.results,
      output: result.message,
    };
  } catch (e) {
    console.timeEnd(`${tag} complete`);
    stream.clear();
    throw e;
  }
}
