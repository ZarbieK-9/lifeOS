// Quick Capture FAB — floating action button for instant thought capture
import React, { useState, useRef } from 'react';
import { View, Text, TextInput, StyleSheet, Animated, Keyboard } from 'react-native';
import { PressableScale } from '@/components/PressableScale';
import { useStore } from '../store/useStore';
import { useAppTheme } from '../hooks/useAppTheme';
import { useHaptics } from '../hooks/useHaptics';

export function QuickCaptureButton() {
  const { theme } = useAppTheme();
  const haptic = useHaptics();
  const addInboxItem = useStore(s => s.addInboxItem);
  const untriagedCount = useStore(s => s.inboxItems.filter(i => !i.triaged).length);

  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const onToggle = () => {
    if (expanded) {
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
        setExpanded(false);
        Keyboard.dismiss();
      });
    } else {
      setExpanded(true);
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start(() => {
        inputRef.current?.focus();
      });
    }
  };

  const onSubmit = async () => {
    if (!text.trim()) return;
    haptic.success();
    await addInboxItem(text.trim());
    setText('');
    onToggle();
  };

  return (
    <View style={ss.container} pointerEvents="box-none">
      {expanded && (
        <Animated.View style={[ss.inputBox, { backgroundColor: theme.surface, borderColor: theme.border, opacity: fadeAnim }]}>
          <TextInput
            ref={inputRef}
            style={[ss.input, { color: theme.text }]}
            placeholder="Capture a thought..."
            placeholderTextColor={theme.textSecondary}
            value={text}
            onChangeText={setText}
            onSubmitEditing={onSubmit}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <PressableScale style={[ss.sendBtn, { backgroundColor: text.trim() ? theme.primary : theme.border }]} onPress={onSubmit}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>↑</Text>
          </PressableScale>
        </Animated.View>
      )}
      <PressableScale style={[ss.fab, { backgroundColor: theme.primary }]} onPress={onToggle}>
        <Text style={ss.fabIcon}>{expanded ? '×' : '+'}</Text>
        {!expanded && untriagedCount > 0 && (
          <View style={[ss.fabBadge, { backgroundColor: theme.danger }]}>
            <Text style={ss.fabBadgeText}>{untriagedCount}</Text>
          </View>
        )}
      </PressableScale>
    </View>
  );
}

const ss = StyleSheet.create({
  container: { position: 'absolute', bottom: 90, right: 20, alignItems: 'flex-end', gap: 10 },
  inputBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 16, paddingLeft: 16, paddingRight: 4, width: 280, paddingVertical: 4 },
  input: { flex: 1, fontSize: 15, paddingVertical: 10 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  fab: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 5 },
  fabIcon: { color: '#fff', fontSize: 28, fontWeight: '300' },
  fabBadge: { position: 'absolute', top: -2, right: -2, width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  fabBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
