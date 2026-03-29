import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { Card } from '@/src/components/Card';
import { Spacing, Typography } from '@/constants/theme';

type RowCardProps = {
  title: string;
  subtitle?: string;
  /** Left icon or illustration */
  left?: React.ReactNode;
  /** Right side: action or chevron */
  right?: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
  titleStyle?: TextStyle;
  variant?: 'default' | 'elevated' | 'outlined';
};

export function RowCard({
  title,
  subtitle,
  left,
  right,
  onPress,
  style,
  titleStyle,
  variant = 'default',
}: RowCardProps) {
  const { theme } = useAppTheme();
  const content = (
    <View style={styles.row}>
      {left ? <View style={styles.left}>{left}</View> : null}
      <View style={styles.main}>
        <Text
          style={[styles.title, { color: theme.text }, titleStyle]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[styles.subtitle, { color: theme.textSecondary }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );

  const cardPadding = Spacing.cardPadding;
  const inner = onPress ? (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={styles.touchable}>
      {content}
    </TouchableOpacity>
  ) : (
    content
  );
  return (
    <Card
      variant={variant}
      style={[
        {
          paddingVertical: cardPadding * 0.8,
          paddingHorizontal: cardPadding,
          borderRadius: 28,
        },
        style,
      ]}
    >
      {inner}
    </Card>
  );
}

const styles = StyleSheet.create({
  touchable: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 48,
  },
  left: {},
  main: { flex: 1, minWidth: 0 },
  title: { ...Typography.headline, fontSize: 16, letterSpacing: 0.2 },
  subtitle: { ...Typography.footnote, marginTop: 3 },
  right: {},
});
