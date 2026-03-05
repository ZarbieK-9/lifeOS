import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { Typography } from '@/constants/theme';
import { Text } from 'react-native';

type ScreenProps = {
  children: React.ReactNode;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  title?: string;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
};

export function Screen({ children, edges = ['top'], title, style, contentStyle }: ScreenProps) {
  const { theme } = useAppTheme();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.background }, style]} edges={edges}>
      {title != null && (
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      )}
      <View style={[styles.content, contentStyle]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  title: { ...Typography.title1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  content: { flex: 1, paddingHorizontal: 20 },
});
