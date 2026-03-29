// Notes Screen — list of notes + journal entries with search and filter
import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { useAppTheme } from '../hooks/useAppTheme';
import { PressableScale } from '@/components/PressableScale';
import { Spacing, Radii } from '@/constants/theme';
import type { Note } from '../store/useStore';

type FilterTab = 'all' | 'note' | 'journal';

export default function NotesScreen({ onOpenEditor }: { onOpenEditor: (noteId: string | null) => void }) {
  const { theme } = useAppTheme();
  const notes = useStore(s => s.notes);
  const deleteNote = useStore(s => s.deleteNote);
  const updateNote = useStore(s => s.updateNote);
  const addNote = useStore(s => s.addNote);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterTab>('all');

  const filtered = useMemo(() => {
    let list = [...notes];

    // Filter by category
    if (filter !== 'all') {
      list = list.filter(n => n.category === filter);
    }

    // Search by title and body
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(n =>
        n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)
      );
    }

    // Sort: pinned first, then by updated_at DESC
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updated_at.localeCompare(a.updated_at);
    });

    return list;
  }, [notes, filter, search]);

  const onNewNote = useCallback(async () => {
    const id = await addNote('', '', filter === 'journal' ? 'journal' : 'note');
    onOpenEditor(id);
  }, [addNote, filter, onOpenEditor]);

  const renderNote = useCallback(({ item }: { item: Note }) => {
    const preview = item.body.split('\n')[0]?.slice(0, 100) || 'Empty note';
    const dateStr = dayjs(item.updated_at).format('MMM D, h:mm A');
    return (
      <TouchableOpacity
        style={[ss.noteRow, { backgroundColor: theme.surface }]}
        activeOpacity={0.7}
        onPress={() => onOpenEditor(item.id)}
      >
        <View style={ss.noteContent}>
          <View style={ss.noteHeader}>
            {item.pinned ? <Text style={{ fontSize: 12 }}>📌</Text> : null}
            <Text style={[ss.noteTitle, { color: theme.text }]} numberOfLines={1}>
              {item.title || 'Untitled'}
            </Text>
            <View style={[ss.categoryBadge, {
              backgroundColor: item.category === 'journal' ? theme.warnBg : theme.primaryBg,
            }]}>
              <Text style={{
                fontSize: 10, fontWeight: '600',
                color: item.category === 'journal' ? theme.warn : theme.primary,
              }}>
                {item.category === 'journal' ? 'Journal' : 'Note'}
              </Text>
            </View>
          </View>
          <Text style={[ss.notePreview, { color: theme.textSecondary }]} numberOfLines={1}>
            {preview}
          </Text>
          <Text style={[ss.noteDate, { color: theme.textSecondary }]}>{dateStr}</Text>
        </View>
      </TouchableOpacity>
    );
  }, [theme, onOpenEditor]);

  return (
    <SafeAreaView style={[ss.fill, { backgroundColor: theme.background }]} edges={['top', 'left', 'right', 'bottom']}>
      {/* Search bar */}
      <View style={[ss.searchRow, { borderBottomColor: theme.border }]}>
        <TextInput
          style={[ss.searchInput, { backgroundColor: theme.surface, color: theme.text }]}
          placeholder="Search notes..."
          placeholderTextColor={theme.textSecondary}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Filter tabs */}
      <View style={ss.filterRow}>
        {(['all', 'note', 'journal'] as FilterTab[]).map(tab => (
          <PressableScale
            key={tab}
            style={[ss.filterTab, {
              backgroundColor: filter === tab ? theme.primary : theme.surface,
            }]}
            onPress={() => setFilter(tab)}
          >
            <Text style={{
              fontSize: 13, fontWeight: '600',
              color: filter === tab ? '#fff' : theme.textSecondary,
            }}>
              {tab === 'all' ? 'All' : tab === 'note' ? 'Notes' : 'Journal'}
            </Text>
          </PressableScale>
        ))}
      </View>

      {/* Notes list */}
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderNote}
        contentContainerStyle={ss.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={ss.empty}>
            <Text style={[ss.emptyText, { color: theme.textSecondary }]}>
              {search ? 'No notes match your search' : 'No notes yet'}
            </Text>
          </View>
        }
      />

      {/* FAB to create new note */}
      <PressableScale style={[ss.fab, { backgroundColor: theme.primary }]} onPress={onNewNote}>
        <Text style={ss.fabText}>+</Text>
      </PressableScale>
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  fill: { flex: 1 },
  searchRow: { paddingHorizontal: Spacing.screenPadding, paddingVertical: 8, borderBottomWidth: 1 },
  searchInput: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: Spacing.screenPadding, paddingVertical: 10 },
  filterTab: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
  list: { padding: Spacing.screenPadding, paddingBottom: 100 },
  noteRow: { borderRadius: 14, padding: 14, marginBottom: 10 },
  noteContent: { gap: 4 },
  noteHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noteTitle: { fontSize: 15, fontWeight: '600', flex: 1 },
  categoryBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  notePreview: { fontSize: 13 },
  noteDate: { fontSize: 11 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 15 },
  fab: { position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4 },
  fabText: { color: '#fff', fontSize: 28, fontWeight: '600', marginTop: -2 },
});
