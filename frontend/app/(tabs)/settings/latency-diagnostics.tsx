import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ScreenContainer, ScreenHeader, Section } from "@/src/components/layout";
import { Card } from "@/src/components/Card";
import { PressableScale } from "@/components/PressableScale";
import { useAppTheme } from "@/src/hooks/useAppTheme";
import { kv } from "@/src/db/mmkv";

type StageKey = "route" | "plan" | "validate" | "tool_execution" | "post_process";

type StageRow = {
  stage: StageKey;
  p50: number;
  p95: number;
  samples: number;
};

const STAGES: StageKey[] = ["route", "plan", "validate", "tool_execution", "post_process"];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]);
}

function readRows(): StageRow[] {
  return STAGES.map((stage) => {
    const samples = kv.getJSON<number[]>(`agent_latency_${stage}`) ?? [];
    const sorted = [...samples].sort((a, b) => a - b);
    return {
      stage,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      samples: samples.length,
    };
  });
}

export default function LatencyDiagnosticsScreen() {
  const { theme } = useAppTheme();
  const [rows, setRows] = useState<StageRow[]>(() => readRows());

  const refresh = useCallback(() => {
    setRows(readRows());
  }, []);

  const resetAll = useCallback(() => {
    for (const stage of STAGES) {
      kv.delete(`agent_latency_${stage}`);
    }
    setRows(readRows());
  }, []);

  useEffect(() => {
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const totalSamples = useMemo(
    () => rows.reduce((sum, row) => sum + row.samples, 0),
    [rows],
  );

  return (
    <ScreenContainer
      scroll
      header={<ScreenHeader title="Latency diagnostics" />}
    >
      <Section
        title="Agent runtime stages"
        description="Rolling p50/p95 from on-device runtime samples."
      >
        <Card variant="outlined">
          <View style={ss.tableHeader}>
            <Text style={[ss.cellStage, { color: theme.textSecondary }]}>Stage</Text>
            <Text style={[ss.cellNum, { color: theme.textSecondary }]}>p50</Text>
            <Text style={[ss.cellNum, { color: theme.textSecondary }]}>p95</Text>
            <Text style={[ss.cellNum, { color: theme.textSecondary }]}>N</Text>
          </View>
          {rows.map((row) => (
            <View
              key={row.stage}
              style={[ss.tableRow, { borderTopColor: theme.divider }]}
            >
              <Text style={[ss.cellStage, { color: theme.text }]}>{row.stage}</Text>
              <Text style={[ss.cellNum, { color: theme.text }]}>{row.p50}ms</Text>
              <Text style={[ss.cellNum, { color: theme.text }]}>{row.p95}ms</Text>
              <Text style={[ss.cellNum, { color: theme.textSecondary }]}>{row.samples}</Text>
            </View>
          ))}
        </Card>
      </Section>

      <Section title="Controls" description={`Total samples across stages: ${totalSamples}`}>
        <Card variant="outlined">
          <View style={ss.actionRow}>
            <PressableScale
              style={[ss.btn, { borderColor: theme.border, backgroundColor: theme.surface }]}
              onPress={refresh}
            >
              <Text style={[ss.btnText, { color: theme.text }]}>Refresh</Text>
            </PressableScale>
            <PressableScale
              style={[ss.btn, { backgroundColor: theme.dangerBg, borderColor: theme.danger }]}
              onPress={resetAll}
            >
              <Text style={[ss.btnText, { color: theme.danger }]}>Reset samples</Text>
            </PressableScale>
          </View>
        </Card>
      </Section>
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 8,
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    marginTop: 8,
  },
  cellStage: {
    flex: 1.4,
    fontSize: 14,
    fontWeight: "600",
  },
  cellNum: {
    flex: 1,
    textAlign: "right",
    fontSize: 13,
    fontWeight: "500",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  btn: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: "center",
  },
  btnText: {
    fontSize: 14,
    fontWeight: "700",
  },
});
