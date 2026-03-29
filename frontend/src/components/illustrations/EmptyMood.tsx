import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

const W = 120;
const H = 80;

type EmptyMoodProps = {
  width?: number;
  height?: number;
  color?: string;
};

export function EmptyMood({ width = W, height = H, color = '#8E8E93' }: EmptyMoodProps) {
  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height} viewBox={`0 0 ${W} ${H}`}>
        <Circle cx={60} cy={38} r={22} fill="none" stroke={color} strokeWidth={2} opacity={0.6} />
        <Path d="M 48 38 Q 60 28 72 38" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.5} />
        <Circle cx={52} cy={34} r={3} fill={color} opacity={0.5} />
        <Circle cx={68} cy={34} r={3} fill={color} opacity={0.5} />
      </Svg>
    </View>
  );
}
