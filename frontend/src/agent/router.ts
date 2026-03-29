// Intent Pre-Router — classifies user input to determine:
//   1. Which model to use (fast 0.5B vs heavy 3B)
//   2. Which context sections to include
//   3. Whether tools are needed
//
// Replaces the old binary needsHeavyModel() keyword check with
// a multi-signal classifier that reduces unnecessary heavy model loads.

import type { ContextNeeds } from './context';

// ── Intent types ─────────────────────────────────────

export type IntentType =
  | 'action'      // needs tools — log water, add task, send email, etc.
  | 'query'       // needs context but no tools — "what's on my schedule?"
  | 'chat'        // pure conversation — "how are you?", "tell me a joke"
  | 'system';     // proactive/system messages — morning briefing, etc.

export interface RoutingDecision {
  intent: IntentType;
  /** Use heavy (3B) model? false = fast (0.5B) */
  useHeavy: boolean;
  /** Context needs for gatherContext */
  contextNeeds: ContextNeeds;
  /** Context char budget (null = no limit / online) */
  contextBudget: number | null;
  /** Include tools in prompt? */
  includeTools: boolean;
  /** Direct deterministic tool dispatch for obvious intents (skip LLM). */
  directTool?: { tool: string; params: Record<string, unknown>; reason: string };
}

// ── Pattern matchers ─────────────────────────────────

const SYSTEM_PREFIX = /^\[SYSTEM:/;

/** Goal-setting patterns — user wants to set a goal or commitment */
const GOAL_PATTERNS = /\b(goal|target|aim|want to|help me|i want|i need to|commit to|challenge|let'?s)\b/i;

/** Action verbs that require tool execution */
const ACTION_PATTERNS = /\b(log|add|create|delete|remove|complete|done|start|stop|set|send|reply|edit|update|cancel|snooze|remind|block|schedule|track)\b/i;

/** Domain nouns that pair with actions to confirm intent */
const ACTION_NOUNS = /\b(water|hydrat|ml|task|todo|to-?do|timer|focus|pomodoro|sleep|wake|habit|expense|budget|note|journal|reminder|alarm|email|mail|event|meeting|time\s*block)\b/i;

/** Query patterns — asking for information */
const QUERY_PATTERNS = /\b(what|how\s+much|how\s+many|show|list|tell\s+me|status|progress|summary|recap|review|any|check|overview)\b/i;

/** Query domain nouns — context-dependent questions */
const QUERY_NOUNS = /\b(schedule|calendar|task|todo|email|mood|energy|expense|spend|budget|streak|score|habit|note|memory|sleep|water|hydrat|inbox)\b/i;

/** Compound patterns — actions disguised as questions */
const COMPOUND_ACTION = /\b(can\s+you|could\s+you|please|i\s+want\s+to|i\s+need\s+to|go\s+ahead|let'?s)\b/i;

/** Greeting patterns — definitely chat */
const GREETING_PATTERNS = /^(hey|hi|hello|good\s*(morning|afternoon|evening|night)|what'?s\s*up|sup|yo|howdy|greetings?)\b/i;

/** Pure chat — small talk, opinions, jokes */
const CHAT_PATTERNS = /\b(joke|funny|think|opinion|feel\s+about|chat|talk|bored|thanks|thank\s+you|love\s+you|cool|nice|great|awesome|lol|haha)\b/i;

// ── Context need patterns ────────────────────────────

const CONTEXT_CALENDAR = /\b(calendar|schedule|meeting|event|appointment|today|tomorrow|plan\s+my\s+day|morning|afternoon|busy|free|when|organize)\b/i;
const CONTEXT_EMAIL = /\b(emails?|mail|mails|inbox|unread|message|gmail|send|reply|respond)\b/i;
const CONTEXT_TASK = /\b(task|todo|to-?do|list|pending|complete|done|plan|remind|add\s+task|finish)\b/i;
const CONTEXT_NOTE = /\b(notes?|journal|wrote|entry|write|diary|log\s+thought)\b/i;
const CONTEXT_MOOD = /\b(mood|energy|feeling|feel|stress|happy|sad|tired|anxious|emotion)\b/i;
const CONTEXT_EXPENSE = /\b(expense|spent|spend|cost|budget|money|price|pay|paid|dollar|purchase|\$\d)\b/i;

// ── Router ───────────────────────────────────────────

/**
 * Classify user input and determine routing.
 * Uses a weighted scoring system rather than simple keyword match.
 */
export function routeIntent(input: string): RoutingDecision {
  const directTool = detectDirectToolIntent(input);
  // System messages always get full treatment
  if (SYSTEM_PREFIX.test(input)) {
    return {
      intent: 'system',
      useHeavy: true,
      contextNeeds: { calendar: true, emails: true, tasks: true, notes: true, mood: true, expenses: true, full: true },
      contextBudget: 4500,
      includeTools: true,
      directTool,
    };
  }

  // Score each intent type
  let actionScore = 0;
  let queryScore = 0;
  let chatScore = 0;

  // Goal signals — goals are actions (need heavy model + tools)
  if (GOAL_PATTERNS.test(input) && ACTION_NOUNS.test(input)) actionScore += 4;

  // Action signals
  if (ACTION_PATTERNS.test(input)) actionScore += 3;
  if (ACTION_NOUNS.test(input)) actionScore += 2;
  if (COMPOUND_ACTION.test(input) && ACTION_NOUNS.test(input)) actionScore += 2;

  // Query signals
  if (QUERY_PATTERNS.test(input)) queryScore += 3;
  if (QUERY_NOUNS.test(input)) queryScore += 1;

  // Chat signals
  if (GREETING_PATTERNS.test(input)) chatScore += 4;
  if (CHAT_PATTERNS.test(input)) chatScore += 3;

  // Short messages with no domain nouns are likely chat
  const wordCount = input.trim().split(/\s+/).length;
  if (wordCount <= 3 && actionScore === 0 && queryScore === 0) chatScore += 2;

  // If query patterns + action nouns but no action verbs, it's a query not action
  if (queryScore > 0 && actionScore <= 2 && QUERY_NOUNS.test(input) && !ACTION_PATTERNS.test(input)) {
    queryScore += 2;
  }

  // Determine winner
  const maxScore = Math.max(actionScore, queryScore, chatScore);
  let intent: IntentType;

  if (maxScore === 0) {
    // No clear signals — default to chat (fast model)
    intent = 'chat';
  } else if (actionScore === maxScore && actionScore > queryScore) {
    intent = 'action';
  } else if (queryScore === maxScore && queryScore > chatScore) {
    intent = 'query';
  } else {
    intent = 'chat';
  }

  // Build context needs based on input content
  const contextNeeds: ContextNeeds = {
    calendar: CONTEXT_CALENDAR.test(input),
    emails: CONTEXT_EMAIL.test(input),
    tasks: CONTEXT_TASK.test(input),
    notes: CONTEXT_NOTE.test(input),
    mood: CONTEXT_MOOD.test(input),
    expenses: CONTEXT_EXPENSE.test(input),
    full: false,
  };

  // Build routing decision
  switch (intent) {
    case 'action':
      return {
        intent,
        useHeavy: true,
        contextNeeds,
        contextBudget: 4500,
        includeTools: true,
        directTool,
      };

    case 'query':
      // Queries can often use the fast model if the answer is in context
      // Only use heavy if we need to search across complex data
      const needsReasoning = /\b(compare|analyze|trend|correlat|suggest|recommend|plan|optimize)\b/i.test(input);
      return {
        intent,
        useHeavy: needsReasoning,
        contextNeeds,
        contextBudget: needsReasoning ? 4500 : 1500,
        includeTools: false,
        directTool,
      };

    case 'chat':
    default:
      return {
        intent,
        useHeavy: false,
        contextNeeds: { calendar: false, emails: false, tasks: false, notes: false, mood: false, expenses: false, full: false },
        contextBudget: 1500,
        includeTools: false,
        directTool,
      };
  }
}

/**
 * Direct deterministic dispatch for obvious, unambiguous commands.
 * Skips LLM entirely for instant execution. Returns undefined for
 * anything ambiguous — the LLM handles those.
 */
function detectDirectToolIntent(inputRaw: string): RoutingDecision['directTool'] {
  const input = inputRaw.trim();

  // Skip compound requests — let LLM decompose them
  if (input.length > 100 || /\b(and|also|then|&)\b/i.test(input)) return undefined;

  const DIRECT_PATTERNS: Array<{
    pattern: RegExp;
    tool: string;
    extract: (m: RegExpMatchArray) => Record<string, unknown>;
    reason: string;
  }> = [
    {
      pattern: /\b(?:log|drank|drink|had)\s+(\d{2,4})\s*ml\b/i,
      tool: 'log_hydration',
      extract: (m) => ({ amount_ml: parseInt(m[1], 10) }),
      reason: 'explicit ml amount',
    },
    {
      pattern: /^(\d{2,4})\s*ml\s*(?:water|of water)?\s*$/i,
      tool: 'log_hydration',
      extract: (m) => ({ amount_ml: parseInt(m[1], 10) }),
      reason: 'standalone ml amount',
    },
    {
      pattern: /\b(?:add|new|create)\s+task\s+(.{3,80})/i,
      tool: 'add_task',
      extract: (m) => ({ title: m[1].trim().replace(/[.!?]+$/, '') }),
      reason: 'explicit add task',
    },
    {
      pattern: /\b(?:complete|done|finish|mark\s+done)\s+(.{3,80})/i,
      tool: 'complete_task',
      extract: (m) => ({ title_match: m[1].trim().replace(/[.!?]+$/, '') }),
      reason: 'explicit complete task',
    },
    {
      pattern: /\b(?:start\s+)?focus\s+(\d{1,3})\s*(?:min(?:utes?)?)?/i,
      tool: 'set_focus_mode',
      extract: (m) => ({ enabled: true, durationMin: parseInt(m[1], 10) }),
      reason: 'explicit focus duration',
    },
    {
      pattern: /\b(?:log|start)\s+sleep\b|going\s+to\s+(?:bed|sleep)\b/i,
      tool: 'log_sleep',
      extract: () => ({ action: 'start' }),
      reason: 'explicit sleep start',
    },
    {
      pattern: /\bwoke\s+up\b|\bstop\s+sleep\b/i,
      tool: 'log_sleep',
      extract: () => ({ action: 'stop' }),
      reason: 'explicit wake up',
    },
  ];

  for (const { pattern, tool, extract, reason } of DIRECT_PATTERNS) {
    const match = input.match(pattern);
    if (match) {
      return { tool, params: extract(match), reason };
    }
  }

  return undefined;
}
