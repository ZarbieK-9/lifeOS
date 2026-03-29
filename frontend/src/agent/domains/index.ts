// PicoClaw Agent — Domain Agent Interface & Registry
// Each domain agent owns a slice of the user's life and operates autonomously.
// Agents use deterministic logic for monitoring/assessment and LLM only for planning/NL responses.

import type { AgentEvent } from '../eventBus';
import type { AgentInsight, GoalDomain, PlanStep, ToolResult } from '../types';

/** Interface every domain agent must implement. */
export interface DomainAgent {
  /** Unique agent name (e.g. 'health', 'productivity') */
  readonly name: string;
  /** Which domain this agent owns */
  readonly domain: GoalDomain;
  /** Tools this agent is responsible for */
  readonly ownedTools: string[];

  /** Analyze current state and return actionable insights (deterministic, no LLM). */
  assess(): Promise<AgentInsight[]>;

  /** Execute a plan step that belongs to this domain. */
  execute(step: PlanStep): Promise<ToolResult>;

  /** React to an event from the bus (fire-and-forget). */
  onEvent(event: AgentEvent): Promise<void>;

  /** Generate this domain's section for the daily briefing (short text). */
  briefing(): Promise<string>;
}

// ── Registry ──────────────────────────────────────

import { healthAgent } from './health';
import { productivityAgent } from './productivity';
import { financeAgent } from './finance';
import { socialAgent } from './social';

/** All registered domain agents. */
export const domainAgents: DomainAgent[] = [
  healthAgent,
  productivityAgent,
  financeAgent,
  socialAgent,
];

/** Map of tool name → domain agent that owns it. */
const toolOwnerMap = new Map<string, DomainAgent>();
for (const agent of domainAgents) {
  for (const tool of agent.ownedTools) {
    toolOwnerMap.set(tool, agent);
  }
}

/** Get the domain agent responsible for a given tool. */
export function getAgentForTool(toolName: string): DomainAgent | undefined {
  return toolOwnerMap.get(toolName);
}

/** Get the domain agent by domain name. */
export function getAgentByDomain(domain: GoalDomain): DomainAgent | undefined {
  return domainAgents.find((a) => a.domain === domain);
}

/** Run assess() on all agents, collect insights. */
export async function assessAll(): Promise<AgentInsight[]> {
  const results = await Promise.all(
    domainAgents.map((a) => a.assess().catch((e) => {
      console.warn(`[${a.name}] assess error:`, e);
      return [] as AgentInsight[];
    })),
  );
  return results.flat();
}

/** Check for conflicts between active goals across domains. */
export function assessCrossDomain(): AgentInsight[] {
  const { useStore } = require('../../store/useStore');
  const state = useStore.getState();
  const goals = state.goals.filter((g: any) => g.status === 'active');
  const insights: AgentInsight[] = [];

  // Sleep goal vs late-night task deadlines
  const sleepGoal = goals.find((g: any) => g.domain === 'health' && /sleep/i.test(g.title));
  if (sleepGoal) {
    const lateTasks = state.tasks.filter((t: any) => {
      if (t.status !== 'pending' || !t.due_date) return false;
      const dueHour = new Date(t.due_date).getHours();
      return dueHour >= 22 || dueHour <= 5;
    });
    if (lateTasks.length > 0) {
      insights.push({
        domain: 'health',
        priority: 'low',
        title: 'Goal conflict: sleep vs deadlines',
        body: `Your sleep goal may conflict with ${lateTasks.length} task(s) due late at night. Consider rescheduling.`,
      });
    }
  }

  // Spending goal vs recent spending velocity
  const savingGoal = goals.find((g: any) => g.domain === 'finance');
  if (savingGoal && state.todaySpend > 0) {
    const spendingPattern = state.patterns.find((p: any) => p.description === 'spending_habits');
    if (spendingPattern) {
      const avg = (spendingPattern.data as any).avgDaily ?? 0;
      if (avg > 0 && state.todaySpend > avg * 1.5) {
        insights.push({
          domain: 'finance',
          priority: 'low',
          title: 'Goal conflict: saving vs spending',
          body: `Today's spending ($${state.todaySpend.toFixed(2)}) is above your average. This may impact your "${savingGoal.title}" goal.`,
        });
      }
    }
  }

  // Focus goal vs meeting-heavy calendar
  const focusGoal = goals.find((g: any) => g.domain === 'productivity' && /focus|deep\s*work/i.test(g.title));
  if (focusGoal) {
    const todayEvents = state.calendarEvents.filter((e: any) => {
      const d = require('dayjs');
      return d.default(e.start_time).isSame(d.default(), 'day');
    });
    if (todayEvents.length >= 5) {
      insights.push({
        domain: 'productivity',
        priority: 'low',
        title: 'Goal conflict: focus vs meetings',
        body: `${todayEvents.length} events today may limit focus time for your "${focusGoal.title}" goal.`,
      });
    }
  }

  return insights;
}

/** Generate a combined briefing from all agents. */
export async function generateBriefing(): Promise<string> {
  const sections = await Promise.all(
    domainAgents.map(async (a) => {
      try {
        const s = await a.briefing();
        return s ? `**${a.name.charAt(0).toUpperCase() + a.name.slice(1)}:** ${s}` : '';
      } catch {
        return '';
      }
    }),
  );
  return sections.filter(Boolean).join('\n');
}
