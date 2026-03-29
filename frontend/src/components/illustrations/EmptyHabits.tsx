import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

const W = 120;
const H = 80;

type EmptyHabitsProps = {
  width?: number;
  height?: number;
  color?: string;
};

export function EmptyHabits({ width = W, height = H, color = '#8E8E93' }: EmptyHabitsProps) {
  const scale = width / W;
  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height} viewBox={`0 0 ${W} ${H}`}>
        {/* Simple checklist / clipboard line art */}
        <Path
          d="M 30 15 L 50 15 L 52 18 L 78 18 L 80 15 L 90 15 L 90 65 L 30 65 Z"
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.6}
        />
        <Path d="M 38 28 L 82 28" stroke={color} strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
        <Path d="M 38 38 L 72 38" stroke={color} strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
        <Path d="M 38 48 L 68 48" stroke={color} strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
        <Circle cx={35} cy={58} r={4} fill="none" stroke={color} strokeWidth={1.5} opacity={0.5} />
      </Svg>
    </View>
  );
}
