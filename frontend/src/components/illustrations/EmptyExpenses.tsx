import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';

const W = 120;
const H = 80;

type EmptyExpensesProps = {
  width?: number;
  height?: number;
  color?: string;
};

export function EmptyExpenses({ width = W, height = H, color = '#8E8E93' }: EmptyExpensesProps) {
  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height} viewBox={`0 0 ${W} ${H}`}>
        <Circle cx={60} cy={35} r={18} fill="none" stroke={color} strokeWidth={2} opacity={0.6} />
        <Path d="M 45 35 L 75 35" stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.5} />
        <Path d="M 60 22 L 60 48" stroke={color} strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
        <Path d="M 35 58 L 85 58 L 82 72 L 38 72 Z" fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" opacity={0.4} />
      </Svg>
    </View>
  );
}
