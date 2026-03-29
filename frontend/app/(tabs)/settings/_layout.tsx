import { Stack } from 'expo-router';
import React from 'react';

export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="account" />
      <Stack.Screen name="integrations" />
      <Stack.Screen name="google" />
      <Stack.Screen name="microsoft" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="hydration" />
      <Stack.Screen name="api-keys" />
      <Stack.Screen name="hey-zarbie" />
      <Stack.Screen name="latency-diagnostics" />
      <Stack.Screen name="system-health" />
      <Stack.Screen name="memory" />
      <Stack.Screen name="about" />
      <Stack.Screen name="partner" />
    </Stack>
  );
}
