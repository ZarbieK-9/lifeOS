import { Stack } from 'expo-router';
import React from 'react';

export default function DashboardLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="habits" />
      <Stack.Screen name="stats" />
      <Stack.Screen name="mood" />
      <Stack.Screen name="spending" />
    </Stack>
  );
}
