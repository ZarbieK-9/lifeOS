// PicoClaw Agent — Event Bus
// Central nervous system: typed pub/sub for agent communication.
// All domain agents, watchers, and the orchestrator communicate through events.

import type { ToolResult } from './types';

// ── Event types ─────────────────────────────────────

export type AgentEvent =
  | { type: 'user_input'; input: string; cmdId?: string }
  | { type: 'tool_result'; tool: string; params: Record<string, unknown>; result: ToolResult; domain?: string }
  | { type: 'state_change'; domain: string; key: string; value: unknown; prev?: unknown }
  | { type: 'time_trigger'; trigger: string; data?: unknown }
  | { type: 'pattern_detected'; pattern: string; domain: string; data: unknown }
  | { type: 'goal_progress'; goalId: string; current: number; target: number; pct: number }
  | { type: 'goal_created'; goalId: string; domain: string; title: string }
  | { type: 'plan_step_done'; planId: string; stepId: string; tool: string; success: boolean }
  | { type: 'app_lifecycle'; action: 'foreground' | 'background' | 'boot' }
  | { type: 'notification'; priority: 'high' | 'low'; title: string; body: string; domain?: string };

export type AgentEventType = AgentEvent['type'];

type Listener = (event: AgentEvent) => void | Promise<void>;
type TypedListener<T extends AgentEventType> = (
  event: Extract<AgentEvent, { type: T }>,
) => void | Promise<void>;

// ── Bus implementation ──────────────────────────────

class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  private allListeners = new Set<Listener>();
  private history: AgentEvent[] = [];
  private readonly MAX_HISTORY = 100;

  /** Subscribe to a specific event type. Returns unsubscribe fn. */
  on<T extends AgentEventType>(type: T, fn: TypedListener<T>): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    const listener = fn as Listener;
    this.listeners.get(type)!.add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  /** Subscribe to ALL events. Returns unsubscribe fn. */
  onAny(fn: Listener): () => void {
    this.allListeners.add(fn);
    return () => this.allListeners.delete(fn);
  }

  /** Emit an event. Listeners run async (fire-and-forget). */
  emit(event: AgentEvent): void {
    // Keep recent history for debugging / pattern detection
    this.history.push(event);
    if (this.history.length > this.MAX_HISTORY) this.history.shift();

    const typed = this.listeners.get(event.type);
    if (typed) {
      for (const fn of typed) {
        try { Promise.resolve(fn(event)).catch(this.logError); } catch (e) { this.logError(e); }
      }
    }
    for (const fn of this.allListeners) {
      try { Promise.resolve(fn(event)).catch(this.logError); } catch (e) { this.logError(e); }
    }
  }

  /** Get recent events, optionally filtered by type. */
  recent(type?: AgentEventType, limit = 20): AgentEvent[] {
    const filtered = type ? this.history.filter(e => e.type === type) : this.history;
    return filtered.slice(-limit);
  }

  /** Clear all listeners (for testing / teardown). */
  clear(): void {
    this.listeners.clear();
    this.allListeners.clear();
    this.history = [];
  }

  private logError = (e: unknown) => {
    console.warn('[EventBus] listener error:', e);
  };
}

/** Singleton event bus for the entire agent system. */
export const eventBus = new EventBus();
