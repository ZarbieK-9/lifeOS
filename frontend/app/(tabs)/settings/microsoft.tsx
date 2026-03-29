import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { ScreenContainer, Section, RowCard } from '@/src/components/layout';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { Typography } from '@/constants/theme';
import { useStore } from '@/src/store/useStore';
import { PressableScale } from '@/components/PressableScale';
import { microsoftAuth } from '@/src/services/microsoft-auth';

export default function MicrosoftSettingsScreen() {
  const { theme } = useAppTheme();
  const connected = useStore((s) => s.isMicrosoftConnected);
  const email = useStore((s) => s.microsoftEmail);
  const setMicrosoftConnected = useStore((s) => s.setMicrosoftConnected);
  const syncMicrosoftCalendarEvents = useStore((s) => s.syncMicrosoftCalendarEvents);
  const calendarSyncing = useStore((s) => s.calendarSyncing);
  const lastError = useStore((s) => s.lastCalendarError);

  const [busy, setBusy] = useState(false);

  const onSignIn = useCallback(async () => {
    setBusy(true);
    try {
      const r = await microsoftAuth.signIn();
      if (r.success) {
        setMicrosoftConnected(true, r.email ?? null);
        await syncMicrosoftCalendarEvents();
      }
    } catch (e) {
      console.warn('[Microsoft]', e);
    } finally {
      setBusy(false);
    }
  }, [setMicrosoftConnected, syncMicrosoftCalendarEvents]);

  const onDisconnect = useCallback(async () => {
    setBusy(true);
    try {
      await microsoftAuth.disconnect();
      setMicrosoftConnected(false, null);
    } finally {
      setBusy(false);
    }
  }, [setMicrosoftConnected]);

  const onSync = useCallback(async () => {
    setBusy(true);
    try {
      await syncMicrosoftCalendarEvents();
    } finally {
      setBusy(false);
    }
  }, [syncMicrosoftCalendarEvents]);

  return (
    <ScreenContainer
      scroll
      header={
        <View style={[ss.header, { borderBottomColor: theme.border }]}>
          <Text style={[ss.title, { color: theme.text }]}>Microsoft</Text>
          <Text style={[ss.sub, { color: theme.textSecondary }]}>
            Outlook calendar via Microsoft Graph (read-only cache). Add EXPO_PUBLIC_MICROSOFT_CLIENT_ID in Azure Portal.
          </Text>
        </View>
      }
    >
      <Section title="Connection">
        {busy && (
          <View style={ss.row}>
            <ActivityIndicator color={theme.primary} />
          </View>
        )}
        {connected ? (
          <>
            <Text style={[ss.meta, { color: theme.textSecondary }]}>
              Signed in{email ? ` as ${email}` : ''}
            </Text>
            <PressableScale
              style={[ss.btn, { backgroundColor: theme.primaryBg }]}
              onPress={onSync}
              disabled={busy || calendarSyncing}
            >
              <Text style={[ss.btnText, { color: theme.primary }]}>
                {calendarSyncing ? 'Syncing…' : 'Sync calendar now'}
              </Text>
            </PressableScale>
            <PressableScale style={[ss.btn, { backgroundColor: theme.border }]} onPress={onDisconnect} disabled={busy}>
              <Text style={[ss.btnText, { color: theme.text }]}>Disconnect</Text>
            </PressableScale>
          </>
        ) : (
          <PressableScale
            style={[ss.btn, { backgroundColor: theme.primary }]}
            onPress={onSignIn}
            disabled={busy}
          >
            <Text style={[ss.btnText, { color: '#fff' }]}>Sign in with Microsoft</Text>
          </PressableScale>
        )}
        {lastError && connected ? (
          <Text style={[ss.err, { color: theme.danger }]}>{lastError}</Text>
        ) : null}
      </Section>

      <Section title="About">
        <RowCard
          title="Coaching"
          subtitle="Morning plan and watcher use the same calendar cache as Google events (merged in SQLite)."
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
  },
  title: { ...Typography.title1 },
  sub: { ...Typography.subhead, marginTop: 8 },
  meta: { ...Typography.body, marginBottom: 8 },
  row: { paddingVertical: 8 },
  btn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 8 },
  btnText: { fontSize: 16, fontWeight: '600' },
  err: { ...Typography.footnote, marginTop: 8 },
});
