import React from 'react';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { PressableScale } from '@/components/PressableScale';
import { Radii, Spacing } from '@/constants/theme';

type ChipProps = {
  label: string;
  onPress: () => void;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Chip({ label, onPress, selected, style }: ChipProps) {
  const { theme } = useAppTheme();
  const bg = selected ? theme.primary : theme.primaryBg;
  const textColor = selected ? '#fff' : theme.primary;
  return (
    <PressableScale
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: bg, borderRadius: Radii.chip },
        style,
      ]}
    >
      <Text style={[styles.label, { color: textColor }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  label: { fontSize: 14, fontWeight: '600' },
});
