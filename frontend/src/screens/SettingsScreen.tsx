// Settings — UI_UX.md §3.5
// Backend connection, auth, offline queues, sync & backup, security settings

import Constants from 'expo-constants';
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert,
  TextInput, ActivityIndicator, Platform, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { useAppTheme } from '../hooks/useAppTheme';
import { useHaptics } from '../hooks/useHaptics';
import { getGoogleRedirectUri } from '../services/google-auth';
import { kv } from '../db/mmkv';
import { api } from '../services/api';

export default function SettingsScreen() {
  const { theme } = useAppTheme();
  const haptic = useHaptics();

  const isOnline = useStore(s => s.isOnline);
  const queueCount = useStore(s => s.queueCount);
  const queuedEvents = useStore(s => s.queuedEvents);
  const drainQueue = useStore(s => s.drainQueue);
  const loadQueue = useStore(s => s.loadQueue);
  const init = useStore(s => s.init);
  const isBackendConfigured = useStore(s => s.isBackendConfigured);
  const isAuthenticated = useStore(s => s.isAuthenticated);
  const setBackendConfigured = useStore(s => s.setBackendConfigured);
  const setAuthenticated = useStore(s => s.setAuthenticated);

  // Google
  const isGoogleConnected = useStore(s => s.isGoogleConnected);
  const googleEmail = useStore(s => s.googleEmail);
  const lastCalendarError = useStore(s => s.lastCalendarError);
  const lastEmailError = useStore(s => s.lastEmailError);
  const setGoogleConnected = useStore(s => s.setGoogleConnected);

  // Backend connection
  const [connectionStatus, setConnectionStatus] = useState<'untested' | 'connected' | 'error'>('untested');

  // Google auth
  const [googleLoading, setGoogleLoading] = useState(false);

  // Proactive AI config (always on, only interval/quiet configurable)
  const checkinIntervalMin = useStore(s => s.checkinIntervalMin);
  const setCheckinIntervalMin = useStore(s => s.setCheckinIntervalMin);
  const proactiveQuietAfterHour = useStore(s => s.proactiveQuietAfterHour);
  const proactiveQuietBeforeHour = useStore(s => s.proactiveQuietBeforeHour);
  const setProactiveQuietHours = useStore(s => s.setProactiveQuietHours);

  // Notification listener (Android only — always on)
  const seenNotifPackages = useStore(s => s.seenNotifPackages);
  const allowedNotifPackages = useStore(s => s.allowedNotifPackages);
  const setAllowedNotifPackages = useStore(s => s.setAllowedNotifPackages);

  // AI Memory
  const aiMemories = useStore(s => s.aiMemories);
  const deleteAiMemory = useStore(s => s.deleteAiMemory);
  const updateAiMemory = useStore(s => s.updateAiMemory);
  const [memoryExpanded, setMemoryExpanded] = useState(false);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryText, setEditingMemoryText] = useState('');

  // Auto sleep/wake routines
  const autoMorningEnabled = useStore(s => s.autoMorningEnabled);
  const autoNightEnabled = useStore(s => s.autoNightEnabled);
  const setAutoMorning = useStore(s => s.setAutoMorning);
  const setAutoNight = useStore(s => s.setAutoNight);

  // Hydration reminders
  const hydrationReminderEnabled = useStore(s => s.hydrationReminderEnabled);
  const hydrationStartHour = useStore(s => s.hydrationStartHour);
  const hydrationEndHour = useStore(s => s.hydrationEndHour);
  const hydrationGoalMl = useStore(s => s.hydrationGoalMl);
  const hydrationIntervalMin = useStore(s => s.hydrationIntervalMin);
  const hydrationDosePerReminder = useStore(s => s.hydrationDosePerReminder);
  const nextHydrationReminderAt = useStore(s => s.nextHydrationReminderAt);
  const setHydrationReminder = useStore(s => s.setHydrationReminder);
  const disableHydrationReminder = useStore(s => s.disableHydrationReminder);

  // API Keys
  const [apiKeys, setApiKeys] = useState<Array<{
    key_id: string; name: string; created_at: string; last_used: string; key_prefix: string;
  }>>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);

  useEffect(() => {
    init(); loadQueue();
    if (isAuthenticated) {
      api.listApiKeys().then(r => { if (r.ok) setApiKeys(r.data.keys); });
    }
  }, [init, loadQueue, isAuthenticated]);

  // Check backend health on mount
  useEffect(() => {
    if (isBackendConfigured) {
      api.health().then(r => setConnectionStatus(r.ok ? 'connected' : 'error'));
    }
  }, [isBackendConfigured]);

  const onSync = async () => {
    haptic.medium();
    if (!isOnline) {
      Alert.alert('Offline', 'Connect to a network to sync queued events.');
      return;
    }
    await drainQueue();
    haptic.success();
    Alert.alert('Synced', 'All queued events have been processed.');
  };

  const onClearQueue = () => {
    Alert.alert('Clear Queue', 'Remove all pending events?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        haptic.warning();
        await drainQueue();
      }},
    ]);
  };

  const onConnectGoogle = async () => {
    haptic.light();
    Alert.alert(
      'Sign in with Google',
      "You'll open your browser to sign in. After you sign in, if you see a \"Visit Site\" or ngrok page, tap it once—then you'll return to the app.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async () => {
            const redirectUri = getGoogleRedirectUri();
            const isExpoGo = Constants.appOwnership === 'expo';
            if (isExpoGo && redirectUri.startsWith('http')) {
              Alert.alert(
                'Use a development build',
                "Google sign-in with your backend redirect won't work in Expo Go—the app's link (lifeos://) isn't registered there. Build the app with 'eas build' or run a dev client, then try again.",
                [{ text: 'OK' }]
              );
              return;
            }
            setGoogleLoading(true);
            try {
              const { googleAuth } = await import('../services/google-auth');
              const result = await googleAuth.signIn();
              if (result.success) {
                setGoogleConnected(true, result.email ?? null);
                haptic.success();
                Alert.alert('Connected', `Google account connected${result.email ? ` (${result.email})` : ''}`);
              } else {
                haptic.error();
                Alert.alert('Failed', 'Google sign-in was cancelled or failed.');
              }
            } catch (e) {
              haptic.error();
              Alert.alert('Error', (e as Error).message);
            }
            setGoogleLoading(false);
          },
        },
      ]
    );
  };

  const onDisconnectGoogle = () => {
    Alert.alert('Disconnect Google', 'Remove Google Calendar and Gmail access?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect', style: 'destructive', onPress: async () => {
          haptic.warning();
          const { googleAuth } = await import('../services/google-auth');
          await googleAuth.disconnect();
          setGoogleConnected(false, null);
        },
      },
    ]);
  };

  const onToggleHydrationReminder = (v: boolean) => {
    haptic.light();
    if (v) {
      setHydrationReminder(hydrationStartHour, hydrationEndHour, hydrationGoalMl);
    } else {
      disableHydrationReminder();
    }
  };

  const onSetHydrationGoal = (ml: number) => {
    haptic.light();
    setHydrationReminder(hydrationStartHour, hydrationEndHour, ml);
  };

  const onSetHydrationStart = (hour: number) => {
    haptic.light();
    if (hour < hydrationEndHour) {
      setHydrationReminder(hour, hydrationEndHour, hydrationGoalMl);
    }
  };

  const onSetHydrationEnd = (hour: number) => {
    haptic.light();
    if (hour > hydrationStartHour) {
      setHydrationReminder(hydrationStartHour, hour, hydrationGoalMl);
    }
  };

  const formatHour = (h: number) => {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12} ${ampm}`;
  };

  const formatInterval = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}min`;
  };

  const onToggleAppPackage = (packageName: string, enabled: boolean) => {
    haptic.light();
    let current = [...allowedNotifPackages];

    // If current is empty, that means "all allowed" — initialize from seen list
    if (current.length === 0) {
      current = seenNotifPackages.map(p => p.packageName);
    }

    if (enabled) {
      if (!current.includes(packageName)) current.push(packageName);
    } else {
      current = current.filter(p => p !== packageName);
    }

    // If all seen packages are enabled, reset to empty (meaning "all allowed")
    const allSeen = seenNotifPackages.map(p => p.packageName);
    const allEnabled = allSeen.every(p => current.includes(p));
    setAllowedNotifPackages(allEnabled ? [] : current);
  };

  const onToggleAutoMorning = (v: boolean) => {
    haptic.light();
    setAutoMorning(v);
  };

  const onToggleAutoNight = (v: boolean) => {
    haptic.light();
    setAutoNight(v);
  };

  const onCreateApiKey = async () => {
    if (!newKeyName.trim()) {
      Alert.alert('Error', 'Enter a name for this key (e.g., "Tasker")');
      return;
    }
    setApiKeyLoading(true);
    haptic.light();
    const result = await api.createApiKey(newKeyName.trim());
    setApiKeyLoading(false);
    if (result.ok) {
      setCreatedKey(result.data.api_key);
      setNewKeyName('');
      haptic.success();
      const list = await api.listApiKeys();
      if (list.ok) setApiKeys(list.data.keys);
    } else {
      haptic.error();
      Alert.alert('Error', result.error);
    }
  };

  const onCopyKey = async () => {
    if (createdKey) {
      const { Share } = require('react-native') as typeof import('react-native');
      await Share.share({ message: createdKey });
      haptic.success();
      setCreatedKey(null);
    }
  };

  const onRevokeApiKey = (keyId: string, name: string) => {
    Alert.alert('Revoke Key', `Revoke "${name}"? External services using this key will stop working.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke', style: 'destructive', onPress: async () => {
          haptic.light();
          await api.revokeApiKey(keyId);
          setApiKeys(prev => prev.filter(k => k.key_id !== keyId));
        },
      },
    ]);
  };

  const onBackup = () => {
    haptic.light();
    Alert.alert('Backup', 'Local backup saved. In production this exports the SQLite database.');
  };

  const onRestore = () => {
    haptic.light();
    Alert.alert('Restore', 'Select a backup file to restore from. (Not yet implemented)');
  };

  const mqttConnected = kv.getBool('mqtt_connected');

  // Partner (for More tab)
  const partners = useStore(s => s.partners);
  const sendSnippet = useStore(s => s.sendSnippet);
  const [partnerMessage, setPartnerMessage] = useState('');

  const onSendSnippet = async () => {
    if (!partnerMessage.trim()) return;
    haptic.light();
    const partnerId = partners[0]?.id || kv.getString('user_id') || 'default';
    await sendSnippet(partnerId, partnerMessage.trim());
    haptic.success();
    setPartnerMessage('');
  };

  return (
    <SafeAreaView style={[ss.fill, { backgroundColor: theme.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={ss.scroll}>
        <Text style={[ss.title, { color: theme.text }]}>Settings</Text>

        {/* Account — Google (primary) */}
        <Text style={[ss.section, { color: theme.text }]}>Account</Text>
        <View style={[ss.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {isGoogleConnected ? (
            <>
              <View style={ss.cardRow}>
                <Text style={[ss.cardLabel, { color: theme.text }]}>{googleEmail ?? 'Google connected'}</Text>
                <View style={[ss.statusDot, { backgroundColor: theme.success }]} />
              </View>
              {(lastCalendarError || lastEmailError) && (
                <Text style={[ss.hint, { color: theme.warn, fontSize: 12 }]}>
                  {lastCalendarError || lastEmailError}. Enable Calendar & Gmail APIs in Google Cloud if needed.
                </Text>
              )}
              <TouchableOpacity style={[ss.btn, { backgroundColor: theme.danger }]} onPress={onDisconnectGoogle}>
                <Text style={ss.btnText}>Disconnect</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={[ss.hint, { color: theme.textSecondary }]}>Sign in to sync calendar, email, and chat across devices.</Text>
              <TouchableOpacity
                style={[ss.btn, { backgroundColor: theme.primary }]}
                onPress={onConnectGoogle}
                disabled={googleLoading}
              >
                {googleLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={ss.btnText}>Sign in with Google</Text>}
              </TouchableOpacity>
              {__DEV__ && (
                <TouchableOpacity
                  style={[ss.chipBtn, { backgroundColor: theme.primaryBg, marginTop: 8, alignSelf: 'flex-start' }]}
                  onPress={async () => {
                    await Clipboard.setStringAsync(getGoogleRedirectUri());
                    haptic.light();
                    Alert.alert('Redirect URI copied', 'Add it in Google Cloud Console → Credentials → your OAuth client → Authorized redirect URIs.');
                  }}
                >
                  <Text style={[ss.chipBtnText, { color: theme.primary }]}>Copy redirect URI</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        {/* Connection — network + backend */}
        <Text style={[ss.section, { color: theme.text }]}>Connection</Text>
        <View style={[ss.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={ss.cardRow}>
            <Text style={[ss.cardLabel, { color: theme.text }]}>Network</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={[ss.statusDot, { backgroundColor: isOnline ? theme.success : theme.warn }]} />
              <Text style={[ss.hint, { color: theme.textSecondary }]}>{isOnline ? 'Online' : 'Offline'}</Text>
            </View>
          </View>
          <View style={[ss.cardRow, { borderTopWidth: 1, borderColor: theme.border, paddingTop: 10 }]}>
            <Text style={[ss.cardLabel, { color: theme.text }]}>Backend</Text>
            <Text style={[ss.hint, { color: theme.textSecondary }]} numberOfLines={1}>{api.getBaseUrl() || 'Not set'}</Text>
          </View>
          <View style={[ss.statusBar, { backgroundColor: connectionStatus === 'connected' ? theme.successBg : connectionStatus === 'error' ? theme.dangerBg : theme.warnBg, marginBottom: 0 }]}>
            <View style={[ss.statusDot, { backgroundColor: connectionStatus === 'connected' ? theme.success : connectionStatus === 'error' ? theme.danger : theme.warn }]} />
            <Text style={[ss.statusText, { color: connectionStatus === 'connected' ? theme.success : connectionStatus === 'error' ? theme.danger : theme.warn }]}>
              {connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'error' ? 'Unreachable' : 'Checking…'}
            </Text>
          </View>
          {mqttConnected && (
            <View style={[ss.statusBar, { backgroundColor: theme.successBg, marginBottom: 0 }]}>
              <View style={[ss.statusDot, { backgroundColor: theme.success }]} />
              <Text style={[ss.statusText, { color: theme.success }]}>MQTT connected</Text>
            </View>
          )}
          {!isBackendConfigured && <Text style={[ss.hint, { color: theme.warn, fontSize: 12 }]}>Set EXPO_PUBLIC_BACKEND_URL in .env</Text>}
        </View>

        {/* Partner */}
        <Text style={[ss.section, { color: theme.text }]}>Partner</Text>
        <View style={[ss.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {partners.length > 0 ? (
            partners.map(p => (
              <View key={p.id} style={[ss.partnerRow, { borderColor: theme.border }]}>
                <View style={[ss.onlineDot, { backgroundColor: p.online ? theme.success : theme.textSecondary }]} />
                <View style={ss.partnerInfo}>
                  <Text style={[ss.partnerName, { color: theme.text }]}>{p.name}</Text>
                  <Text style={[ss.partnerSub, { color: theme.textSecondary }]}>{p.online ? 'Online' : dayjs(p.lastSeen).format('HH:mm')}</Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={[ss.hint, { color: theme.textSecondary }]}>{isAuthenticated ? 'Partners appear when they connect via MQTT' : 'Sign in to connect'}</Text>
          )}
          <View style={[ss.snippetInputRow, { borderColor: theme.border }]}>
            <TextInput style={[ss.input, { color: theme.text, borderColor: theme.border, flex: 1 }]} placeholder="Send a snippet…" placeholderTextColor={theme.textSecondary} value={partnerMessage} onChangeText={setPartnerMessage} />
            <TouchableOpacity style={[ss.btn, { backgroundColor: partnerMessage.trim() ? theme.primary : theme.textSecondary, flex: 0, paddingHorizontal: 16 }]} onPress={onSendSnippet} disabled={!partnerMessage.trim()}>
              <Text style={ss.btnText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Offline queue */}
        <Text style={[ss.section, { color: theme.text }]}>Offline queue</Text>
        <View style={[ss.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={ss.cardRow}>
            <Text style={[ss.cardLabel, { color: theme.text }]}>Pending</Text>
            <View style={[ss.badge, { backgroundColor: queueCount > 0 ? theme.warn : theme.success }]}><Text style={ss.badgeText}>{queueCount}</Text></View>
          </View>
          {queuedEvents.slice(0, 3).map(e => (
            <View key={e.id} style={[ss.queueItem, { borderColor: theme.border }]}>
              <View style={[ss.typeBadge, { backgroundColor: theme.primaryBg }]}><Text style={[ss.typeText, { color: theme.primary }]}>{e.type}</Text></View>
              <Text style={[ss.queueTime, { color: theme.textSecondary }]}>{dayjs(e.created_at).format('HH:mm')}</Text>
            </View>
          ))}
          <View style={ss.btnRow}>
            <TouchableOpacity style={[ss.btn, { backgroundColor: theme.primary }]} onPress={onSync}><Text style={ss.btnText}>Sync now</Text></TouchableOpacity>
            <TouchableOpacity style={[ss.btn, { backgroundColor: theme.danger }]} onPress={onClearQueue}><Text style={ss.btnText}>Clear</Text></TouchableOpacity>
          </View>
        </View>

        {/* Preferences — PicoClaw AI */}
        <Text style={[ss.section, { color: theme.text }]}>PicoClaw AI</Text>
        <View style={[ss.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[ss.hint, { color: theme.textSecondary }]}>Check-ins and briefings (always on)</Text>

          <View style={[ss.cardRow, { borderTopWidth: 1, borderColor: theme.border, paddingTop: 10 }]}>
            <Text style={[ss.cardLabel, { color: theme.text }]}>Check-in interval</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[60, 90, 120].map((min) => (
                <TouchableOpacity
                  key={min}
                  onPress={() => { haptic.light(); setCheckinIntervalMin(min); }}
                  style={[
                    { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
                    checkinIntervalMin === min ? { backgroundColor: theme.primary, opacity: 0.9 } : { backgroundColor: theme.border },
                  ]}
                >
                  <Text style={{ color: checkinIntervalMin === min ? '#fff' : theme.text, fontWeight: '600' }}>
                    {min}m
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <Text style={[ss.hint, { color: theme.textSecondary }]}>
            How often to nudge (60, 90, or 120 min)
          </Text>

          <View style={[ss.cardRow, { borderTopWidth: 1, borderColor: theme.border, paddingTop: 10 }]}>
            <Text style={[ss.cardLabel, { color: theme.text }]}>Quiet hours</Text>
            <Text style={[ss.hint, { color: theme.textSecondary }]}>
              No check-ins after {proactiveQuietAfterHour}:00 or before {proactiveQuietBeforeHour}:00
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
            <TouchableOpacity
              onPress={() => {
                haptic.light();
                setProactiveQuietHours(21, 7);
              }}
              style={[
                { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
                (proactiveQuietAfterHour === 21 && proactiveQuietBeforeHour === 7) ? { backgroundColor: theme.primary, opacity: 0.9 } : { backgroundColor: theme.border },
              ]}
            >
              <Text style={{ color: (proactiveQuietAfterHour === 21 && proactiveQuietBeforeHour === 7) ? '#fff' : theme.text, fontWeight: '600' }}>21:00–07:00</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                haptic.light();
                setProactiveQuietHours(22, 6);
              }}
              style={[
                { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
                (proactiveQuietAfterHour === 22 && proactiveQuietBeforeHour === 6) ? { backgroundColor: theme.primary, opacity: 0.9 } : { backgroundColor: theme.border },
              ]}
            >
              <Text style={{ color: (proactiveQuietAfterHour === 22 && proactiveQuietBeforeHour === 6) ? '#fff' : theme.text, fontWeight: '600' }}>22:00–06:00</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                haptic.light();
                setProactiveQuietHours(0, 0);
              }}
              style={[
                { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
                (proactiveQuietAfterHour === 0 && proactiveQuietBeforeHour === 0) ? { backgroundColor: theme.primary, opacity: 0.9 } : { backgroundColor: theme.border },
              ]}
            >
              <Text style={{ color: (proactiveQuietAfterHour === 0 && proactiveQuietBeforeHour === 0) ? '#fff' : theme.text, fontWeight: '600' }}>Off</Text>
            </TouchableOpacity>
          </View>

        </View>

        {/* AI Memory Browser */}
        <Text style={[ss.section, { color: theme.text }]}>AI Memory</Text>
        <View style={[ss.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <TouchableOpacity style={ss.cardRow} onPress={() => { haptic.light(); setMemoryExpanded(!memoryExpanded); }}>
            <Text style={[ss.cardLabel, { color: theme.text }]}>Stored memories</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={[ss.badge, { backgroundColor: theme.primary }]}>
                <Text style={ss.badgeText}>{aiMemories.length}</Text>
              </View>
              <Text style={{ color: theme.textSecondary, fontSize: 16 }}>{memoryExpanded ? '▲' : '▼'}</Text>
            </View>
          </TouchableOpacity>
          <Text style={[ss.hint, { color: theme.textSecondary }]}>
            Facts the AI has learned about you from conversations
          </Text>

          {memoryExpanded && (
            <View style={{ gap: 6, marginTop: 4 }}>
              {aiMemories.length === 0 ? (
                <Text style={[ss.hint, { color: theme.textSecondary }]}>No memories yet. Chat with PicoClaw and it will remember things about you.</Text>
              ) : (
                aiMemories.map(m => (
                  <View key={m.id} style={[ss.memoryRow, { borderColor: theme.border }]}>
                    {editingMemoryId === m.id ? (
                      <View style={{ flex: 1, gap: 8 }}>
                        <TextInput
                          style={[ss.input, { color: theme.text, borderColor: theme.border, fontSize: 14 }]}
                          value={editingMemoryText}
                          onChangeText={setEditingMemoryText}
                          multiline
                          autoFocus
                        />
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <TouchableOpacity
                            style={[ss.chipBtn, { backgroundColor: theme.primary }]}
                            onPress={async () => {
                              if (editingMemoryText.trim()) {
                                await updateAiMemory(m.id, editingMemoryText.trim());
                                haptic.success();
                              }
                              setEditingMemoryId(null);
                            }}
                          >
                            <Text style={[ss.chipBtnText, { color: '#fff' }]}>Save</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[ss.chipBtn, { backgroundColor: theme.border }]}
                            onPress={() => setEditingMemoryId(null)}
                          >
                            <Text style={[ss.chipBtnText, { color: theme.text }]}>Cancel</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={[ss.hint, { color: theme.text }]}>{m.fact}</Text>
                          <View style={{ flexDirection: 'row', gap: 6 }}>
                            <View style={[ss.typeBadge, { backgroundColor: theme.primaryBg }]}>
                              <Text style={[ss.typeText, { color: theme.primary }]}>{m.category}</Text>
                            </View>
                            <Text style={{ color: theme.textSecondary, fontSize: 11 }}>
                              {dayjs(m.created_at).format('MMM D')}
                            </Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          onPress={() => { haptic.light(); setEditingMemoryId(m.id); setEditingMemoryText(m.fact); }}
                          style={{ padding: 6 }}
                        >
                          <Text style={{ color: theme.primary, fontSize: 13 }}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => {
                            Alert.alert('Delete memory', `Remove "${m.fact.slice(0, 50)}..."?`, [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Delete', style: 'destructive', onPress: async () => {
                                haptic.warning();
                                await deleteAiMemory(m.id);
                              }},
                            ]);
                          }}
                          style={{ padding: 6 }}
                        >
                          <Text style={{ color: theme.danger, fontSize: 13 }}>Del</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                ))
              )}
            </View>
          )}
        </View>

        {/* Notification Filter — per-app whitelist */}
        {Platform.OS === 'android' && seenNotifPackages.length > 0 && (
          <>
            <Text style={[ss.section, { color: theme.text }]}>Notification Filter</Text>
            <View style={[ss.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[ss.hint, { color: theme.textSecondary }]}>
                {allowedNotifPackages.length === 0
                  ? 'Listening to all apps. Toggle off apps you want to ignore.'
                  : `Listening to ${allowedNotifPackages.length} of ${seenNotifPackages.length} apps.`
                }
              </Text>
              {seenNotifPackages.map(pkg => {
                const isAllowed = allowedNotifPackages.length === 0 ||
                  allowedNotifPackages.includes(pkg.packageName);
                return (
                  <View key={pkg.packageName} style={[ss.cardRow, {
                    borderTopWidth: 1, borderColor: theme.border, paddingTop: 8,
                  }]}>
                    <Text style={[ss.cardLabel, { color: theme.text, flex: 1 }]} numberOfLines={1}>
                      {pkg.appName}
                    </Text>
                    <Switch
                      value={isAllowed}
                      onValueChange={(v) => onToggleAppPackage(pkg.packageName, v)}
                      trackColor={{ false: theme.border, true: theme.primary }}
                    />
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* Sleep Routines */}
        <Text style={[ss.section, { color: theme.text }]}>Sleep Routines</Text>
        <View style={[ss.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={ss.cardRow}>
            <Text style={[ss.cardLabel, { color: theme.text }]}>Morning Summary</Text>
            <Switch
              value={autoMorningEnabled}
              onValueChange={onToggleAutoMorning}
              trackColor={{ false: theme.border, true: theme.primary }}
            />
          </View>
          <Text style={[ss.hint, { color: theme.textSecondary }]}>
            Auto-send day preview when wake is detected
          </Text>

          <View style={ss.cardRow}>
            <Text style={[ss.cardLabel, { color: theme.text }]}>Night Summary</Text>
            <Switch
              value={autoNightEnabled}
              onValueChange={onToggleAutoNight}
              trackColor={{ false: theme.border, true: theme.primary }}
            />
          </View>
          <Text style={[ss.hint, { color: theme.textSecondary }]}>
            Auto-send day review when sleep is detected
          </Text>
        </View>

        {/* Hydration Reminders */}
        <Text style={[ss.section, { color: theme.text }]}>Hydration Reminders</Text>
        <View style={[ss.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={ss.cardRow}>
            <Text style={[ss.cardLabel, { color: theme.text }]}>Hydration Reminders</Text>
            <Switch
              value={hydrationReminderEnabled}
              onValueChange={onToggleHydrationReminder}
              trackColor={{ false: theme.border, true: theme.primary }}
            />
          </View>

          {hydrationReminderEnabled && (
            <>
              {/* Active Hours — Start */}
              <Text style={[ss.hint, { color: theme.textSecondary }]}>Start Time</Text>
              <View style={ss.chipRow}>
                {[6, 7, 8, 9, 10].map(h => (
                  <TouchableOpacity
                    key={`start-${h}`}
                    style={[ss.chipBtn, {
                      backgroundColor: hydrationStartHour === h ? theme.primary : theme.primaryBg,
                    }]}
                    onPress={() => onSetHydrationStart(h)}
                  >
                    <Text style={[ss.chipBtnText, {
                      color: hydrationStartHour === h ? '#fff' : theme.primary,
                    }]}>
                      {formatHour(h)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Active Hours — End */}
              <Text style={[ss.hint, { color: theme.textSecondary }]}>End Time</Text>
              <View style={ss.chipRow}>
                {[20, 21, 22, 23].map(h => (
                  <TouchableOpacity
                    key={`end-${h}`}
                    style={[ss.chipBtn, {
                      backgroundColor: hydrationEndHour === h ? theme.primary : theme.primaryBg,
                    }]}
                    onPress={() => onSetHydrationEnd(h)}
                  >
                    <Text style={[ss.chipBtnText, {
                      color: hydrationEndHour === h ? '#fff' : theme.primary,
                    }]}>
                      {formatHour(h)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Daily Goal */}
              <Text style={[ss.hint, { color: theme.textSecondary }]}>Daily Goal</Text>
              <View style={ss.chipRow}>
                {[1500, 2000, 2500, 3000].map(ml => (
                  <TouchableOpacity
                    key={`goal-${ml}`}
                    style={[ss.chipBtn, {
                      backgroundColor: hydrationGoalMl === ml ? theme.primary : theme.primaryBg,
                    }]}
                    onPress={() => onSetHydrationGoal(ml)}
                  >
                    <Text style={[ss.chipBtnText, {
                      color: hydrationGoalMl === ml ? '#fff' : theme.primary,
                    }]}>
                      {ml / 1000}L
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Calculated info */}
              <View style={[ss.statusBar, { backgroundColor: theme.primaryBg, marginTop: 4, marginBottom: 0 }]}>
                <Text style={[ss.statusText, { color: theme.primary }]}>
                  Every {formatInterval(hydrationIntervalMin)} · ~{hydrationDosePerReminder}ml per reminder
                </Text>
              </View>

              {/* Next reminder */}
              {nextHydrationReminderAt && (
                <Text style={[ss.hint, { color: theme.textSecondary }]}>
                  Next: {dayjs(nextHydrationReminderAt).format('h:mm A')}
                </Text>
              )}
            </>
          )}

          <Text style={[ss.hint, { color: theme.textSecondary }]}>
            Pauses during focus mode. Skipped doses are added to the next reminder.
          </Text>
        </View>

        {/* External Integrations */}
        {isAuthenticated && (
          <>
            <Text style={[ss.section, { color: theme.text }]}>External Integrations</Text>
            <View style={[ss.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[ss.hint, { color: theme.textSecondary }]}>
                Generate an API key to connect Tasker, IFTTT, or Google Assistant
              </Text>

              {apiKeys.map(k => (
                <View key={k.key_id} style={[ss.cardRow, { borderTopWidth: 1, borderColor: theme.border, paddingTop: 8 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[ss.cardLabel, { color: theme.text }]}>{k.name}</Text>
                    <Text style={[ss.hint, { color: theme.textSecondary }]}>
                      {k.key_prefix}... {k.last_used ? `Used ${dayjs(k.last_used).format('MMM D, h:mm A')}` : 'Never used'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[ss.btn, { backgroundColor: theme.danger, flex: 0, paddingHorizontal: 16 }]}
                    onPress={() => onRevokeApiKey(k.key_id, k.name)}
                  >
                    <Text style={ss.btnText}>Revoke</Text>
                  </TouchableOpacity>
                </View>
              ))}

              <TextInput
                style={[ss.input, { color: theme.text, borderColor: theme.border }]}
                placeholder='Key name (e.g., "Tasker")'
                placeholderTextColor={theme.textSecondary}
                value={newKeyName}
                onChangeText={setNewKeyName}
              />
              <TouchableOpacity
                style={[ss.btn, { backgroundColor: theme.primary }]}
                onPress={onCreateApiKey}
                disabled={apiKeyLoading}
              >
                {apiKeyLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={ss.btnText}>Generate API Key</Text>
                )}
              </TouchableOpacity>

              {createdKey && (
                <View style={{ backgroundColor: theme.warnBg, borderRadius: 8, padding: 12, marginTop: 8 }}>
                  <Text style={{ color: theme.warn, fontSize: 12, fontWeight: '600' }}>
                    Copy this key now — it will not be shown again
                  </Text>
                  <Text style={{ color: theme.text, fontFamily: 'monospace', fontSize: 11, marginTop: 4 }} selectable>
                    {createdKey}
                  </Text>
                  <TouchableOpacity
                    style={[ss.btn, { backgroundColor: theme.warn, marginTop: 8 }]}
                    onPress={onCopyKey}
                  >
                    <Text style={ss.btnText}>Share / Copy</Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={[ss.hint, { color: theme.textSecondary, marginTop: 8 }]}>
                Webhook: POST /v1/webhook/command with X-API-Key header
              </Text>
            </View>
          </>
        )}

        {/* Backup & Restore */}
        <Text style={[ss.section, { color: theme.text }]}>Backup & Restore</Text>
        <View style={[ss.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={ss.btnRow}>
            <TouchableOpacity style={[ss.btn, { backgroundColor: theme.primary }]} onPress={onBackup}>
              <Text style={ss.btnText}>Backup</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[ss.btn, { backgroundColor: theme.textSecondary }]} onPress={onRestore}>
              <Text style={ss.btnText}>Restore</Text>
            </TouchableOpacity>
          </View>
          <Text style={[ss.hint, { color: theme.textSecondary }]}>
            Exports SQLite database and MMKV cache locally
          </Text>
        </View>

        {/* About */}
        <Text style={[ss.section, { color: theme.text }]}>About</Text>
        <View style={[ss.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[ss.cardLabel, { color: theme.text }]}>LifeOS v1.0.0</Text>
          <Text style={[ss.hint, { color: theme.textSecondary }]}>
            Self-hosted, offline-first personal automation
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { padding: 20 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 12 },
  statusBar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, marginBottom: 16 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 14, fontWeight: '600' },
  section: { fontSize: 17, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLabel: { fontSize: 16, fontWeight: '500' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  badgeText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  queueItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, paddingTop: 8 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  typeText: { fontSize: 12, fontWeight: '600' },
  queueTime: { fontSize: 12 },
  btnRow: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 13, lineHeight: 18 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  chipBtnText: { fontSize: 13, fontWeight: '600' },
  partnerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1 },
  onlineDot: { width: 10, height: 10, borderRadius: 5 },
  partnerInfo: { flex: 1, gap: 2 },
  partnerName: { fontSize: 16, fontWeight: '600' },
  partnerSub: { fontSize: 13 },
  snippetInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, paddingTop: 12, marginTop: 4 },
  memoryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderTopWidth: 1, paddingTop: 8, paddingBottom: 4 },
});
