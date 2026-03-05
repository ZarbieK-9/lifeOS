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
    properties[name] = { type: schema.type, description: schema.description };
    if (schema.required) required.push(name);
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

/** Tool groups mapped to keyword patterns */
const TOOL_GROUPS: Record<string, { pattern: RegExp; tools: string[] }> = {
  hydration: {
    pattern: /\b(water|hydrat|drink|ml|thirst|sip)\b/i,
    tools: ['log_hydration', 'set_hydration_goal', 'set_hydration_reminder'],
  },
  tasks: {
    pattern: /\b(task|todo|to-?do|add|create|delete|remove|complete|done|pending|finish|list)\b/i,
    tools: ['add_task', 'complete_task', 'delete_task', 'edit_task', 'query_tasks'],
  },
  sleep: {
    pattern: /\b(sleep|wake|nap|bed|rest)\b/i,
    tools: ['start_sleep', 'stop_sleep'],
  },
  focus: {
    pattern: /\b(focus|timer|pomodoro|concentrate|deep\s*work)\b/i,
    tools: ['start_focus', 'stop_focus'],
  },
  email: {
    pattern: /\b(email|mail|send|reply|respond|gmail)\b/i,
    tools: ['send_email'],
  },
  calendar: {
    pattern: /\b(calendar|schedule|event|meeting|sync|google)\b/i,
    tools: ['sync_google'],
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
    tools: ['set_reminder'],
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
    ['start_focus', 'stop_focus', 'log_habit', 'set_reminder'].forEach(t => matched.add(t));
  }

  // Cap at MAX_TOOLS
  const toolNames = [...matched].slice(0, MAX_TOOLS);
  return buildToolsForNames(new Set(toolNames));
}

function buildToolsForNames(names: Set<string>): LlamaToolDef[] {
  const defs: LlamaToolDef[] = [];
  toolRegistry.forEach((tool) => {
    if (names.has(tool.name)) {
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
const FAST_STATIC = `You are PicoClaw, a friendly life assistant in LifeOS. Be concise (1-3 sentences), warm, casual.
Rules: respond naturally to chat. Reference user's state when relevant. You CANNOT perform actions — just chat. Never output JSON.`;

/** Static instructions for heavy model — NEVER changes → auto-cached by llama.cpp */
const HEAVY_STATIC = `You are PicoClaw, a friendly local life assistant in LifeOS. Casual, warm, concise.

Rules:
- ACTION requests → call the function(s). Multiple OK.
- INFO requests → answer from CONTEXT. Never say "hold a moment".
- Emails → brief prose summary (2-4 sentences), not bullet lists.
- Chat → respond naturally, reference context.
- Concise: 1-3 sentences for actions. Defaults: water→250ml, priority→medium.
- Compound requests → call all relevant functions.

Multi-turn: max 3 turns. Call multiple functions per turn. Then synthesize a natural response.

Memory: if user states a preference, add [REMEMBER: fact] tag (parsed out, not shown).

[SYSTEM:] prefixed inputs are automated: MORNING BRIEFING, CHECK-IN, EVENING REFLECTION, CALENDAR ALERT, NEW EMAILS, APP NOTIFICATION. Never echo these tags.`;

/**
 * Fast (0.5B) system prompt. Static part cached, context appended.
 */
export function buildFastSystemPrompt(contextJson: string): string {
  return `${FAST_STATIC}\n\nCONTEXT:\n${contextJson}`;
}

/**
 * Heavy (3B) system prompt. Static part cached, context appended.
 */
export function buildSystemPrompt(contextJson: string): string {
  return `${HEAVY_STATIC}\n\nCONTEXT:\n${contextJson}`;
}

/**
 * Static-only system prompt for KV cache pre-warming.
 */
export function getStaticSystemPrompt(model: 'fast' | 'heavy'): string {
  return model === 'fast' ? FAST_STATIC : HEAVY_STATIC;
}
