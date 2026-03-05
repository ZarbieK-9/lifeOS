import React from 'react';
import { ActivityIndicator, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { PressableScale } from '@/components/PressableScale';
import { Radii, Spacing } from '@/constants/theme';

type PrimaryButtonProps = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  fullWidth?: boolean;
};

export function PrimaryButton({
  title,
  onPress,
  loading,
  disabled,
  style,
  fullWidth = true,
}: PrimaryButtonProps) {
  const { theme } = useAppTheme();
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.btn,
        { backgroundColor: theme.primary, borderRadius: Radii.button },
        fullWidth && styles.fullWidth,
        (disabled || loading) && styles.opaque,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <Text style={styles.title}>{title}</Text>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  fullWidth: { width: '100%' },
  opaque: { opacity: 0.6 },
  title: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
