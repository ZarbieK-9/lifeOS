// Dynamic system prompt + tool schema builder for the on-device LLM.
// Reads toolRegistry so new tools are auto-included.

import { toolRegistry } from '../agent/tools';

/** llama.rn OpenAI-format tool definition */
export interface LlamaToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description?: string }>;
      required: string[];
    };
  };
}

/**
 * Convert the app's toolRegistry into llama.rn tool definitions.
 * Called per completion so new tools are automatically included.
 */
export function buildToolDefinitions(): LlamaToolDef[] {
  const defs: LlamaToolDef[] = [];

  toolRegistry.forEach((tool) => {
    defs.push(toolToDef(tool));
  });

  return defs;
}

function toolToDef(tool: { name: string; description: string; params: Record<string, any> }): LlamaToolDef {
  const properties: Record<string, { type: string; description?: string }> = {};
  const required: string[] = [];

  for (const [name, schema] of Object.entries(tool.params)) {
    const t = schema?.type;
    properties[name] = {
      type: typeof t === 'string' ? t : 'string',
      description: schema?.description,
    };
    if (schema?.required) required.push(name);
  }

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: { type: 'object', properties, required },
    },
  };
}

// ── Smart tool filtering for on-device models ──────────────
// The on-device models have small context windows (2048-4096 tokens).
// With 29+ tools, definitions alone can exceed the context window.
// This filters to only the tools relevant to the user's input.

/** Tool groups mapped to keyword patterns. All names must exist in toolRegistry. */
const TOOL_GROUPS: Record<string, { pattern: RegExp; tools: string[] }> = {
  hydration: {
    pattern: /\b(water|hydrat|drink|ml|thirst|sip)\b/i,
    tools: ['log_hydration', 'set_hydration_reminder', 'disable_hydration_reminder', 'query_hydration'],
  },
  tasks: {
    pattern: /\b(task|todo|to-?do|add|create|delete|remove|complete|done|pending|finish|list)\b/i,
    tools: ['add_task', 'complete_task', 'delete_task', 'query_tasks'],
  },
  sleep: {
    pattern: /\b(sleep|wake|nap|bed|rest)\b/i,
    tools: ['log_sleep', 'query_sleep'],
  },
  focus: {
    pattern: /\b(focus|timer|pomodoro|concentrate|deep\s*work)\b/i,
    tools: ['set_focus_mode'],
  },
  email: {
    pattern: /\b(email|mail|send|reply|respond|gmail)\b/i,
    tools: ['query_emails', 'triage_emails', 'extract_tasks_from_email'],
  },
  calendar: {
    pattern: /\b(calendar|schedule|event|meeting|sync|google)\b/i,
    tools: ['query_calendar', 'create_event'],
  },
  habits: {
    pattern: /\b(habit|streak|exercise|meditat|workout|routine)\b/i,
    tools: ['add_habit', 'log_habit'],
  },
  mood: {
    pattern: /\b(mood|energy|feeling|feel|stress|happy|sad|tired|anxious)\b/i,
    tools: ['log_mood', 'query_mood'],
  },
  notes: {
    pattern: /\b(note|journal|diary|write|entry|wrote|save\s*this)\b/i,
    tools: ['add_note', 'query_notes'],
  },
  expenses: {
    pattern: /\b(expense|spent|spend|cost|budget|money|price|pay|paid|dollar|purchase|\$\d)\b/i,
    tools: ['log_expense', 'query_expenses', 'set_budget'],
  },
  inbox: {
    pattern: /\b(inbox|triage|capture|thought|untriage)\b/i,
    tools: ['triage_inbox'],
  },
  timeBlocks: {
    pattern: /\b(time\s*block|schedule|block\s*time|plan\s*my\s*day|morning\s*plan|organize\s*day)\b/i,
    tools: ['create_time_block', 'query_time_blocks'],
  },
  memory: {
    pattern: /\b(memory|remember|forget|memor)\b/i,
    tools: ['query_memories', 'delete_memory'],
  },
  reminders: {
    pattern: /\b(remind|reminder|alarm|notify)\b/i,
    tools: ['schedule_reminder'],
  },
};

/** Always include these tools (most common actions) */
const CORE_TOOLS = ['log_hydration', 'add_task', 'complete_task', 'query_tasks'];
const MAX_TOOLS = 12; // Keep tool count manageable for small context windows

/**
 * Build filtered tool definitions for on-device models.
 * Only includes tools relevant to the user's input + a small set of core tools.
 * System/proactive messages get a broader set.
 */
export function buildFilteredToolDefinitions(userInput: string): LlamaToolDef[] {
  const isSystem = /^\[SYSTEM:/.test(userInput);

  // System messages: include core + task + calendar + email + mood + habit tools
  if (isSystem) {
    const systemTools = new Set([
      ...CORE_TOOLS,
      ...TOOL_GROUPS.habits.tools,
      ...TOOL_GROUPS.mood.tools,
      ...TOOL_GROUPS.sleep.tools,
      ...TOOL_GROUPS.focus.tools,
      ...TOOL_GROUPS.reminders.tools,
    ]);
    return buildToolsForNames(systemTools);
  }

  // Match input against tool groups
  const matched = new Set(CORE_TOOLS);
  for (const group of Object.values(TOOL_GROUPS)) {
    if (group.pattern.test(userInput)) {
      group.tools.forEach(t => matched.add(t));
    }
  }

  // If nothing specific matched beyond core, add common action tools
  if (matched.size <= CORE_TOOLS.length) {
    ['set_focus_mode', 'log_habit', 'schedule_reminder'].forEach(t => matched.add(t));
  }

  // Cap at MAX_TOOLS
  const toolNames = [...matched].slice(0, MAX_TOOLS);
  return buildToolsForNames(new Set(toolNames));
}

/** Set of all tool names that exist in the registry (for dev-time assert). */
function getRegisteredToolNames(): Set<string> {
  const out = new Set<string>();
  toolRegistry.forEach((_tool, name) => out.add(name));
  return out;
}

function buildToolsForNames(names: Set<string>): LlamaToolDef[] {
  const registered = getRegisteredToolNames();
  const missing = [...names].filter((n) => !registered.has(n));
  if (missing.length > 0 && __DEV__) {
    console.warn(
      '[prompt] TOOL_GROUPS reference tools not in toolRegistry:',
      missing.join(', '),
    );
  }
  const validNames = new Set([...names].filter((n) => registered.has(n)));
  const defs: LlamaToolDef[] = [];
  toolRegistry.forEach((tool) => {
    if (validNames.has(tool.name)) {
      defs.push(toolToDef(tool));
    }
  });
  return defs;
}

// ── Compressed prompts with KV cache optimization ──────────
// Split into STATIC (cacheable by llama.cpp KV cache) + DYNAMIC (changes per call).
// When the static part is identical across calls, llama.cpp reuses the cached
// KV state, skipping ~300+ tokens of re-processing (~2-3s faster).

/** Static instructions for fast model — NEVER changes → auto-cached by llama.cpp */
const FAST_STATIC = `You are PicoClaw, an autonomous life agent in LifeOS. You don't just respond — you manage the user's life. Be concise (1-3 sentences), warm, casual.
Rules: respond naturally to chat. Reference user's state, goals, and patterns when relevant. If user mentions a goal, encourage progress. You CANNOT perform actions — just chat. Never output JSON.`;

/** Static instructions for heavy model — NEVER changes → auto-cached by llama.cpp */
const HEAVY_STATIC = `You are PicoClaw, an autonomous life agent in LifeOS. You proactively manage the user's life. Casual, warm, concise.

Rules:
- ACTION requests → call the function(s). Multiple OK. Chain related actions.
- INFO requests → answer from CONTEXT. Never say "hold a moment".
- GOAL-related → reference active goals and progress. Frame actions in goal context.
- Emails → brief prose summary (2-4 sentences), not bullet lists.
- Chat → respond naturally, reference context, goals, and learned patterns.
- Concise: 1-3 sentences for actions. Defaults: water→250ml, priority→medium.
- Compound requests → call all relevant functions in one turn.
- AMBIGUOUS requests → output [CLARIFY: what you need to know] instead of guessing wrong.

Reasoning: Before calling tools, output a short [PLAN] tag to show your thinking:
[PLAN: action=log_hydration, amount_ml=500, goal progress=60%]
Then call the tool(s). After results, respond naturally. The [PLAN] tag is stripped from display.

Examples:
1. "log 500ml water" → [PLAN: log_hydration(amount_ml:500)] → call tool → "Logged 500ml — you're at 1500/2500ml (60%) today."
2. "I want to drink 3L daily" → This is a GOAL → "Goal set: Drink 3000ml daily. I'll track your progress and remind you."
3. "add task groceries and log $50 food" → [PLAN: add_task + log_expense] → call both → "Added grocery task and logged $50 for food."
4. "remind me later" → [CLARIFY: When should I remind you? Give me a time like 3pm or "in 2 hours"]
5. "how's my day going?" → Read CONTEXT (tasks, hydration, calendar) → summarize naturally.
6. If tool fails → explain: "Couldn't find that task. Can you give me the exact title?"
7. "log water" (with hydration goal in context) → [PLAN: log_hydration(250), goal=3000ml] → call tool → "Logged 250ml — 58% of your 3L goal, on pace."
8. "plan my day" → [PLAN: read calendar+tasks, create time blocks] → call create_event/add_task → summarize plan in 2-3 sentences.

Multi-turn: max 5 turns. For complex requests, break them into steps — call one tool, observe the result, then decide the next action. Synthesize a natural response when done.

Memory: if user states a preference, add [REMEMBER: fact] tag (parsed out, not shown).

[SYSTEM:] prefixed inputs are automated. Never echo these tags.`;

// ── Domain-specific prompt sections ─────────────────
// Appended dynamically based on detected intent/domain.

const DOMAIN_PROMPTS: Record<string, string> = {
  goal: `
Goal context: The user is setting or discussing a goal. Help them make it SMART (Specific, Measurable, Achievable, Relevant, Time-bound). If the goal is vague, suggest measurable targets. Reference existing goals to avoid duplicates.`,

  morning: `
Morning briefing: Be cheerful and energizing. Prioritize: 1) calendar events, 2) high-priority tasks, 3) goal progress. End with one motivational nudge based on patterns.`,

  evening: `
Evening reflection: Summarize accomplishments warmly. Mention: tasks completed, goals progressed, streaks maintained. If something was missed, frame it as "tomorrow's opportunity" not a failure.`,

  email: `
Email context: Categorize emails as: important (needs reply today), action_needed (has a deadline), FYI, or newsletter. Summarize in 2-3 sentences of prose, not bullet lists. Extract any actionable tasks.`,

  planning: `
Planning context: Consider the user's energy patterns, existing calendar events, and task priorities. Schedule high-priority work during focus hours. Don't overload — leave buffer time. Reference learned patterns about their typical day.`,

  finance: `
Finance context: When logging expenses, relate to budget limits. When asked about spending, compare to daily/monthly averages from patterns. Flag unusual amounts. Be matter-of-fact, not judgmental.`,
};

/**
 * Build a domain-specific prompt section based on input context.
 * Returns empty string if no specific domain applies.
 */
export function buildDomainPromptSection(userInput: string): string {
  const sections: string[] = [];

  if (/\b(goal|target|aim|want to|help me|commit|challenge)\b/i.test(userInput)) {
    sections.push(DOMAIN_PROMPTS.goal);
  }
  if (/\[SYSTEM:\s*MORNING/i.test(userInput)) {
    sections.push(DOMAIN_PROMPTS.morning);
  }
  if (/\[SYSTEM:\s*EVENING/i.test(userInput)) {
    sections.push(DOMAIN_PROMPTS.evening);
  }
  if (/\b(email|mail|inbox|gmail)\b/i.test(userInput)) {
    sections.push(DOMAIN_PROMPTS.email);
  }
  if (/\b(plan\s+my\s+day|organize|schedule|time\s*block)\b/i.test(userInput)) {
    sections.push(DOMAIN_PROMPTS.planning);
  }
  if (/\b(expense|budget|spend|cost|money|pay|\$\d)\b/i.test(userInput)) {
    sections.push(DOMAIN_PROMPTS.finance);
  }

  return sections.join('');
}

/**
 * Fast (0.5B) system prompt. Static part cached, context appended.
 */
export function buildFastSystemPrompt(contextJson: string): string {
  return `${FAST_STATIC}\n\nCONTEXT:\n${contextJson}`;
}

/**
 * Heavy (3B) system prompt. Static part cached, context + domain prompt appended.
 */
export function buildSystemPrompt(contextJson: string, userInput?: string): string {
  const domain = userInput ? buildDomainPromptSection(userInput) : '';
  return `${HEAVY_STATIC}${domain}\n\nCONTEXT:\n${contextJson}`;
}

/**
 * Static-only system prompt for KV cache pre-warming.
 */
export function getStaticSystemPrompt(model: 'fast' | 'heavy'): string {
  return model === 'fast' ? FAST_STATIC : HEAVY_STATIC;
}
