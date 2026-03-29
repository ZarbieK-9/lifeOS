import React from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  type ViewStyle,
  type ScrollViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { Spacing } from '@/constants/theme';

type ScreenContainerProps = {
  children: React.ReactNode;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  /** Use ScrollView as root so content can scroll (default true for flexibility) */
  scroll?: boolean;
  /** Optional header slot (e.g. title + back button) */
  header?: React.ReactNode;
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
  /** ScrollView props when scroll is true */
  scrollProps?: Omit<ScrollViewProps, 'style' | 'contentContainerStyle' | 'children'>;
  /** Enables keyboard avoidance for forms / input-heavy screens */
  keyboardAvoiding?: boolean;
  keyboardVerticalOffset?: number;
};

export function ScreenContainer({
  children,
  edges = ['top', 'left', 'right', 'bottom'],
  scroll = true,
  header,
  style,
  contentContainerStyle,
  scrollProps,
  keyboardAvoiding = false,
  keyboardVerticalOffset = 0,
}: ScreenContainerProps) {
  const { theme } = useAppTheme();
  const paddingHorizontal = Spacing.screenPadding;
  const contentStyle: ViewStyle = {
    paddingHorizontal,
    paddingTop: 8,
    paddingBottom: 40,
  };

  const body = (
    <>
      {header}
      <View style={[styles.content, contentStyle]}>{children}</View>
    </>
  );

  if (scroll) {
    const scrollView = (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        nestedScrollEnabled={Platform.OS === 'android'}
        {...scrollProps}
      >
        {body}
      </ScrollView>
    );

    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: theme.background }, style]} edges={edges}>
        <LinearGradient
          colors={theme.backgroundGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        {keyboardAvoiding ? (
          <KeyboardAvoidingView
            style={styles.fill}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={keyboardVerticalOffset}
          >
            {scrollView}
          </KeyboardAvoidingView>
        ) : (
          scrollView
        )}
      </SafeAreaView>
    );
  }

  const wrappedContent = keyboardAvoiding ? (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      {body}
    </KeyboardAvoidingView>
  ) : (
    body
  );

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.background }, style]} edges={edges}>
      <LinearGradient
        colors={theme.backgroundGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      {wrappedContent}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: {},
});
