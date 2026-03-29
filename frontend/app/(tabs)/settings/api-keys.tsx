import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Share, Alert } from 'react-native';
import dayjs from 'dayjs';
import { useStore } from '@/src/store/useStore';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { useHaptics } from '@/src/hooks/useHaptics';
import { api } from '@/src/services/api';
import { ScreenContainer, Section, ScreenHeader } from '@/src/components/layout';
import { Card } from '@/src/components/Card';

export default function SettingsApiKeysScreen() {
  const { theme } = useAppTheme();
  const haptic = useHaptics();
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const [apiKeys, setApiKeys] = useState<Array<{ key_id: string; name: string; created_at: string; last_used: string; key_prefix: string }>>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) api.listApiKeys().then((r) => { if (r.ok) setApiKeys(r.data.keys); });
  }, [isAuthenticated]);

  const onCreate = async () => {
    if (!newKeyName.trim()) { Alert.alert('Error', 'Enter a name for this key (e.g., "Tasker")'); return; }
    setLoading(true);
    haptic.light();
    const result = await api.createApiKey(newKeyName.trim());
    setLoading(false);
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
      await Share.share({ message: createdKey });
      haptic.success();
      setCreatedKey(null);
    }
  };

  const onRevoke = (keyId: string, name: string) => {
    Alert.alert('Revoke Key', `Revoke "${name}"? External services using this key will stop working.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: async () => { haptic.light(); await api.revokeApiKey(keyId); setApiKeys((prev) => prev.filter((k) => k.key_id !== keyId)); } },
    ]);
  };

  if (!isAuthenticated) {
    return (
      <ScreenContainer scroll keyboardAvoiding keyboardVerticalOffset={8} header={<ScreenHeader title="API keys" />}>
        <Card variant="outlined">
          <Text style={[ss.hint, { color: theme.textSecondary }]}>Sign in to create and manage API keys.</Text>
        </Card>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll keyboardAvoiding keyboardVerticalOffset={8} header={<ScreenHeader title="API keys" />}>
      <Section title="External integrations" description="Connect Tasker, IFTTT, or Google Assistant.">
        <Card variant="outlined">
          {apiKeys.map((k) => (
            <View key={k.key_id} style={[ss.row, { borderTopWidth: 1, borderColor: theme.border, paddingTop: 8 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[ss.label, { color: theme.text }]}>{k.name}</Text>
                <Text style={[ss.hint, { color: theme.textSecondary }]}>{k.key_prefix}... {k.last_used ? `Used ${dayjs(k.last_used).format('MMM D, h:mm A')}` : 'Never used'}</Text>
              </View>
              <TouchableOpacity style={[ss.btn, { backgroundColor: theme.danger, paddingHorizontal: 16 }]} onPress={() => onRevoke(k.key_id, k.name)}>
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
          <TouchableOpacity style={[ss.btn, { backgroundColor: theme.primary }, { marginTop: 8 }]} onPress={onCreate} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={ss.btnText}>Generate API Key</Text>}
          </TouchableOpacity>
          {createdKey && (
            <View style={[ss.keyBox, { backgroundColor: theme.warnBg }]}>
              <Text style={[ss.warnText, { color: theme.warn }]}>Copy this key now — it will not be shown again</Text>
              <Text style={[ss.mono, { color: theme.text }]} selectable>{createdKey}</Text>
              <TouchableOpacity style={[ss.btn, { backgroundColor: theme.warn }, { marginTop: 8 }]} onPress={onCopyKey}>
                <Text style={ss.btnText}>Share / Copy</Text>
              </TouchableOpacity>
            </View>
          )}
          <Text style={[ss.hint, { color: theme.textSecondary }, { marginTop: 12 }]}>Webhook: POST /v1/webhook/command with X-API-Key header</Text>
        </Card>
      </Section>
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 16, fontWeight: '500' },
  hint: { fontSize: 13 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  btn: { alignItems: 'center', paddingVertical: 12, borderRadius: 12 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  keyBox: { borderRadius: 8, padding: 12, marginTop: 12 },
  warnText: { fontSize: 12, fontWeight: '600' },
  mono: { fontFamily: 'monospace', fontSize: 11, marginTop: 4 },
});
