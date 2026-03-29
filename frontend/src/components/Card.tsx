import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { Spacing, Typography } from '@/constants/theme';

export type CardVariant = 'default' | 'elevated' | 'outlined';

type CardProps = {
  children: React.ReactNode;
  variant?: CardVariant;
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Optional header image or icon (e.g. small illustration) */
  image?: React.ReactNode;
};

export function Card({
  children,
  variant = 'default',
  elevated: elevatedProp,
  style,
  image,
}: CardProps) {
  const { theme } = useAppTheme();
  const elevated = elevatedProp ?? variant === 'elevated';
  const outlined = variant === 'outlined';

  const bg = elevated ? theme.surfaceElevated : theme.surface;
  const radius = 28;
  const padding = Spacing.cardPadding;
  const hasBorder = outlined || (!elevated && variant === 'default');

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: bg,
          borderRadius: radius,
          padding,
          borderWidth: hasBorder ? StyleSheet.hairlineWidth : 0,
          borderColor: hasBorder ? theme.border : 'transparent',
          ...(elevated ? theme.shadow : {}),
        },
        style,
      ]}
    >
      <LinearGradient
        colors={theme.cardGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      {image ? <View style={styles.imageSlot}>{image}</View> : null}
      {children}
    </View>
  );
}

type CardHeaderProps = {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  titleStyle?: StyleProp<TextStyle>;
};

export function CardHeader({ title, icon, action, titleStyle }: CardHeaderProps) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.header}>
      {icon ? <View style={styles.headerIcon}>{icon}</View> : null}
      <Text
        style={[
          styles.headerTitle,
          { color: theme.text },
          titleStyle,
        ]}
        numberOfLines={1}
      >
        {title}
      </Text>
      {action ? <View style={styles.headerAction}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
  imageSlot: {
    marginBottom: Spacing.itemSpacing,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  headerIcon: {},
  headerTitle: {
    flex: 1,
    ...Typography.headline,
  },
  headerAction: {},
});
