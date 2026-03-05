import React from 'react';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { PressableScale } from '@/components/PressableScale';
import { Radii, Spacing } from '@/constants/theme';

type SecondaryButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  destructive?: boolean;
};

export function SecondaryButton({
  title,
  onPress,
  disabled,
  style,
  destructive,
}: SecondaryButtonProps) {
  const { theme } = useAppTheme();
  const borderColor = destructive ? theme.danger : theme.border;
  const textColor = destructive ? theme.danger : theme.text;
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.btn,
        { borderColor, borderRadius: Radii.button, backgroundColor: 'transparent' },
        disabled && styles.opaque,
        style,
      ]}
    >
      <Text style={[styles.title, { color: textColor }]}>{title}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    minHeight: 44,
  },
  opaque: { opacity: 0.5 },
  title: { fontSize: 16, fontWeight: '600' },
});
