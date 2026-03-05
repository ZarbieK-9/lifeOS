// PicoClaw Agent — Intent Engine
// Uses json-rules-engine to match extracted facts to tool calls

import { Engine } from 'json-rules-engine';
import type { InputFacts, MatchedIntent } from './types';
import { extractTaskTitle, extractSnippetContent, extractEventSummary, extractTimeFromText } from './facts';

/** Create and configure the rules engine with all intent rules */
export function createEngine(): Engine {
  const engine = new Engine([], { allowUndefinedFacts: true });

  // ── Hydration: set reminder schedule ──
  engine.addRule({
    name: 'set_hydration_reminder',
    priority: 18,
    conditions: {
      all: [
        { fact: 'kw_hydration', operator: 'equal', value: true },
        { fact: 'kw_schedule', operator: 'equal', value: true },
        { fact: 'kw_disable', operator: 'equal', value: false },
      ],
    },
    event: { type: 'set_hydration_reminder' },
  });

  // ── Hydration: disable reminder ──
  engine.addRule({
    name: 'disable_hydration_reminder',
    priority: 18,
    conditions: {
      all: [
        { fact: 'kw_hydration', operator: 'equal', value: true },
        { fact: 'kw_disable', operator: 'equal', value: true },
        { fact: 'kw_schedule', operator: 'equal', value: true },
      ],
    },
    event: { type: 'disable_hydration_reminder' },
  });

  // ── Hydration: log ──
  engine.addRule({
    name: 'log_hydration',
    priority: 10,
    conditions: {
      all: [
        { fact: 'kw_hydration', operator: 'equal', value: true },
        { fact: 'kw_query', operator: 'equal', value: false },
        { fact: 'kw_schedule', operator: 'equal', value: false },
        { fact: 'kw_settings', operator: 'equal', value: false },
      ],
    },
    event: { type: 'log_hydration' },
  });

  // ── Hydration: query ──
  engine.addRule({
    name: 'query_hydration',
    priority: 15,
    conditions: {
      all: [
        { fact: 'kw_query', operator: 'equal', value: true },
        { fact: 'kw_hydration', operator: 'equal', value: true },
      ],
    },
    event: { type: 'query_hydration' },
  });

  // ── Task: add ──
  engine.addRule({
    name: 'add_task',
    priority: 10,
    conditions: {
      all: [
        { fact: 'kw_task', operator: 'equal', value: true },
        { fact: 'kw_complete', operator: 'equal', value: false },
        { fact: 'kw_delete', operator: 'equal', value: false },
        { fact: 'kw_query', operator: 'equal', value: false },
        { fact: 'kw_remind', operator: 'equal', value: false },
      ],
    },
    event: { type: 'add_task' },
  });

  // ── Task: complete ──
  engine.addRule({
    name: 'complete_task',
    priority: 12,
    conditions: {
      all: [
        { fact: 'kw_complete', operator: 'equal', value: true },
      ],
    },
    event: { type: 'complete_task' },
  });

  // ── Task: delete ──
  engine.addRule({
    name: 'delete_task',
    priority: 12,
    conditions: {
      all: [
        { fact: 'kw_delete', operator: 'equal', value: true },
        { fact: 'kw_task', operator: 'equal', value: true },
      ],
    },
    event: { type: 'delete_task' },
  });

  // ── Task: query ──
  engine.addRule({
    name: 'query_tasks',
    priority: 15,
    conditions: {
      all: [
        { fact: 'kw_query', operator: 'equal', value: true },
        { fact: 'kw_task', operator: 'equal', value: true },
      ],
    },
    event: { type: 'query_tasks' },
  });

  // ── Focus: enable ──
  engine.addRule({
    name: 'enable_focus',
    priority: 10,
    conditions: {
      all: [
        { fact: 'kw_focus', operator: 'equal', value: true },
        { fact: 'kw_disable', operator: 'equal', value: false },
      ],
    },
    event: { type: 'set_focus_mode', params: { enabled: true } },
  });

  // ── Focus: disable ──
  engine.addRule({
    name: 'disable_focus',
    priority: 12,
    conditions: {
      all: [
        { fact: 'kw_focus', operator: 'equal', value: true },
        { fact: 'kw_disable', operator: 'equal', value: true },
      ],
    },
    event: { type: 'set_focus_mode', params: { enabled: false } },
  });

  // ── Partner: send snippet ──
  engine.addRule({
    name: 'send_snippet',
    priority: 10,
    conditions: {
      all: [
        { fact: 'kw_partner', operator: 'equal', value: true },
        { fact: 'kw_email', operator: 'equal', value: false },
        { fact: 'kw_query', operator: 'equal', value: false },
      ],
    },
    event: { type: 'send_snippet' },
  });

  // ── Status query (general) ──
  engine.addRule({
    name: 'query_status',
    priority: 5,
    conditions: {
      all: [
        { fact: 'kw_status', operator: 'equal', value: true },
      ],
    },
    event: { type: 'query_status' },
  });

  // ── Calendar: query ──
  engine.addRule({
    name: 'query_calendar',
    priority: 15,
    conditions: {
      all: [
        { fact: 'kw_calendar', operator: 'equal', value: true },
        { fact: 'kw_query', operator: 'equal', value: true },
      ],
    },
    event: { type: 'query_calendar' },
  });

  // ── Calendar: create event ──
  engine.addRule({
    name: 'create_event',
    priority: 10,
    conditions: {
      all: [
        { fact: 'kw_calendar', operator: 'equal', value: true },
        { fact: 'kw_query', operator: 'equal', value: false },
      ],
    },
    event: { type: 'create_event' },
  });

  // ── Email: query ──
  engine.addRule({
    name: 'query_emails',
    priority: 15,
    conditions: {
      all: [
        { fact: 'kw_email', operator: 'equal', value: true },
        { fact: 'kw_triage', operator: 'equal', value: false },
        { fact: 'kw_extract', operator: 'equal', value: false },
      ],
    },
    event: { type: 'query_emails' },
  });

  // ── Email: triage ──
  engine.addRule({
    name: 'triage_emails',
    priority: 16,
    conditions: {
      all: [
        { fact: 'kw_triage', operator: 'equal', value: true },
      ],
    },
    event: { type: 'triage_emails' },
  });

  // ── Email: extract tasks ──
  engine.addRule({
    name: 'extract_tasks_from_email',
    priority: 16,
    conditions: {
      all: [
        { fact: 'kw_extract', operator: 'equal', value: true },
      ],
    },
    event: { type: 'extract_tasks_from_email' },
  });

  // ── API Key: create ──
  engine.addRule({
    name: 'create_api_key',
    priority: 10,
    conditions: {
      all: [
        { fact: 'kw_apikey', operator: 'equal', value: true },
        { fact: 'kw_query', operator: 'equal', value: false },
        { fact: 'kw_delete', operator: 'equal', value: false },
      ],
    },
    event: { type: 'create_api_key' },
  });

  // ── API Key: list ──
  engine.addRule({
    name: 'list_api_keys',
    priority: 15,
    conditions: {
      all: [
        { fact: 'kw_apikey', operator: 'equal', value: true },
        { fact: 'kw_query', operator: 'equal', value: true },
      ],
    },
    event: { type: 'list_api_keys' },
  });

  // ── API Key: revoke ──
  engine.addRule({
    name: 'revoke_api_key',
    priority: 12,
    conditions: {
      all: [
        { fact: 'kw_apikey', operator: 'equal', value: true },
        { fact: 'kw_delete', operator: 'equal', value: true },
      ],
    },
    event: { type: 'revoke_api_key' },
  });

  // ── Sleep: log ──
  engine.addRule({
    name: 'log_sleep',
    priority: 10,
    conditions: {
      all: [
        { fact: 'kw_sleep', operator: 'equal', value: true },
        { fact: 'kw_query', operator: 'equal', value: false },
      ],
      any: [
        { fact: 'kw_log', operator: 'equal', value: true },
        { fact: 'kw_enable', operator: 'equal', value: true },
        { fact: 'kw_disable', operator: 'equal', value: true },
      ],
    },
    event: { type: 'log_sleep' },
  });

  // ── Sleep: query ──
  engine.addRule({
    name: 'query_sleep',
    priority: 15,
    conditions: {
      all: [
        { fact: 'kw_sleep', operator: 'equal', value: true },
        { fact: 'kw_query', operator: 'equal', value: true },
      ],
    },
    event: { type: 'query_sleep' },
  });

  // ── Settings: update ──
  engine.addRule({
    name: 'update_setting',
    priority: 16,
    conditions: {
      all: [
        { fact: 'kw_settings', operator: 'equal', value: true },
      ],
    },
    event: { type: 'update_setting' },
  });

  // ── Reminder: schedule ──
  engine.addRule({
    name: 'schedule_reminder',
    priority: 14,
    conditions: {
      all: [
        { fact: 'kw_remind', operator: 'equal', value: true },
      ],
    },
    event: { type: 'schedule_reminder' },
  });

  // ── Automation: create rule from chat ──
  engine.addRule({
    name: 'create_automation_rule',
    priority: 10,
    conditions: {
      all: [
        { fact: 'kw_automation', operator: 'equal', value: true },
      ],
    },
    event: { type: 'create_automation_rule' },
  });

  // ── Webhook: show info ──
  engine.addRule({
    name: 'show_webhook_info',
    priority: 8,
    conditions: {
      all: [
        { fact: 'kw_webhook', operator: 'equal', value: true },
        { fact: 'kw_apikey', operator: 'equal', value: false },
      ],
    },
    event: { type: 'show_webhook_info' },
  });

  return engine;
}

/** Run the engine against extracted facts and return matched intents with resolved params */
export async function matchIntents(
  engine: Engine,
  facts: InputFacts
): Promise<MatchedIntent[]> {
  // Run the rules engine with all facts
  const factsRecord: Record<string, unknown> = { ...facts };
  const { events } = await engine.run(factsRecord);

  if (events.length === 0) return [];

  // Convert events to intents with extracted params
  const intents: MatchedIntent[] = [];

  for (const event of events) {
    const intent = resolveParams(event.type, event.params ?? {}, facts);
    if (intent) intents.push(intent);
  }

  // Sort by priority (higher first)
  intents.sort((a, b) => b.priority - a.priority);

  return intents;
}

/** Resolve tool parameters from facts based on intent type */
function resolveParams(
  toolName: string,
  eventParams: Record<string, unknown>,
  facts: InputFacts
): MatchedIntent | null {
  switch (toolName) {
    case 'log_hydration':
      return {
        tool: 'log_hydration',
        params: { amount_ml: facts.has_amount_ml ?? 250 },
        priority: 10,
      };

    case 'add_task':
      return {
        tool: 'add_task',
        params: {
          title: extractTaskTitle(facts.raw),
          priority: facts.has_priority ?? 'medium',
          dueDate: facts.has_date,
          recurrence: facts.has_recurrence ?? null,
        },
        priority: 10,
      };

    case 'complete_task': {
      // Extract what to complete by stripping command words
      const title = facts.raw
        .replace(/^(mark\s+)?(done|complete|finish|check\s+off)\s+(with\s+)?/i, '')
        .replace(/^(mark\s+)?task\s*/i, '')
        .trim() || facts.raw;
      return {
        tool: 'complete_task',
        params: { title_match: title },
        priority: 12,
      };
    }

    case 'delete_task': {
      const title = facts.raw
        .replace(/^(delete|remove|cancel)\s+(the\s+)?task\s*/i, '')
        .trim() || facts.raw;
      return {
        tool: 'delete_task',
        params: { title_match: title },
        priority: 12,
      };
    }

    case 'set_focus_mode':
      return {
        tool: 'set_focus_mode',
        params: {
          enabled: eventParams.enabled ?? true,
          durationMin: facts.has_duration_min ?? 45,
        },
        priority: (eventParams.enabled === false) ? 12 : 10,
      };

    case 'send_snippet':
      return {
        tool: 'send_snippet',
        params: { content: extractSnippetContent(facts.raw) },
        priority: 10,
      };

    case 'query_status':
      return {
        tool: 'query_status',
        params: {},
        priority: 5,
      };

    case 'query_tasks':
      return {
        tool: 'query_tasks',
        params: {
          filter: facts.lower.includes('completed') || facts.lower.includes('done')
            ? 'completed'
            : facts.lower.includes('overdue')
            ? 'overdue'
            : facts.lower.includes('all')
            ? 'all'
            : 'pending',
        },
        priority: 15,
      };

    case 'query_hydration':
      return {
        tool: 'query_hydration',
        params: {},
        priority: 15,
      };

    case 'query_calendar': {
      const range = facts.lower.includes('week') ? 'week'
        : facts.lower.includes('tomorrow') ? 'tomorrow'
        : 'today';
      return {
        tool: 'query_calendar',
        params: { range },
        priority: 15,
      };
    }

    case 'create_event': {
      const summary = extractEventSummary(facts.raw);
      const time = extractTimeFromText(facts.raw);
      return {
        tool: 'create_event',
        params: {
          summary,
          hour: time?.hour ?? null,
          minute: time?.minute ?? null,
          tomorrow: facts.lower.includes('tomorrow'),
        },
        priority: 10,
      };
    }

    case 'query_emails': {
      const filter = facts.lower.includes('important') ? 'important'
        : facts.lower.includes('action') ? 'action_needed'
        : facts.lower.includes('newsletter') ? 'newsletter'
        : 'unread';
      return {
        tool: 'query_emails',
        params: { filter },
        priority: 15,
      };
    }

    case 'triage_emails':
      return {
        tool: 'triage_emails',
        params: {},
        priority: 16,
      };

    case 'extract_tasks_from_email':
      return {
        tool: 'extract_tasks_from_email',
        params: {},
        priority: 16,
      };

    case 'set_hydration_reminder': {
      const timeRange = facts.has_time_range ?? { startHour: 8, endHour: 22 };
      const goalLiters = facts.has_goal_liters;
      const goalMl = goalLiters ? Math.round(goalLiters * 1000) : (facts.has_amount_ml ?? 2500);
      return {
        tool: 'set_hydration_reminder',
        params: {
          startHour: timeRange.startHour,
          endHour: timeRange.endHour,
          goalMl,
        },
        priority: 18,
      };
    }

    case 'disable_hydration_reminder':
      return {
        tool: 'disable_hydration_reminder',
        params: {},
        priority: 18,
      };

    case 'create_api_key': {
      // Extract key name from input by stripping command words
      const keyName = facts.raw
        .replace(/^(generate|create|make|new|add)\s+(an?\s+)?(?:api[- ]?key|webhook|integration)\s*/i, '')
        .replace(/\s+(for|named|called)\s+/i, '')
        .trim() || 'default';
      return {
        tool: 'create_api_key',
        params: { name: keyName },
        priority: 10,
      };
    }

    case 'list_api_keys':
      return {
        tool: 'list_api_keys',
        params: {},
        priority: 15,
      };

    case 'revoke_api_key': {
      const name = facts.raw
        .replace(/^(revoke|delete|remove)\s+(the\s+)?(?:api[- ]?key|key)\s*/i, '')
        .trim() || '';
      return {
        tool: 'revoke_api_key',
        params: { name_match: name },
        priority: 12,
      };
    }

    case 'log_sleep':
      return {
        tool: 'log_sleep',
        params: {
          action: facts.kw_enable ? 'start' : facts.kw_disable ? 'stop' : 'log',
          time: facts.has_sleep_time ?? null,
        },
        priority: 10,
      };

    case 'query_sleep': {
      const period = facts.lower.includes('week') ? 'week' : 'today';
      return {
        tool: 'query_sleep',
        params: { period },
        priority: 15,
      };
    }

    case 'update_setting': {
      // Determine which setting to update
      let setting: string = 'unknown';
      let value: unknown = null;
      if (facts.kw_hydration && facts.has_goal_liters) {
        setting = 'hydration_goal';
        value = Math.round(facts.has_goal_liters * 1000);
      } else if (facts.kw_focus && facts.has_duration_min) {
        setting = 'focus_duration';
        value = facts.has_duration_min;
      } else if (facts.kw_hydration) {
        setting = 'hydration_goal';
        value = facts.has_amount_ml;
      }
      return {
        tool: 'update_setting',
        params: { setting, value },
        priority: 16,
      };
    }

    case 'schedule_reminder': {
      const reminderTime = extractTimeFromText(facts.raw);
      return {
        tool: 'schedule_reminder',
        params: {
          text: facts.has_reminder_text ?? facts.raw,
          hour: reminderTime?.hour ?? null,
          minute: reminderTime?.minute ?? 0,
        },
        priority: 14,
      };
    }

    case 'create_automation_rule':
      return {
        tool: 'create_automation_rule',
        params: { raw: facts.raw },
        priority: 10,
      };

    case 'show_webhook_info':
      return {
        tool: 'show_webhook_info',
        params: {},
        priority: 8,
      };

    default:
      return null;
  }
}
