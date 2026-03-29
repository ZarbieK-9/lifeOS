import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import dayjs from 'dayjs';
import { useStore } from '@/src/store/useStore';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { useHaptics } from '@/src/hooks/useHaptics';
import { kv } from '@/src/db/mmkv';
import { ScreenContainer, Section, ScreenHeader } from '@/src/components/layout';
import { Card } from '@/src/components/Card';

export default function SettingsPartnerScreen() {
  const { theme } = useAppTheme();
  const haptic = useHaptics();
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const partners = useStore((s) => s.partners);
  const sendSnippet = useStore((s) => s.sendSnippet);
  const [partnerMessage, setPartnerMessage] = useState('');

  const onSend = async () => {
    if (!partnerMessage.trim()) return;
    haptic.light();
    const partnerId = partners[0]?.id || kv.getString('user_id') || 'default';
    await sendSnippet(partnerId, partnerMessage.trim());
    haptic.success();
    setPartnerMessage('');
  };

  return (
    <ScreenContainer scroll header={<ScreenHeader title="Partner" />}>
      <Section title="Partners" description={isAuthenticated ? 'Partners appear when they connect via MQTT.' : 'Sign in to connect.'}>
        <Card variant="outlined">
          {partners.length > 0 ? (
            partners.map((p) => (
              <View key={p.id} style={[ss.partnerRow, { borderColor: theme.border }]}>
                <View style={[ss.dot, { backgroundColor: p.online ? theme.success : theme.textSecondary }]} />
                <View style={ss.partnerInfo}>
                  <Text style={[ss.partnerName, { color: theme.text }]}>{p.name}</Text>
                  <Text style={[ss.hint, { color: theme.textSecondary }]}>{p.online ? 'Online' : dayjs(p.lastSeen).format('HH:mm')}</Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={[ss.hint, { color: theme.textSecondary }]}>{isAuthenticated ? 'Partners appear when they connect via MQTT' : 'Sign in to connect'}</Text>
          )}
          <View style={[ss.inputRow, { borderColor: theme.border }]}>
            <TextInput
              style={[ss.input, { color: theme.text, borderColor: theme.border, flex: 1 }]}
              placeholder="Send a snippet…"
              placeholderTextColor={theme.textSecondary}
              value={partnerMessage}
              onChangeText={setPartnerMessage}
            />
            <TouchableOpacity
              style={[ss.btn, { backgroundColor: partnerMessage.trim() ? theme.primary : theme.textSecondary, paddingHorizontal: 16 }]}
              onPress={onSend}
              disabled={!partnerMessage.trim()}
            >
              <Text style={ss.btnText}>Send</Text>
            </TouchableOpacity>
          </View>
        </Card>
      </Section>
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  partnerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  partnerInfo: { flex: 1, gap: 2 },
  partnerName: { fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, paddingTop: 12, marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  btn: { paddingVertical: 12, borderRadius: 12 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
