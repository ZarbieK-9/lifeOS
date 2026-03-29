import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ScreenContainer, Section, RowCard } from '@/src/components/layout';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Typography } from '@/constants/theme';
import { kv } from '@/src/db/mmkv';
import { Brain, Droplets, Info, Mic, Sparkles, UserCircle2, Users2, Link2, Activity } from 'lucide-react-native';

export default function SettingsListScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const chevron = <IconSymbol name="chevron.right" size={20} color={theme.textSecondary} />;

  return (
    <ScreenContainer
      scroll
      header={
        <View style={[ss.header, { borderBottomColor: theme.border }]}>
          <LinearGradient
            colors={[theme.surface, theme.surfaceMuted] as const}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <Text style={[ss.title, { color: theme.text }]}>Settings</Text>
          <Text style={[ss.subtitle, { color: theme.textSecondary }]}>Personalize LifeOS around your day</Text>
        </View>
      }
    >
      <Section title="Account & Privacy">
        <RowCard
          title="Account & connection"
          subtitle="Backend URL, login, sync"
          onPress={() => router.push('/settings/account')}
          left={<UserCircle2 size={18} color={theme.primary} strokeWidth={1.8} />}
          right={chevron}
          variant="outlined"
        />
        <RowCard
          title="Integrations hub"
          subtitle="Google, Microsoft, calendar and email access"
          onPress={() => router.push('/settings/integrations' as any)}
          left={<Link2 size={18} color={theme.primary} strokeWidth={1.8} />}
          right={chevron}
          variant="outlined"
        />
        <RowCard
          title="Partner"
          subtitle="Send snippets, see partners"
          onPress={() => router.push('/settings/partner')}
          left={<Users2 size={18} color={theme.primary} strokeWidth={1.8} />}
          right={chevron}
          variant="outlined"
        />
      </Section>
      <Section title="AI Personalization">
        <RowCard
          title="Help journey"
          subtitle="Replay first-time guide"
          onPress={() => {
            kv.delete('onboarding_journey_done');
            router.push('/(auth)/journey');
          }}
          left={<Sparkles size={18} color={theme.primary} strokeWidth={1.8} />}
          right={chevron}
          variant="outlined"
        />
        <RowCard
          title="Proactive AI & notifications"
          subtitle="Check-ins, quiet hours, sleep summary"
          onPress={() => router.push('/settings/notifications')}
          left={<Brain size={18} color={theme.primary} strokeWidth={1.8} />}
          right={chevron}
          variant="outlined"
        />
        <RowCard
          title="Hydration reminders"
          subtitle="Daily goal, start/end time"
          onPress={() => router.push('/settings/hydration')}
          left={<Droplets size={18} color={theme.primary} strokeWidth={1.8} />}
          right={chevron}
          variant="outlined"
        />
        <RowCard
          title="Hey Zarbie"
          subtitle="Hands-free wake phrase and popup"
          onPress={() => router.push('/settings/hey-zarbie')}
          left={<Mic size={18} color={theme.primary} strokeWidth={1.8} />}
          right={chevron}
          variant="outlined"
        />
        <RowCard
          title="AI memory"
          subtitle="Facts the AI has learned"
          onPress={() => router.push('/settings/memory')}
          left={<Brain size={18} color={theme.primary} strokeWidth={1.8} />}
          right={chevron}
          variant="outlined"
        />
      </Section>
      <Section title="Technical Info">
        <RowCard
          title="About"
          subtitle="Version, backup & restore"
          onPress={() => router.push('/settings/about')}
          left={<Info size={18} color={theme.primary} strokeWidth={1.8} />}
          right={chevron}
          variant="outlined"
        />
        <RowCard
          title="System health"
          subtitle="Latency, API keys, MQTT technical status"
          onPress={() => router.push('/settings/system-health' as any)}
          left={<Activity size={18} color={theme.primary} strokeWidth={1.8} />}
          right={chevron}
          variant="outlined"
        />
      </Section>
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  title: { ...Typography.title1 },
  subtitle: { ...Typography.subhead, marginTop: 4 },
});
