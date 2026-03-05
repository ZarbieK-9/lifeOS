import React from 'react';
import { StyleSheet, View, Text, type ViewStyle } from 'react-native';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { Typography, Spacing } from '@/constants/theme';

type ListRowProps = {
  label: string;
  value?: string | React.ReactNode;
  right?: React.ReactNode;
  chevron?: boolean;
  style?: ViewStyle;
  last?: boolean;
};

export function ListRow({ label, value, right, chevron, style, last }: ListRowProps) {
  const { theme } = useAppTheme();
  return (
    <View
      style={[
        styles.row,
        { borderBottomColor: theme.divider },
        last && styles.rowLast,
        style,
      ]}
    >
      <View style={styles.left}>
        <Text style={[styles.label, { color: theme.text }]} numberOfLines={1}>
          {label}
        </Text>
        {value != null && typeof value === 'string' && (
          <Text style={[styles.value, { color: theme.textSecondary }]} numberOfLines={1}>
            {value}
          </Text>
        )}
      </View>
      {(typeof value !== 'string' && value != null) || right != null ? (
        <View style={styles.right}>
          {typeof value !== 'string' && value}
          {right}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.itemSpacing,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 48,
  },
  rowLast: { borderBottomWidth: 0 },
  left: { flex: 1, marginRight: 12 },
  label: { ...Typography.body },
  value: { ...Typography.footnote, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
