// PicoClaw Agent — Workflow Executor
// Executes plans step-by-step with conditions, dependencies, and persistence.
// No turn limit — plans run to completion.

import { useStore } from '../store/useStore';
import { eventBus } from './eventBus';
import { getAgentForTool } from './domains/index';
import { executeToolWithGoalContext } from './tools';
import type { Plan, PlanStep, ToolResult } from './types';
import { recordStageLatency } from './latency';

function shouldRequireApproval(step: PlanStep): boolean {
  const s = useStore.getState();
  const domain = getAgentForTool(step.tool)?.domain;
  const mode = (domain && s.agentDomainApprovalModes[domain]) || s.agentDefaultApprovalMode;
  return mode === 'ask_first';
}

function policyCheck(step: PlanStep): string | null {
  const s = useStore.getState();
  const p = s.agentPolicy;
  if (p.neverAutoSendMessages && step.tool === 'send_snippet') {
    return 'Policy blocked: auto-send messages disabled.';
  }
  if (step.tool === 'schedule_reminder' || step.tool === 'create_event') {
    const hour = Number(step.params.hour ?? -1);
    if (!Number.isNaN(hour) && hour >= 0 && hour < p.neverScheduleBeforeHour) {
      return `Policy blocked: no auto-scheduling before ${p.neverScheduleBeforeHour}:00.`;
    }
  }
  if (step.tool === 'log_expense') {
    const amount = Number(step.params.amount ?? 0);
    if (amount > p.maxDailySpendAuto) {
      return `Policy blocked: expense above auto limit ($${p.maxDailySpendAuto}).`;
    }
  }
  return null;
}

// ── Condition evaluator ───────────────────────────

/** Resolve a variable name to a numeric value from store state. */
function resolveVariable(name: string, state: ReturnType<typeof useStore.getState>): number | null {
  switch (name) {
    case 'hydration_ml': return state.hydrationTodayMl;
    case 'tasks_pending': return state.tasks.filter((t) => t.status === 'pending').length;
    case 'tasks_overdue': {
      const today = new Date().toISOString().slice(0, 10);
      return state.tasks.filter((t) => t.status === 'pending' && t.due_date && t.due_date < today).length;
    }
    case 'sleep_hours': return state.sleepSessions[0]?.duration_minutes ? state.sleepSessions[0].duration_minutes / 60 : null;
    case 'mood': return state.moodLogs?.[0]?.mood ?? null;
    case 'energy': return state.moodLogs?.[0]?.energy ?? null;
    default: return null;
  }
}

/** Evaluate a condition string against current state. Supports named conditions,
 *  numeric comparisons (e.g. `hydration_ml > 1000`), and logical operators
 *  AND(cond1, cond2) / OR(cond1, cond2). */
function evaluateCondition(condition: string): boolean {
  const state = useStore.getState();

  // Named condition patterns
  if (condition === 'has_pending_tasks') {
    return state.tasks.some((t) => t.status === 'pending');
  }
  if (condition === 'focus_off') {
    return !state.focusEnabled;
  }
  if (condition === 'hydration_below_goal') {
    return state.hydrationTodayMl < (state.hydrationGoalMl || 2500);
  }
  if (condition === 'is_morning') {
    const h = new Date().getHours();
    return h >= 6 && h <= 10;
  }
  if (condition === 'is_afternoon') {
    const h = new Date().getHours();
    return h >= 12 && h <= 17;
  }
  if (condition === 'is_evening') {
    const h = new Date().getHours();
    return h >= 18 && h <= 22;
  }
  if (condition === 'google_connected') {
    return state.isGoogleConnected;
  }

  // Numeric comparisons: "hydration_ml > 1000", "tasks_overdue >= 3"
  const numericMatch = condition.match(/^(\w+)\s*(>=|<=|>|<|==)\s*(\d+(?:\.\d+)?)$/);
  if (numericMatch) {
    const [, variable, op, valueStr] = numericMatch;
    const target = parseFloat(valueStr);
    const actual = resolveVariable(variable, state);
    if (actual === null) return true; // unknown variable — don't block
    switch (op) {
      case '>': return actual > target;
      case '>=': return actual >= target;
      case '<': return actual < target;
      case '<=': return actual <= target;
      case '==': return actual === target;
    }
  }

  // Logical operators: AND(cond1, cond2), OR(cond1, cond2)
  const andMatch = condition.match(/^AND\((.+),\s*(.+)\)$/);
  if (andMatch) return evaluateCondition(andMatch[1].trim()) && evaluateCondition(andMatch[2].trim());

  const orMatch = condition.match(/^OR\((.+),\s*(.+)\)$/);
  if (orMatch) return evaluateCondition(orMatch[1].trim()) || evaluateCondition(orMatch[2].trim());

  // Default: treat unknown conditions as true (don't block execution)
  console.warn(`[Executor] unknown condition: ${condition}`);
  return true;
}

// ── Step executor ─────────────────────────────────

async function executeStep(step: PlanStep): Promise<ToolResult> {
  const state = useStore.getState();
  if (state.simulationMode) {
    return { success: true, message: `[simulation] Would execute ${step.tool}` };
  }
  const policyViolation = policyCheck(step);
  if (policyViolation) return { success: false, message: policyViolation };
  if (shouldRequireApproval(step)) {
    await state.enqueueAgentApproval(step.tool, step.params, 'plan');
    return { success: false, message: `Awaiting approval for ${step.tool}` };
  }
  // Try domain agent first
  const agent = getAgentForTool(step.tool);
  if (agent) {
    return agent.execute(step);
  }
  const result = await executeToolWithGoalContext(step.tool, step.params);
  eventBus.emit({ type: 'tool_result', tool: step.tool, params: step.params, result });
  return result;
}

// ── Plan executor ─────────────────────────────────

export interface PlanExecutionResult {
  planId: string;
  completed: number;
  skipped: number;
  failed: number;
  total: number;
  results: { stepId: string; tool: string; result: ToolResult }[];
}

/**
 * Execute a plan's pending steps in order.
 * Respects conditions and dependencies.
 * Persists step status to DB after each step.
 */
export async function executePlan(plan: Plan): Promise<PlanExecutionResult> {
  const tag = `[Executor] plan=${plan.id}`;
  console.log(`${tag} starting (${plan.steps.length} steps)`);

  const store = useStore.getState();
  const executionResults: PlanExecutionResult['results'] = [];
  let completed = 0;
  let skipped = 0;
  let failed = 0;

  // Mark plan as in_progress
  await store.updatePlan(plan.id, { status: 'in_progress' });

  const maxAttempts = 2;
  let progress = true;
  let pass = 0;
  const stepStatus = new Map(plan.steps.map((s) => [s.id, s.status]));

  while (progress && pass < Math.max(1, plan.steps.length + 1)) {
    progress = false;
    pass += 1;
    const readySteps: PlanStep[] = [];

    for (const step of plan.steps) {
      const currentStatus = stepStatus.get(step.id) ?? step.status;
    // Skip already-done steps
      if (currentStatus === 'done' || currentStatus === 'skipped') {
      continue;
    }

    // Check condition
    if (step.condition && !evaluateCondition(step.condition)) {
      console.log(`${tag} step=${step.id} skipped (condition: ${step.condition})`);
      await store.updatePlanStep(plan.id, step.id, 'skipped');
      stepStatus.set(step.id, 'skipped');
      skipped++;
      progress = true;
      continue;
    }

    // Check dependencies
    if (step.dependsOn && step.dependsOn.length > 0) {
      const allDepsDone = step.dependsOn.every((depId) => {
        const depStatus = stepStatus.get(depId);
        return depStatus === 'done' || depStatus === 'skipped';
      });
      if (!allDepsDone) {
        console.log(`${tag} step=${step.id} waiting on dependencies`);
        continue; // will be picked up on next execution pass
      }
    }
      readySteps.push(step);
    }

    if (readySteps.length === 0) continue;
    const batchStart = Date.now();
    const stepOutputs = await Promise.all(
      readySteps.map(async (step) => {
        console.log(`${tag} executing step=${step.id} tool=${step.tool}`);
        try {
          let result: ToolResult = { success: false, message: 'Unknown failure' };
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            result = await executeStep(step);
            if (result.success || attempt === maxAttempts) break;
            await new Promise((resolve) => setTimeout(resolve, attempt * 400));
          }
          return { step, result, error: null as string | null };
        } catch (e: any) {
          return { step, result: { success: false, message: e?.message ?? 'Unknown error' }, error: e?.message ?? 'Unknown error' };
        }
      }),
    );
    recordStageLatency('tool_execution', Date.now() - batchStart);

    for (const { step, result, error } of stepOutputs) {
      executionResults.push({ stepId: step.id, tool: step.tool, result });

      const status = result.success ? 'done' : 'failed';
      await store.updatePlanStep(plan.id, step.id, status);
      stepStatus.set(step.id, status);

      eventBus.emit({ type: 'plan_step_done', planId: plan.id, stepId: step.id, tool: step.tool, success: result.success });

      if (result.success) {
        completed++;
        progress = true;
      } else {
        failed++;
        console.warn(`${tag} step=${step.id} failed: ${error ?? result.message}`);
      }
    }
  }

  const finalPlan = useStore.getState().plans.find((p) => p.id === plan.id);
  if (finalPlan) {
    completed = finalPlan.steps.filter((s) => s.status === 'done').length;
    skipped = finalPlan.steps.filter((s) => s.status === 'skipped').length;
    failed = finalPlan.steps.filter((s) => s.status === 'failed').length;
  }

  // Log the execution
  await store.logAgentAction({
    agent: 'executor',
    actionType: 'execute',
    input: `Plan: ${plan.title}`,
    output: `completed=${completed}, skipped=${skipped}, failed=${failed}`,
    goalId: plan.goalId,
    planId: plan.id,
    success: failed === 0,
  });

  console.log(`${tag} done: completed=${completed}, skipped=${skipped}, failed=${failed}`);

  return {
    planId: plan.id,
    completed,
    skipped,
    failed,
    total: plan.steps.length,
    results: executionResults,
  };
}

/** Execute all pending/in_progress plans. */
export async function executeAllPendingPlans(): Promise<PlanExecutionResult[]> {
  const plans = useStore.getState().plans.filter(
    (p) => p.status === 'pending' || p.status === 'in_progress',
  );

  const results: PlanExecutionResult[] = [];
  for (const plan of plans) {
    try {
      const result = await executePlan(plan);
      results.push(result);
    } catch (e) {
      console.error(`[Executor] plan ${plan.id} error:`, e);
    }
  }
  return results;
}
