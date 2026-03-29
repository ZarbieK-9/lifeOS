// Goals summary for LLM context — goal creation is LLM-driven via the `create_goal` tool (see tools.ts).

import { useStore } from '../store/useStore';

/** Get a summary of active goals for LLM context. */
export function getGoalsSummary(): string {
  const goals = useStore.getState().goals.filter((g) => g.status === 'active');
  if (goals.length === 0) return '';

  const lines = ['ACTIVE GOALS:'];
  for (const g of goals) {
    const progress = g.targetValue ? ` (${Math.round((g.currentValue / g.targetValue) * 100)}%)` : '';
    const deadline = g.deadline ? ` by ${g.deadline}` : '';
    lines.push(`- ${g.title}${progress}${deadline}`);
  }
  return lines.join('\n');
}
