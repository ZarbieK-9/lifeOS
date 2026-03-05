import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { Radii, Spacing } from '@/constants/theme';

type CardProps = {
  children: React.ReactNode;
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Card({ children, elevated, style }: CardProps) {
  const { theme } = useAppTheme();
  const bg = elevated ? theme.surfaceElevated : theme.surface;
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: bg,
          borderColor: theme.border,
          borderRadius: Radii.card,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.screenPadding,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
