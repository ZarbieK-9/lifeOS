// Partner screen — UI_UX.md §3.4
// Partner list with online/offline status from MQTT, snippet view, sync indicator
// Uses mqtt.js WebSocket client for real-time communication

import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { useAppTheme } from '../hooks/useAppTheme';
import { useHaptics } from '../hooks/useHaptics';
import { kv } from '../db/mmkv';

export default function PartnerScreen() {
  const { screen: c } = useAppTheme();
  const haptic = useHaptics();

  const isOnline = useStore(s => s.isOnline);
  const snippets = useStore(s => s.partnerSnippets);
  const partners = useStore(s => s.partners);
  const sendSnippet = useStore(s => s.sendSnippet);
  const init = useStore(s => s.init);
  const isAuthenticated = useStore(s => s.isAuthenticated);

  const [message, setMessage] = useState('');

  useEffect(() => { init(); }, [init]);

  const onSend = async () => {
    if (!message.trim()) return;
    haptic.light();

    // Send to first partner (or use a selected partner)
    const partnerId = partners[0]?.id || kv.getString('user_id') || 'default';
    await sendSnippet(partnerId, message.trim());
    haptic.success();
    setMessage('');
  };

  // Sync indicator colors — UI_UX.md §3.4
  const syncColor = (synced: boolean) => synced ? c.success : isOnline ? c.warn : c.danger;
  const syncLabel = (synced: boolean) => synced ? 'Synced' : isOnline ? 'Pending' : 'Queued';

  const mqttConnected = kv.getBool('mqtt_connected');

  return (
    <SafeAreaView style={[ss.fill, { backgroundColor: c.bg }]}>
      <View style={ss.header}>
        <Text style={[ss.title, { color: c.text }]}>Partner</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {!isOnline && (
            <View style={[ss.offBadge, { backgroundColor: c.warnBg }]}>
              <Text style={[ss.offText, { color: c.warn }]}>Offline</Text>
            </View>
          )}
          {isAuthenticated && (
            <View style={[ss.offBadge, { backgroundColor: mqttConnected ? c.successBg : c.warnBg }]}>
              <Text style={[ss.offText, { color: mqttConnected ? c.success : c.warn }]}>
                MQTT: {mqttConnected ? 'On' : 'Off'}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Partner list */}
      {partners.length > 0 ? (
        partners.map(p => (
          <View key={p.id} style={[ss.partnerRow, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={[ss.onlineDot, { backgroundColor: p.online ? c.success : c.sub }]} />
            <View style={ss.partnerInfo}>
              <Text style={[ss.partnerName, { color: c.text }]}>{p.name}</Text>
              <Text style={[ss.partnerSub, { color: c.sub }]}>
                {p.online ? 'Online' : `Last seen ${dayjs(p.lastSeen).format('HH:mm')}`}
              </Text>
            </View>
            <View style={[ss.syncBadge, { backgroundColor: (p.online ? c.success : c.sub) + '22' }]}>
              <Text style={[ss.syncText, { color: p.online ? c.success : c.sub }]}>
                {p.online ? 'Connected' : 'Offline'}
              </Text>
            </View>
          </View>
        ))
      ) : (
        <View style={[ss.partnerRow, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={[ss.onlineDot, { backgroundColor: c.sub }]} />
          <View style={ss.partnerInfo}>
            <Text style={[ss.partnerName, { color: c.text }]}>No partners yet</Text>
            <Text style={[ss.partnerSub, { color: c.sub }]}>
              {isAuthenticated
                ? 'Partners appear when they connect via MQTT'
                : 'Log in via Settings to connect'}
            </Text>
          </View>
        </View>
      )}

      {/* Snippet history */}
      <Text style={[ss.section, { color: c.text }]}>Snippets</Text>
      <FlatList
        data={snippets}
        keyExtractor={s => s.snippet_id}
        contentContainerStyle={ss.list}
        renderItem={({ item }) => (
          <View style={[ss.snippetCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[ss.snippetContent, { color: c.text }]}>{item.content}</Text>
            <View style={ss.snippetMeta}>
              <Text style={[ss.snippetTime, { color: c.sub }]}>
                {dayjs(item.timestamp).format('MMM D, HH:mm')}
              </Text>
              <View style={[ss.syncDot, { backgroundColor: syncColor(item.synced) }]} />
              <Text style={[ss.syncLabel, { color: syncColor(item.synced) }]}>
                {syncLabel(item.synced)}
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={ss.empty}>
            <Text style={[ss.emptyText, { color: c.sub }]}>
              No snippets yet. Send a message to your partner.
            </Text>
            {!isAuthenticated && (
              <Text style={[ss.emptyHint, { color: c.sub }]}>
                Set up your backend in Settings to enable MQTT sync.
              </Text>
            )}
          </View>
        }
      />

      {/* Send snippet input */}
      <View style={[ss.inputBar, { backgroundColor: c.surface, borderColor: c.border }]}>
        <TextInput
          style={[ss.textInput, { color: c.text }]}
          placeholder="Send a snippet..."
          placeholderTextColor={c.sub}
          value={message}
          onChangeText={setMessage}
          onSubmitEditing={onSend}
        />
        <TouchableOpacity
          style={[ss.sendBtn, { backgroundColor: message.trim() ? c.primary : c.border }]}
          onPress={onSend}
          disabled={!message.trim()}
        >
          <Text style={ss.sendText}>↑</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  offBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  offText: { fontSize: 12, fontWeight: '600' },
  partnerRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 12, padding: 14, borderRadius: 14, borderWidth: 1, gap: 12 },
  onlineDot: { width: 12, height: 12, borderRadius: 6 },
  partnerInfo: { flex: 1, gap: 2 },
  partnerName: { fontSize: 16, fontWeight: '600' },
  partnerSub: { fontSize: 13 },
  syncBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  syncText: { fontSize: 11, fontWeight: '600' },
  section: { fontSize: 17, fontWeight: '600', paddingHorizontal: 20, marginTop: 8, marginBottom: 10 },
  list: { paddingHorizontal: 20, paddingBottom: 8 },
  snippetCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8, gap: 8 },
  snippetContent: { fontSize: 15, lineHeight: 22 },
  snippetMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  snippetTime: { fontSize: 12, flex: 1 },
  syncDot: { width: 8, height: 8, borderRadius: 4 },
  syncLabel: { fontSize: 11, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 40, gap: 8, paddingHorizontal: 40 },
  emptyText: { fontSize: 15, textAlign: 'center' },
  emptyHint: { fontSize: 12, textAlign: 'center', fontStyle: 'italic' },
  inputBar: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, padding: 12, gap: 10 },
  textInput: { flex: 1, fontSize: 16, paddingVertical: 8, paddingHorizontal: 14 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  sendText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
