// PicoClaw Agent — Compound Routines
// Pre-built and user-defined multi-step command sequences

import type { Routine, RoutineStep } from './types';

/** Check if input matches any routine trigger phrase */
export function matchRoutine(input: string, routines: Routine[]): Routine | null {
  const lower = input.toLowerCase();
  for (const routine of routines) {
    if (!routine.enabled) continue;
    for (const phrase of routine.triggerPhrases) {
      if (lower.includes(phrase.toLowerCase())) {
        return routine;
      }
    }
  }
  return null;
}

/** Pre-built routines — always available */
export const builtinRoutines: Routine[] = [
  {
    id: 'builtin_morning',
    name: 'Morning Routine',
    triggerPhrases: ['morning routine', 'start my day', 'good morning'],
    steps: [
      { tool: 'log_hydration', params: { amount_ml: 250 } },
      { tool: 'query_calendar', params: { range: 'today' } },
      { tool: 'query_emails', params: { filter: 'important' } },
      { tool: 'query_tasks', params: { filter: 'pending' } },
      { tool: 'set_focus_mode', params: { enabled: true, durationMin: 45 } },
    ],
    enabled: true,
    createdAt: '',
  },
  {
    id: 'builtin_night',
    name: 'Night Routine',
    triggerPhrases: ['night routine', 'going to bed', 'good night', 'bedtime'],
    steps: [
      { tool: 'set_focus_mode', params: { enabled: false } },
      { tool: 'query_status', params: {} },
    ],
    enabled: true,
    createdAt: '',
  },
  {
    id: 'builtin_daily_summary',
    name: 'Daily Summary',
    triggerPhrases: ['daily summary', "how's my day", 'day summary', 'my progress'],
    steps: [
      { tool: 'query_calendar', params: { range: 'today' } },
      { tool: 'query_emails', params: { filter: 'unread' } },
      { tool: 'query_hydration', params: {} },
      { tool: 'query_tasks', params: { filter: 'pending' } },
      { tool: 'query_status', params: {} },
    ],
    enabled: true,
    createdAt: '',
  },
];

/** Parse a routine from SQLite row */
export function parseRoutineRow(row: {
  id: string;
  name: string;
  trigger_phrases: string;
  steps: string;
  enabled: number;
  created_at: string;
}): Routine {
  return {
    id: row.id,
    name: row.name,
    triggerPhrases: JSON.parse(row.trigger_phrases) as string[],
    steps: JSON.parse(row.steps) as RoutineStep[],
    enabled: !!row.enabled,
    createdAt: row.created_at,
  };
}
