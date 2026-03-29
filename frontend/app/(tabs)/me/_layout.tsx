import { Stack } from 'expo-router';
import React from 'react';

export default function MeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="weight" />
      <Stack.Screen name="day-profile" />
    </Stack>
  );
}
