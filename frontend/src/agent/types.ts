// PicoClaw Agent — type definitions
// Rule-based intent matching with json-rules-engine, no LLM required

/** Result returned by every tool executor */
export interface ToolResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/** Tool definition in the registry */
export interface Tool {
  name: string;
  description: string;
  /** Parameter schema — keys are param names, values describe the param */
  params: Record<string, ParamSchema>;
  /** Async executor — receives extracted params, returns result */
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ParamSchema {
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  description?: string;
}

/** Facts extracted from user input for the rules engine */
export interface InputFacts {
  raw: string;
  lower: string;
  tokens: string[];
  numbers: number[];
  has_amount_ml: number | null;
  has_duration_min: number | null;
  has_priority: 'low' | 'medium' | 'high' | null;
  has_date: string | null;

  // Keyword groups
  kw_hydration: boolean;
  kw_task: boolean;
  kw_focus: boolean;
  kw_partner: boolean;
  kw_sleep: boolean;
  kw_status: boolean;
  kw_complete: boolean;
  kw_delete: boolean;
  kw_enable: boolean;
  kw_disable: boolean;
  kw_routine: boolean;
  kw_query: boolean;
  kw_log: boolean;

  // Google integration
  kw_calendar: boolean;
  kw_email: boolean;
  kw_triage: boolean;
  kw_extract: boolean;

  // API keys
  kw_apikey: boolean;

  // Hydration reminders
  kw_schedule: boolean;
  has_time_range: { startHour: number; endHour: number } | null;
  has_goal_liters: number | null;

  // Sleep logging
  has_sleep_time: string | null;

  // Reminders
  kw_remind: boolean;
  has_reminder_text: string | null;

  // Settings
  kw_settings: boolean;

  // Recurring tasks
  has_recurrence: string | null;

  // Automation from chat
  kw_automation: boolean;

  // Webhook info
  kw_webhook: boolean;
}

/** Sleep session record */
export interface SleepSession {
  session_id: string;
  sleep_start: string;
  sleep_end: string | null;
  duration_minutes: number;
}

/** Push notification reminder */
export interface Reminder {
  reminder_id: string;
  text: string;
  trigger_at: string;
  fired: boolean;
  created_at: string;
}

/** A matched intent from the rules engine */
export interface MatchedIntent {
  tool: string;
  params: Record<string, unknown>;
  priority: number;
}

/** A step in a compound routine */
export interface RoutineStep {
  tool: string;
  params: Record<string, unknown>;
}

/** Pre-built or user-defined routine */
export interface Routine {
  id: string;
  name: string;
  triggerPhrases: string[];
  steps: RoutineStep[];
  enabled: boolean;
  createdAt: string;
}

/** Automation rule (schedule or condition-based) */
export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  ruleType: 'schedule' | 'condition';
  schedule: string | null;     // cron expression for schedule type
  condition: string | null;    // JSON rules-engine condition
  actions: RoutineStep[];
  enabled: boolean;
  lastTriggered: string | null;
  createdAt: string;
}

/** Overall agent response after processing input */
export interface AgentResponse {
  input: string;
  intents: MatchedIntent[];
  results: ToolResult[];
  output: string;              // Human-readable combined output
}
