// PicoClaw — Finance Domain Agent (spending awareness coaching, not budget nagging)

import dayjs from 'dayjs';
import type { AgentEvent } from '../eventBus';
import { eventBus } from '../eventBus';
import type { AgentInsight, PlanStep, ToolResult } from '../types';
import type { DomainAgent } from './index';
import { toolRegistry } from '../tools';
import { useStore } from '../../store/useStore';

export const financeAgent: DomainAgent = {
  name: 'finance',
  domain: 'finance',
  ownedTools: ['log_expense', 'query_expenses', 'set_budget'],

  async assess(): Promise<AgentInsight[]> {
    const insights: AgentInsight[] = [];
    const state = useStore.getState();
    const now = dayjs();

    const spendingPattern = state.patterns.find((p) => p.description === 'spending_habits');
    const avgDaily = spendingPattern ? ((spendingPattern.data as { avgDaily?: number }).avgDaily ?? 0) : 0;
    const todaySpend = state.todaySpend;

    if (avgDaily > 0 && todaySpend > 0) {
      const ratio = todaySpend / avgDaily;
      if (ratio > 1.2) {
        insights.push({
          domain: 'finance',
          priority: ratio > 2.5 ? 'high' : 'low',
          title: 'Spending awareness',
          body: `That's $${todaySpend.toFixed(2)} today — your average is ~$${avgDaily.toFixed(2)}. Mindful or intentional?`,
          coachingWhy: 'Noticing spend without judgment helps align money with what matters.',
          coachingTip: ratio > 2 ? 'If it was planned, great. If not, tomorrow is a fresh reset.' : 'Small check-ins beat surprise totals at month-end.',
        });
      }
    }

    // Weekly awareness (Mondays): this week spend vs patterns
    const dow = now.day();
    if (dow === 1) {
      const weekExpenses = state.expenses.filter((x) => dayjs(x.date).isAfter(now.subtract(7, 'day')));
      const weekTotal = weekExpenses.reduce((s, e) => s + e.amount, 0);
      if (weekTotal > 0) {
        const topCat = (() => {
          const byCat: Record<string, number> = {};
          for (const e of weekExpenses) {
            byCat[e.category] = (byCat[e.category] ?? 0) + e.amount;
          }
          const ent = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
          return ent ? ent[0] : null;
        })();
        insights.push({
          domain: 'finance',
          priority: 'low',
          title: 'Week spending snapshot',
          body: `You spent about $${weekTotal.toFixed(2)} this week${topCat ? `, mostly ${topCat}` : ''}. Aligned with your goals?`,
          coachingWhy: 'Awareness, not shame — you decide what to optimize.',
        });
      }
    }

    const budgets = state.budgets;
    if (budgets.length > 0) {
      const monthExpenses = state.expenses.filter(
        (e) => dayjs(e.date).isSame(now, 'month'),
      );
      for (const budget of budgets) {
        const categorySpend = monthExpenses
          .filter((e) => e.category === budget.category)
          .reduce((s, e) => s + e.amount, 0);
        const pct = categorySpend / budget.monthly_limit;
        if (pct >= 0.9) {
          insights.push({
            domain: 'finance',
            priority: pct >= 1 ? 'high' : 'low',
            title: 'Budget check-in',
            body: `${budget.category}: $${categorySpend.toFixed(2)} / $${budget.monthly_limit.toFixed(2)}. Want to adjust the plan or ride it out?`,
            coachingWhy: 'Knowing early gives you choices.',
          });
        }
      }
    }

    const dayOfMonth = now.date();
    const daysInMonth = now.daysInMonth();
    if (dayOfMonth >= daysInMonth - 1) {
      insights.push({
        domain: 'finance',
        priority: 'low',
        title: 'Month closing',
        body: `Spend around $${state.monthSpend.toFixed(2)}. Quick glance: does it match what you value?`,
      });
    }

    // ── Spending streak detection ──────────────────
    if (spendingPattern) {
      const avg = (spendingPattern.data as { avgDaily?: number }).avgDaily ?? 0;
      if (avg > 0) {
        // Check recent days for consecutive above-average spending
        const recentExpenses = state.expenses || [];
        const daySpends = new Map<string, number>();
        for (const e of recentExpenses) {
          const d = dayjs(e.date).format('YYYY-MM-DD');
          daySpends.set(d, (daySpends.get(d) || 0) + (e.amount ?? 0));
        }
        let streak = 0;
        for (let i = 0; i < 7; i++) {
          const d = now.subtract(i, 'day').format('YYYY-MM-DD');
          if ((daySpends.get(d) || 0) > avg) streak++;
          else break;
        }
        if (streak >= 3) {
          insights.push({
            domain: 'finance',
            priority: 'low',
            title: `${streak}-day spending streak`,
            body: `You've spent above your daily average ($${avg.toFixed(0)}) for ${streak} days in a row. Worth a check?`,
            coachingWhy: 'Noticing streaks early prevents surprise at month end.',
          });
        }
      }
    }

    // ── Savings goal progress ──────────────────────
    const savingsGoals = state.goals.filter((g) => g.domain === 'finance' && g.status === 'active' && g.unit === 'saved');
    for (const goal of savingsGoals) {
      if (goal.targetValue && goal.currentValue >= 0) {
        const pct = Math.round((goal.currentValue / goal.targetValue) * 100);
        if (pct >= 75 && pct < 100) {
          insights.push({
            domain: 'finance',
            priority: 'low',
            title: `${pct}% toward "${goal.title}"`,
            body: `$${goal.currentValue.toFixed(0)} of $${goal.targetValue.toFixed(0)} saved. Almost there!`,
          });
        }
      }
    }

    return insights;
  },

  async execute(step: PlanStep): Promise<ToolResult> {
    const tool = toolRegistry.get(step.tool);
    if (!tool) return { success: false, message: `Unknown tool: ${step.tool}` };
    const result = await tool.execute(step.params);
    eventBus.emit({ type: 'tool_result', tool: step.tool, params: step.params, result, domain: 'finance' });
    return result;
  },

  async onEvent(event: AgentEvent): Promise<void> {
    if (event.type === 'tool_result' && event.tool === 'log_expense' && event.result.success) {
      const state = useStore.getState();
      const financeGoals = state.goals.filter((g) => g.domain === 'finance' && g.status === 'active');
      for (const goal of financeGoals) {
        const amount = (event.params.amount as number) || 0;
        if (goal.unit === 'saved') {
          await state.progressGoal(goal.id, -amount);
        }
      }
    }
  },

  async briefing(): Promise<string> {
    const state = useStore.getState();
    const parts: string[] = [];

    parts.push(`Today: $${state.todaySpend.toFixed(2)}`);
    parts.push(`Month: $${state.monthSpend.toFixed(2)}`);

    const spendingPattern = state.patterns.find((p) => p.description === 'spending_habits');
    if (spendingPattern) {
      const avg = (spendingPattern.data as { avgDaily?: number }).avgDaily ?? 0;
      if (avg > 0) parts.push(`Avg/day: $${avg.toFixed(2)}`);
    }

    return parts.join(' | ');
  },
};
