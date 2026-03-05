/**
 * iOS-style pressable with scale-down animation.
 * Uses Reanimated for smooth 60fps spring on press.
 */

import React from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const springConfig = {
  damping: 15,
  stiffness: 400,
};

const PRESS_SCALE = 0.97;

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  disabled?: boolean;
  [key: string]: unknown;
};

export function PressableScale({ children, style, onPress, disabled, ...rest }: Props) {
  const scale = useSharedValue(1);
  const flat = StyleSheet.flatten(style);
  const flex = flat?.flex;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      {...rest}
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => {
        scale.value = withSpring(PRESS_SCALE, springConfig);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, springConfig);
      }}
      style={style}
    >
      <Animated.View style={[animatedStyle, flex !== undefined && { flex }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
