// Note Editor Screen — edit note title + body with auto-save
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { useAppTheme } from '../hooks/useAppTheme';
import { Spacing } from '@/constants/theme';

interface Props {
  noteId: string;
  onClose: () => void;
}

const AUTO_SAVE_DELAY = 2000;

export default function NoteEditorScreen({ noteId, onClose }: Props) {
  const { theme } = useAppTheme();
  const notes = useStore(s => s.notes);
  const updateNote = useStore(s => s.updateNote);
  const deleteNote = useStore(s => s.deleteNote);

  const note = notes.find(n => n.id === noteId);

  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [pinned, setPinned] = useState(note?.pinned ?? false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasChanges = useRef(false);

  // Auto-save on changes with debounce
  useEffect(() => {
    if (!hasChanges.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      updateNote(noteId, { title, body, pinned });
      hasChanges.current = false;
    }, AUTO_SAVE_DELAY);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [title, body, pinned, noteId, updateNote]);

  const onChangeTitle = useCallback((text: string) => {
    setTitle(text);
    hasChanges.current = true;
  }, []);

  const onChangeBody = useCallback((text: string) => {
    setBody(text);
    hasChanges.current = true;
  }, []);

  const onTogglePin = useCallback(() => {
    setPinned(prev => !prev);
    hasChanges.current = true;
  }, []);

  // Save immediately on close
  const handleClose = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (hasChanges.current) {
      updateNote(noteId, { title, body, pinned });
    }
    // Delete if completely empty
    if (!title.trim() && !body.trim()) {
      deleteNote(noteId);
    }
    onClose();
  }, [noteId, title, body, pinned, updateNote, deleteNote, onClose]);

  const handleDelete = useCallback(() => {
    Alert.alert('Delete Note', 'Are you sure you want to delete this note?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteNote(noteId); onClose(); } },
    ]);
  }, [noteId, deleteNote, onClose]);

  if (!note) return null;

  return (
    <SafeAreaView style={[ss.fill, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={ss.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={[ss.header, { borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={handleClose} style={ss.headerBtn}>
            <Text style={{ color: theme.primary, fontSize: 16, fontWeight: '600' }}>Done</Text>
          </TouchableOpacity>
          <View style={ss.headerActions}>
            <TouchableOpacity onPress={onTogglePin} style={ss.headerBtn}>
              <Text style={{ fontSize: 18 }}>{pinned ? '📌' : '📍'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDelete} style={ss.headerBtn}>
              <Text style={{ color: theme.danger, fontSize: 14, fontWeight: '600' }}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Meta info */}
        <View style={ss.metaRow}>
          <Text style={[ss.metaText, { color: theme.textSecondary }]}>
            {note.category === 'journal' ? 'Journal' : 'Note'} · {dayjs(note.updated_at).format('MMM D, h:mm A')}
          </Text>
        </View>

        <ScrollView style={ss.fill} keyboardDismissMode="interactive">
          <TextInput
            style={[ss.titleInput, { color: theme.text }]}
            placeholder="Title"
            placeholderTextColor={theme.textSecondary}
            value={title}
            onChangeText={onChangeTitle}
            autoFocus={!title}
          />
          <TextInput
            style={[ss.bodyInput, { color: theme.text }]}
            placeholder="Start writing..."
            placeholderTextColor={theme.textSecondary}
            value={body}
            onChangeText={onChangeBody}
            multiline
            textAlignVertical="top"
            scrollEnabled={false}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.screenPadding, paddingVertical: 10, borderBottomWidth: 1 },
  headerBtn: { padding: 4 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  metaRow: { paddingHorizontal: Spacing.screenPadding, paddingTop: 8 },
  metaText: { fontSize: 12 },
  titleInput: { fontSize: 24, fontWeight: '700', paddingHorizontal: Spacing.screenPadding, paddingTop: 12, paddingBottom: 8 },
  bodyInput: { fontSize: 16, lineHeight: 24, paddingHorizontal: Spacing.screenPadding, paddingBottom: 40, minHeight: 200 },
});
