// Simple 7-day bar chart using react-native-svg — for hydration and sleep on Home

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Rect } from "react-native-svg";

const CHART_HEIGHT = 80;
const BAR_GAP = 4;
const CHART_WIDTH = 280;

export interface WeekChartProps {
  days: string[];
  values: number[];
  unit: string;
  label: string;
  barColor?: string;
  textColor?: string;
  formatValue?: (v: number) => string;
}

export function WeekChart({
  days,
  values,
  label,
  barColor = "#5AC8FA",
  textColor = "#8E8E93",
  formatValue = (v) => String(v),
}: WeekChartProps) {
  const n = days.length || 1;
  const barWidth = (CHART_WIDTH - (n - 1) * BAR_GAP) / n;
  const max = Math.max(1, ...values);

  return (
    <View style={ss.container}>
      <Text style={[ss.label, { color: textColor }]}>{label}</Text>
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT} style={ss.svg}>
        {values.map((v, i) => {
          const h = max > 0 ? (v / max) * (CHART_HEIGHT - 4) : 0;
          const x = i * (barWidth + BAR_GAP);
          const y = CHART_HEIGHT - h;
          return (
            <Rect
              key={i}
              x={x}
              y={y}
              width={barWidth}
              height={h}
              rx={4}
              ry={4}
              fill={barColor}
            />
          );
        })}
      </Svg>
      <View style={[ss.labels, { width: CHART_WIDTH }]}>
        {days.map((d, i) => (
          <Text key={i} style={[ss.dayLabel, { color: textColor }]} numberOfLines={1}>
            {d}
          </Text>
        ))}
      </View>
      <View style={[ss.values, { width: CHART_WIDTH }]}>
        {values.map((v, i) => (
          <Text key={i} style={[ss.valueLabel, { color: textColor }]} numberOfLines={1}>
            {formatValue(v)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const ss = StyleSheet.create({
  container: { marginBottom: 12 },
  label: { fontSize: 13, fontWeight: "600", marginBottom: 6 },
  svg: { marginBottom: 4 },
  labels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dayLabel: { fontSize: 10, flex: 1, textAlign: "center" },
  values: { flexDirection: "row", justifyContent: "space-between" },
  valueLabel: { fontSize: 10, flex: 1, textAlign: "center" },
});
