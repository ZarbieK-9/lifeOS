import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert } from 'react-native';
import dayjs from 'dayjs';
import { useStore } from '@/src/store/useStore';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { useHaptics } from '@/src/hooks/useHaptics';
import { ScreenContainer, Section, ScreenHeader } from '@/src/components/layout';
import { Card } from '@/src/components/Card';

export default function SettingsMemoryScreen() {
  const { theme } = useAppTheme();
  const haptic = useHaptics();
  const aiMemories = useStore((s) => s.aiMemories);
  const deleteAiMemory = useStore((s) => s.deleteAiMemory);
  const updateAiMemory = useStore((s) => s.updateAiMemory);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryText, setEditingMemoryText] = useState('');

  return (
    <ScreenContainer scroll keyboardAvoiding keyboardVerticalOffset={8} header={<ScreenHeader title="AI memory" />}>
      <Section title="Stored memories" description="Facts the AI has learned about you from conversations.">
        <Card variant="outlined">
          {aiMemories.length === 0 ? (
            <Text style={[ss.hint, { color: theme.textSecondary }]}>No memories yet. Chat with PicoClaw and it will remember things about you.</Text>
          ) : (
            aiMemories.map((m) => (
              <View key={m.id} style={[ss.memoryRow, { borderColor: theme.border }]}>
                {editingMemoryId === m.id ? (
                  <View style={{ flex: 1, gap: 8 }}>
                    <TextInput
                      style={[ss.input, { color: theme.text, borderColor: theme.border }]}
                      value={editingMemoryText}
                      onChangeText={setEditingMemoryText}
                      multiline
                      autoFocus
                    />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        style={[ss.chipBtn, { backgroundColor: theme.primary }]}
                        onPress={async () => {
                          if (editingMemoryText.trim()) { await updateAiMemory(m.id, editingMemoryText.trim()); haptic.success(); }
                          setEditingMemoryId(null);
                        }}
                      >
                        <Text style={[ss.chipBtnText, { color: '#fff' }]}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[ss.chipBtn, { backgroundColor: theme.border }]} onPress={() => setEditingMemoryId(null)}>
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
                        <Text style={{ color: theme.textSecondary, fontSize: 11 }}>{dayjs(m.created_at).format('MMM D')}</Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => { haptic.light(); setEditingMemoryId(m.id); setEditingMemoryText(m.fact); }} style={{ padding: 6 }}>
                      <Text style={{ color: theme.primary, fontSize: 13 }}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        Alert.alert('Delete memory', `Remove "${m.fact.slice(0, 50)}..."?`, [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Delete', style: 'destructive', onPress: async () => { haptic.warning(); await deleteAiMemory(m.id); } },
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
        </Card>
      </Section>
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  hint: { fontSize: 13 },
  input: { borderWidth: 1, borderRadius: 10, padding: 14, fontSize: 14 },
  memoryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderTopWidth: 1, paddingTop: 8, paddingBottom: 4 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  typeText: { fontSize: 12, fontWeight: '600' },
  chipBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  chipBtnText: { fontSize: 13, fontWeight: '600' },
});
