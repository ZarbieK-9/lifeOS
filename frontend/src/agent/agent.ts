// PicoClaw Agent — Main Orchestrator (offline-only)
// On-device LLM (llama.rn) → agentic loop → execute tools locally
//
// NEW: Domain agents + tools (LLM calls tools; no regex goal shortcut).
// Plans from prior sessions: executeAllPendingPlans on init.

import type { AgentResponse, Routine, RoutineStep } from './types';
import { executeToolWithGoalContext, toolRegistry } from './tools';
import { gatherContext, detectContextNeeds } from './context';
import { routeIntent } from './router';
import { useStore } from '../store/useStore';
import { LlamaService } from '../llm/LlamaService';
import { FAST_MODEL, HEAVY_MODEL } from '../llm/types';
import { eventBus } from './eventBus';
import { executeAllPendingPlans } from './executor';
import { analyzePatterns, updatePatternsForTool } from './patterns';
import { evaluate as evaluateWatcher, initWatcher, setNotifyCallback } from './watcher';
import { domainAgents } from './domains/index';
import { recordStageLatency } from './latency';

export interface RunOptions {
  /** Command ID (pre-created by the store). */
  cmdId?: string;
}

export interface VoiceRunOptions extends RunOptions {
  handsFree?: boolean;
}

// ── Initialization ────────────────────────────────

let _initialized = false;
let _watcherCleanup: (() => void) | null = null;
let _lastWarmAt = 0;

/**
 * Initialize the agentic system. Call once at app boot.
 * - Loads goals, plans, patterns from DB
 * - Starts the watcher
 * - Subscribes domain agents to the event bus
 * - Runs initial pattern analysis
 */
export async function initAgentSystem(
  notifyFn?: (title: string, body: string, priority: 'high' | 'low') => void,
): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  const tag = '[PicoClaw init]';
  console.time(tag);

  // Agentic state (goals, plans, patterns, watcher queue) is already loaded by store.init()
  // This function only sets up event bus, watcher, and domain agents.

  // Set up push notification callback
  if (notifyFn) setNotifyCallback(notifyFn);

  // Subscribe domain agents to the event bus
  for (const agent of domainAgents) {
    eventBus.onAny((event) => agent.onEvent(event).catch(() => {}));
  }

  // Incremental pattern updates on tool execution
  eventBus.on('tool_result', (event) => {
    updatePatternsForTool(event.tool).catch(() => {});
  });

  // Start the watcher
  _watcherCleanup = initWatcher();

  // Run initial pattern analysis (background, don't block boot)
  analyzePatterns().catch((e) => console.warn('[Agent] initial pattern analysis failed:', e));

  // Execute any pending plans from previous session
  executeAllPendingPlans().catch((e) => console.warn('[Agent] pending plan execution failed:', e));

  console.timeEnd(tag);
}

/** Teardown the agent system (for testing / hot reload). */
export function teardownAgentSystem(): void {
  if (_watcherCleanup) _watcherCleanup();
  eventBus.clear();
  _initialized = false;
}

// ── Existing patterns ─────────────────────────────

const PLAN_MY_DAY_PATTERN = /\b(plan\s+my\s+day|organize\s+my\s+day|plan\s+today|organize\s+today)\b/i;

/** Prompt used when user asks to plan or organize their day (full calendar + tasks context). */
const PLAN_MY_DAY_PROMPT = `[SYSTEM: PLAN MY DAY] The user asked you to plan their day. Use the calendar and tasks in the context below. Create a time-ordered plan for today: use create_event for fixed-time items, add_task for to-dos. Then summarize the plan in 2-3 short sentences.`;

const CREATE_ROUTINE_PATTERN = /\b(create|save|make|add|define)\s+(a\s+)?routine\b|routine\s*:\s*.+|when\s+i\s+say\s+.+\s+do\s+/i;

const ROUTINE_JSON_SYSTEM = `You output only valid JSON. No markdown, no explanation.
Format: {"name":"Routine name","triggerPhrases":["phrase1","phrase2"],"steps":[{"tool":"log_hydration","params":{"amount_ml":250}},{"tool":"add_task","params":{"title":"Task title","priority":"medium"}}]}.
Use only these tools: log_hydration, add_task, complete_task, delete_task, set_focus_mode, query_tasks, query_hydration, query_calendar, create_event, schedule_reminder, log_sleep, query_sleep.`;

/**
 * If the user is asking to create a routine from natural language, run the heavy model to extract JSON, save the routine, and return a response. Otherwise return null.
 */
async function tryCreateRoutineFromNaturalLanguage(input: string): Promise<AgentResponse | null> {
  if (!CREATE_ROUTINE_PATTERN.test(input.trim())) return null;

  const state = useStore.getState();
  if (!state.llmModelPath || state.llmModelStatus === 'not_downloaded' || state.llmModelStatus === 'error' || state.llmModelStatus === 'downloading') {
    return null;
  }

  try {
    await LlamaService.loadHeavy(state.llmModelPath, HEAVY_MODEL.contextSize);
  } catch {
    return null;
  }

  const userPrompt = `The user wants to create a routine. Their description: "${input.trim()}"
Output a JSON object with: "name" (string), "triggerPhrases" (array of strings, e.g. ["morning routine", "start my day"]), "steps" (array of {"tool": "tool_name", "params": {...}}). Output ONLY the JSON object.`;

  let raw: string;
  try {
    raw = await LlamaService.completeHeavyTextOnly(userPrompt, ROUTINE_JSON_SYSTEM);
  } catch {
    return null;
  }

  const jsonStr = raw.replace(/```\w*\n?/g, '').replace(/\n/g, ' ').trim();
  const match = jsonStr.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed: { name?: string; triggerPhrases?: string[]; steps?: Array<{ tool: string; params?: Record<string, unknown> }> };
  try {
    parsed = JSON.parse(match[0]) as typeof parsed;
  } catch {
    return null;
  }

  const name = (parsed.name && String(parsed.name).trim()) || 'My routine';
  const triggerPhrases = Array.isArray(parsed.triggerPhrases)
    ? parsed.triggerPhrases.map((p) => String(p).trim()).filter(Boolean)
    : ['my routine'];
  const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];

  const steps: RoutineStep[] = [];
  for (const s of rawSteps) {
    const tool = s?.tool && String(s.tool).trim();
    if (!tool || !toolRegistry.get(tool)) continue;
    steps.push({
      tool,
      params: (s.params && typeof s.params === 'object') ? s.params as Record<string, unknown> : {},
    });
  }

  if (steps.length === 0) {
    return {
      input,
      intents: [],
      results: [],
      output: "I couldn't figure out the steps for that routine. Try listing actions like \"log 250ml water\" and \"add task standup\".",
    };
  }

  await useStore.getState().addRoutine(name, triggerPhrases.length ? triggerPhrases : [name.toLowerCase()], steps);

  return {
    input,
    intents: [],
    results: [],
    output: `Routine "${name}" saved with ${steps.length} step(s). Say "${triggerPhrases[0] || name}" to run it.`,
  };
}

// ── Main entry point ──────────────────────────────

/**
 * Run the PicoClaw agent against user input (offline-only).
 *
 * Flow:
 * 1. Emit user_input event
 * 2. Check for routine creation (LLM JSON, not regex goals)
 * 3. Route to LLM (fast/heavy path) — tools perform tasks / create_goal
 * 4. After response: emit events, patterns, watcher
 */
export async function run(
  input: string,
  _userRoutines: Routine[] = [],
  options: RunOptions = {}
): Promise<AgentResponse> {
  const { cmdId } = options;
  const tag = `[PicoClaw run] "${input.slice(0, 40)}"`;
  console.time(tag);
  console.log(`${tag} cmdId=${cmdId ?? 'none'}`);

  // Emit user input event
  eventBus.emit({ type: 'user_input', input, cmdId });

  // Auto-generate chat title from first user message
  const state = useStore.getState();
  if (state.currentChatId) {
    const session = state.chatSessions.find((s) => s.id === state.currentChatId);
    if (session && !session.title) {
      const title = input.replace(/\[.*?\]/g, '').slice(0, 40).trim() || 'Chat';
      state.updateChatTitle(state.currentChatId, title).catch(() => {});
    }
  }

  // 1. Create routine from natural language
  const routineResult = await tryCreateRoutineFromNaturalLanguage(input);
  if (routineResult) {
    console.timeEnd(tag);
    return routineResult;
  }

  // 2. Plan my day / organize my day → use structured prompt
  const effectiveInput = PLAN_MY_DAY_PATTERN.test(input.trim()) ? PLAN_MY_DAY_PROMPT : input;

  // 3. Run through LLM (tools + domain agents handle actions)
  const result = await runOffline(effectiveInput);

  // 4. Post-processing: emit events + update patterns (background)
  postProcess(input, result).catch(() => {});

  console.timeEnd(tag);
  console.log('[PicoClaw] AI output:', result.output?.slice(0, 300) + (result.output && result.output.length > 300 ? '…' : ''));
  return result;
}

/** Voice-first entry point: capture -> plan -> execute with policy/approval gates. */
export async function runVoiceCommand(
  input: string,
  options: VoiceRunOptions = {},
): Promise<AgentResponse> {
  const prefixed = options.handsFree ? `[VOICE] ${input}` : input;
  return run(prefixed, [], options);
}

/** Simulate weekly actions without side effects. */
export async function simulateWeekPlan(): Promise<AgentResponse> {
  const prompt =
    "[SYSTEM: SIMULATION] Show what you would do this week without executing tools. Include priorities, reminders, and policy checks.";
  const prev = useStore.getState().simulationMode;
  useStore.getState().setSimulationMode(true);
  try {
    return await run(prompt);
  } finally {
    useStore.getState().setSimulationMode(prev);
  }
}

/** Post-processing after LLM response: events, patterns, watcher. */
async function postProcess(input: string, result: AgentResponse): Promise<void> {
  const postStart = Date.now();
  // Check if any tool results should progress a goal
  for (const toolResult of result.results) {
    if (toolResult.success) {
      // Domain agents handle goal progress via event bus (onEvent)
      // The tool_result events are emitted by LlamaService during execution
    }
  }

  // Refresh patterns periodically (every 10th message)
  const cmds = useStore.getState().aiCommands;
  if (cmds.length % 10 === 0) {
    await analyzePatterns();
  }
  const postStats = recordStageLatency('post_process', Date.now() - postStart);
  useStore
    .getState()
    .enqueueEvent('agent_outcome', {
      source: 'agent',
      phase: 'post_process',
      post_p50_ms: postStats.p50,
      post_p95_ms: postStats.p95,
    })
    .catch(() => {});
}

// ── Proactive AI (enhanced with watcher) ──────────

export type ProactiveType = 'morning' | 'checkin' | 'evening' | 'calendar_alert' | 'calendar_gap' | 'email_alert' | 'notification_alert';

export interface ProactiveOptions {
  type: ProactiveType;
  cmdId?: string;
  /** Extra context for event-driven triggers (event summary, email subjects, etc.) */
  detail?: string;
}

/**
 * Run a proactive AI message. Now enhanced with watcher insights.
 * The watcher handles most proactive behavior; this is kept for
 * backward compatibility with notification handlers that use specific types.
 */
export async function runProactive(options: ProactiveOptions): Promise<AgentResponse> {
  const prompt = buildProactivePrompt(options.type, options.detail);
  return run(prompt, [], { cmdId: options.cmdId });
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

// ── App lifecycle hooks ───────────────────────────

/** Call when app comes to foreground. Triggers watcher evaluation + pattern refresh. */
export function onAppForeground(): void {
  eventBus.emit({ type: 'app_lifecycle', action: 'foreground' });
  warmCriticalPaths().catch(() => {});
}

/** Call when app goes to background. */
export function onAppBackground(): void {
  eventBus.emit({ type: 'app_lifecycle', action: 'background' });
}

async function warmCriticalPaths(): Promise<void> {
  const now = Date.now();
  // Keep warm window modest to avoid battery churn.
  if (now - _lastWarmAt < 2 * 60 * 1000) return;
  _lastWarmAt = now;

  const state = useStore.getState();
  try {
    if (state.llmFastModelPath && state.llmFastModelStatus === 'ready') {
      await LlamaService.loadFast(state.llmFastModelPath, FAST_MODEL.contextSize);
    }
  } catch {
    // best-effort warm path
  }

  try {
    const needs = { calendar: false, emails: false, tasks: true, notes: false, mood: false, expenses: false, full: false };
    await gatherContext(needs, 900, 'quick warmup', state.currentChatId ?? null);
  } catch {
    // best-effort cache/context warm path
  }
}

// ── Memory extraction ─────────────────────────────

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

/** Strip [PLAN: ...] reasoning tags (visible scaffolding for small models). */
const PLAN_TAG_PATTERN = /\[PLAN:\s*[^\]]*\]/g;

/** Detect [CLARIFY: ...] tags (model is asking for clarification). */
const CLARIFY_TAG_PATTERN = /\[CLARIFY:\s*([^\]]*)\]/g;

/**
 * Strip internal tags from output for display.
 * Preserves [CLARIFY:] content but reformats it as a natural question.
 */
export function cleanOutput(output: string): string {
  // Extract clarification requests and reformat as natural questions
  let cleaned = output;
  const clarifyMatches = [...cleaned.matchAll(CLARIFY_TAG_PATTERN)];
  for (const match of clarifyMatches) {
    const question = match[1].trim();
    // Replace the tag with a natural question
    cleaned = cleaned.replace(match[0], question.endsWith('?') ? question : `${question}?`);
  }

  return cleaned
    .replace(REMEMBER_PATTERN, '')
    .replace(SYSTEM_TAG_PATTERN, '')
    .replace(PLAN_TAG_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Generate a short suggested reply for a message (e.g. notification body) using the fast model.
 * Returns null if the model isn't loaded or generation fails.
 */
export async function generateSuggestedReply(messageSnippet: string): Promise<string | null> {
  const state = useStore.getState();
  if (!state.llmFastModelPath || state.llmFastModelStatus === 'not_downloaded' || state.llmFastModelStatus === 'error' || state.llmFastModelStatus === 'downloading') {
    return null;
  }
  try {
    await LlamaService.loadFast(state.llmFastModelPath, FAST_MODEL.contextSize);
  } catch {
    return null;
  }
  const prompt = `Suggest a single short reply (1 line, casual) to this message. Output ONLY the reply, no quotes or explanation.\nMessage: ${messageSnippet.slice(0, 300)}`;
  try {
    const result = await LlamaService.completeFast(prompt, '{}');
    const reply = (result.message || '').replace(/^["']|["']$/g, '').trim().slice(0, 200);
    return reply.length > 0 ? reply : null;
  } catch {
    return null;
  }
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

  const routeStart = Date.now();
  const routing = routeIntent(input);
  const routeStats = recordStageLatency('route', Date.now() - routeStart);
  const state = useStore.getState();
  console.log(`${tag} intent=${routing.intent}, useHeavy=${routing.useHeavy}, tools=${routing.includeTools}, fastPath=${!!state.llmFastModelPath}, heavyPath=${!!state.llmModelPath}`);
  useStore.getState().logAgentAction({
    agent: 'router',
    actionType: 'monitor',
    input,
    output: JSON.stringify({
      intent: routing.intent,
      useHeavy: routing.useHeavy,
      includeTools: routing.includeTools,
      contextBudget: routing.contextBudget,
      directTool: routing.directTool?.tool ?? null,
      route_p50_ms: routeStats.p50,
      route_p95_ms: routeStats.p95,
    }),
    goalId: null,
    planId: null,
    success: true,
  }).catch(() => {});

  if (routing.directTool && routing.intent === 'action') {
    const validateStart = Date.now();
    recordStageLatency('validate', Date.now() - validateStart);

    const toolStart = Date.now();
    const toolResult = await executeToolWithGoalContext(
      routing.directTool.tool,
      routing.directTool.params,
    );
    const toolStats = recordStageLatency('tool_execution', Date.now() - toolStart);
    useStore
      .getState()
      .enqueueEvent('agent_outcome', {
        source: 'router',
        phase: 'direct_dispatch',
        tool: routing.directTool.tool,
        reason: routing.directTool.reason,
        success: toolResult.success,
        tool_p50_ms: toolStats.p50,
        tool_p95_ms: toolStats.p95,
      })
      .catch(() => {});

    console.timeEnd(`${tag} total`);
    return {
      input,
      intents: [{ tool: routing.directTool.tool, params: routing.directTool.params }],
      results: [toolResult],
      output: toolResult.message,
    };
  }

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
async function runOfflineFast(input: string, routing?: import('./router').RoutingDecision, _noFallback?: boolean): Promise<AgentResponse> {
  const tag = '[PicoClaw fast]';
  console.time(`${tag} total`);

  const state = useStore.getState();
  const unavailableResponse = (reason: string): AgentResponse => ({
    input,
    intents: [],
    results: [],
    output: `The AI model isn't available right now (${reason}). Please try again in a moment.`,
  });

  // Fast model not available → fall through to heavy (unless recursion guard)
  if (!state.llmFastModelPath || state.llmFastModelStatus === 'not_downloaded' || state.llmFastModelStatus === 'error') {
    console.log(`${tag} fast model not available${_noFallback ? ' (no fallback)' : ', falling through to heavy'}`);
    console.timeEnd(`${tag} total`);
    if (_noFallback) return unavailableResponse('fast model not available');
    return runOfflineHeavy(input, routing);
  }

  if (state.llmFastModelStatus === 'downloading') {
    console.log(`${tag} fast model downloading${_noFallback ? ' (no fallback)' : ', trying heavy'}`);
    console.timeEnd(`${tag} total`);
    if (_noFallback) return unavailableResponse('model still downloading');
    return runOfflineHeavy(input, routing);
  }

  // Load fast model
  console.time(`${tag} loadFast`);
  try {
    await LlamaService.loadFast(state.llmFastModelPath, FAST_MODEL.contextSize);
  } catch (e: any) {
    console.timeEnd(`${tag} loadFast`);
    console.warn(`${tag} fast model load failed${_noFallback ? ' (no fallback)' : ', falling through to heavy'}:`, e.message);
    console.timeEnd(`${tag} total`);
    if (_noFallback) return unavailableResponse('model load failed');
    return runOfflineHeavy(input, routing);
  }
  console.timeEnd(`${tag} loadFast`);

  // Context — use router's needs + budget, or fall back to defaults
  const needs = routing?.contextNeeds ?? detectContextNeeds(input);
  const budget = routing?.contextBudget ?? 1500;
  console.time(`${tag} gatherContext`);
  const chatId = useStore.getState().currentChatId;
  const contextJson = await gatherContext(needs, budget, input, chatId);
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

  // Model not ready — differentiated messages
  if (!state.llmModelPath || state.llmModelStatus === 'not_downloaded') {
    console.timeEnd(`${tag} total`);
    return {
      input,
      intents: [],
      results: [],
      output: "Download the offline model in Settings to use PicoClaw without the internet.",
    };
  }
  if (state.llmModelStatus === 'error') {
    console.timeEnd(`${tag} total`);
    return {
      input,
      intents: [],
      results: [],
      output: "Offline model failed to load. Try re-downloading it in Settings or restarting the app.",
    };
  }

  if (state.llmModelStatus === 'downloading') {
    const pct = state.llmDownloadProgress?.percent ?? 0;
    console.timeEnd(`${tag} total`);
    return {
      input,
      intents: [],
      results: [],
      output: `Downloading the reasoning model (${pct}%)… Try again in a moment.`,
    };
  }

  // Load heavy model (no-op if already loaded)
  console.time(`${tag} loadHeavy`);
  useStore.setState({ llmModelStatus: 'loading' });
  try {
    await LlamaService.loadHeavy(state.llmModelPath, HEAVY_MODEL.contextSize);
  } catch (e: any) {
    console.timeEnd(`${tag} loadHeavy`);
    useStore.setState({ llmModelStatus: 'error', llmError: e?.message });
    const msg = e?.message ?? '';
    const isNativeModuleMissing = /native module not available|not available\. Run/i.test(msg);
    return {
      input,
      intents: [],
      results: [],
      output: isNativeModuleMissing
        ? "On-device AI needs a dev build. Run `npx expo prebuild --clean` and build the app (Expo Go doesn't support it)."
        : "Offline model failed to load. Try re-downloading it in Settings or restarting the app.",
    };
  }
  console.timeEnd(`${tag} loadHeavy`);
  useStore.setState({ llmModelStatus: 'ready', llmLoaded: true });

  // Smart context — use router's needs + budget, or fall back to defaults
  const needs = routing?.contextNeeds ?? detectContextNeeds(input);
  const budget = routing?.contextBudget ?? 4500;
  console.time(`${tag} gatherContext`);
  const chatId = useStore.getState().currentChatId;
  const contextJson = await gatherContext(needs, budget, input, chatId);
  console.timeEnd(`${tag} gatherContext`);
  console.log(`${tag} calling LLM with context (${contextJson.length} chars)`);

  const isSimulation = useStore.getState().simulationMode;
  // Run agentic completion with streaming
  const stream = makeStreamCallbacks();
  console.time(`${tag} complete`);
  try {
    const result = await LlamaService.complete(input, contextJson, stream.callbacks, {
      includeTools: isSimulation ? false : (routing?.includeTools ?? true),
    });
    console.timeEnd(`${tag} complete`);
    stream.clear();

    await extractAndStoreMemories(result.message);

    // Emit tool_result events for any tools executed during the LLM loop
    for (let i = 0; i < result.intents.length; i++) {
      const intent = result.intents[i];
      const toolResult = result.results[i];
      if (intent && toolResult) {
        eventBus.emit({
          type: 'tool_result',
          tool: intent.tool,
          params: intent.params,
          result: toolResult,
        });
      }
    }

    console.timeEnd(`${tag} total`);
    return {
      input,
      intents: result.intents,
      results: result.results,
      output: isSimulation ? `[simulation] ${result.message}` : result.message,
    };
  } catch (e) {
    console.timeEnd(`${tag} complete`);
    stream.clear();
    console.warn(`${tag} heavy completion failed, falling back to fast model:`, e);
    try {
      const fastResult = await runOfflineFast(input, routing, true);
      return {
        ...fastResult,
        output: `[Using quick model — complex actions may not work]\n${fastResult.output}`,
      };
    } catch (fastErr) {
      console.warn(`${tag} fast fallback also failed:`, fastErr);
      return {
        input,
        intents: [],
        results: [],
        output: 'Both AI models had trouble with that request. Try again in a moment, or restart the app.',
      };
    }
  }
}
