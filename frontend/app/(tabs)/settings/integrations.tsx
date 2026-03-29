import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CalendarDays, AppWindow } from 'lucide-react-native';
import { ScreenContainer, RowCard } from '@/src/components/layout';
import { useAppTheme } from '@/src/hooks/useAppTheme';

export default function IntegrationsHubScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();

  return (
    <ScreenContainer scroll>
      <View style={ss.header}>
        <Text style={[ss.title, { color: theme.text }]}>Integrations Hub</Text>
        <Text style={[ss.sub, { color: theme.textSecondary }]}>Manage calendar, email, and account connections.</Text>
      </View>
      <RowCard
        title="Google"
        subtitle="Calendar, Gmail, sign in"
        onPress={() => router.push('/settings/google')}
        left={<CalendarDays size={18} color={theme.primary} strokeWidth={1.8} />}
        variant="outlined"
      />
      <RowCard
        title="Microsoft"
        subtitle="Outlook calendar (Graph)"
        onPress={() => router.push('/settings/microsoft')}
        left={<AppWindow size={18} color={theme.primary} strokeWidth={1.8} />}
        variant="outlined"
      />
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  header: { marginBottom: 14, gap: 4 },
  title: { fontSize: 28, fontWeight: '700' },
  sub: { fontSize: 14, lineHeight: 20 },
});

