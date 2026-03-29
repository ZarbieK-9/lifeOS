import { kv } from "../db/mmkv";

export type LatencyStage = "route" | "plan" | "validate" | "tool_execution" | "post_process";

const MAX_SAMPLES = 80;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]);
}

export function recordStageLatency(stage: LatencyStage, ms: number): { p50: number; p95: number; count: number } {
  const key = `agent_latency_${stage}`;
  const prev = kv.getJSON<number[]>(key) ?? [];
  const next = [...prev, Math.max(0, Math.round(ms))].slice(-MAX_SAMPLES);
  kv.set(key, JSON.stringify(next));
  const sorted = [...next].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    count: next.length,
  };
}
