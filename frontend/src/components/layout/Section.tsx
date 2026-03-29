import React from 'react';
import { StyleSheet, View, Text, type ViewStyle, type TextStyle } from 'react-native';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { Spacing } from '@/constants/theme';
import { Typography } from '@/constants/theme';

type SectionProps = {
  title?: string;
  description?: string;
  children: React.ReactNode;
  style?: ViewStyle;
  titleStyle?: TextStyle;
};

export function Section({
  title,
  description,
  children,
  style,
  titleStyle,
}: SectionProps) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <Text
          style={[styles.title, { color: theme.text }, titleStyle]}
          numberOfLines={1}
        >
          {title}
        </Text>
      ) : null}
      {description ? (
        <Text
          style={[styles.description, { color: theme.textSecondary }]}
          numberOfLines={2}
        >
          {description}
        </Text>
      ) : null}
      <View style={styles.children}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: Spacing.sectionGap,
  },
  title: {
    ...Typography.headline,
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  description: {
    ...Typography.footnote,
    marginBottom: 10,
  },
  children: {
    gap: 12,
  },
});
