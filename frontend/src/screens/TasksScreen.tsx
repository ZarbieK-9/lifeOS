// Tasks screen — UI_UX.md §3.2
// CRUD with filters (pending/completed/overdue), swipe actions, offline-first

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  Modal, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import dayjs from 'dayjs';
import { useStore, Task } from '../store/useStore';
import { useAppTheme } from '../hooks/useAppTheme';
import { useHaptics } from '../hooks/useHaptics';

type Filter = 'all' | 'pending' | 'completed' | 'overdue';

export default function TasksScreen() {
  const { screen: c } = useAppTheme();
  const haptic = useHaptics();

  const tasks = useStore(s => s.tasks);
  const addTask = useStore(s => s.addTask);
  const updateTask = useStore(s => s.updateTask);
  const deleteTask = useStore(s => s.deleteTask);
  const init = useStore(s => s.init);

  const [filter, setFilter] = useState<Filter>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<Task['priority']>('medium');
  const [newNotes, setNewNotes] = useState('');
  const [newDueDate, setNewDueDate] = useState<string | null>(null);
  const [newRecurrence, setNewRecurrence] = useState<string | null>(null);

  useEffect(() => { init(); }, [init]);

  const filtered = tasks.filter(t => {
    if (filter === 'all') return true;
    return t.status === filter;
  });

  const onAdd = useCallback(async () => {
    if (!newTitle.trim()) return;
    haptic.success();
    await addTask(newTitle.trim(), newPriority, newDueDate, newNotes.trim(), newRecurrence);
    setNewTitle('');
    setNewNotes('');
    setNewPriority('medium');
    setNewDueDate(null);
    setNewRecurrence(null);
    setShowAdd(false);
  }, [newTitle, newPriority, newDueDate, newNotes, newRecurrence, addTask, haptic]);

  const onToggle = useCallback(async (task: Task) => {
    haptic.light();
    const next = task.status === 'completed' ? 'pending' : 'completed';
    await updateTask(task.task_id, { status: next });
  }, [updateTask, haptic]);

  const onDelete = useCallback((task: Task) => {
    Alert.alert('Delete Task', `Delete "${task.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        haptic.warning();
        await deleteTask(task.task_id);
      }},
    ]);
  }, [deleteTask, haptic]);

  const priorityColor = (p: string) =>
    p === 'high' ? c.danger : p === 'medium' ? c.warn : c.sub;

  const renderTask = ({ item }: { item: Task }) => (
    <View style={[ss.taskRow, { backgroundColor: c.surface, borderColor: c.border }]}>
      <TouchableOpacity
        style={[ss.check, {
          borderColor: item.status === 'completed' ? c.success : c.border,
          backgroundColor: item.status === 'completed' ? c.success : 'transparent',
        }]}
        onPress={() => onToggle(item)}
      >
        {item.status === 'completed' && <Text style={ss.checkMark}>✓</Text>}
      </TouchableOpacity>
      <View style={ss.taskBody}>
        <Text style={[
          ss.taskTitle,
          { color: c.text },
          item.status === 'completed' && ss.strikethrough,
        ]}>
          {item.title}
        </Text>
        <View style={ss.taskMeta}>
          <View style={[ss.priBadge, { backgroundColor: priorityColor(item.priority) + '22' }]}>
            <Text style={[ss.priText, { color: priorityColor(item.priority) }]}>{item.priority}</Text>
          </View>
          {item.due_date && (
            <Text style={[ss.dueText, { color: c.sub }]}>
              {dayjs(item.due_date).format('MMM D')}
            </Text>
          )}
          {item.recurrence && (
            <View style={[ss.priBadge, { backgroundColor: c.primary + '22' }]}>
              <Text style={[ss.priText, { color: c.primary }]}>{item.recurrence}</Text>
            </View>
          )}
        </View>
      </View>
      <TouchableOpacity onPress={() => onDelete(item)} style={ss.delBtn}>
        <Text style={[ss.delText, { color: c.danger }]}>×</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={[ss.fill, { backgroundColor: c.bg }]}>
      <View style={ss.header}>
        <Text style={[ss.title, { color: c.text }]}>Tasks</Text>
        <TouchableOpacity
          style={[ss.addBtn, { backgroundColor: c.primary }]}
          onPress={() => { haptic.light(); setShowAdd(true); }}
        >
          <Text style={ss.addBtnText}>+ New</Text>
        </TouchableOpacity>
      </View>

      {/* Filters — UI_UX.md §3.2 */}
      <View style={ss.filters}>
        {(['all', 'pending', 'completed', 'overdue'] as Filter[]).map(f => (
          <TouchableOpacity
            key={f}
            style={[ss.filterBtn, { backgroundColor: filter === f ? c.primary : c.primaryBg }]}
            onPress={() => { haptic.light(); setFilter(f); }}
          >
            <Text style={[ss.filterText, { color: filter === f ? '#fff' : c.sub }]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={t => t.task_id}
        renderItem={renderTask}
        contentContainerStyle={ss.list}
        ListEmptyComponent={
          <View style={ss.empty}>
            <Text style={[ss.emptyText, { color: c.sub }]}>No tasks yet</Text>
          </View>
        }
      />

      {/* Add task modal — UI_UX.md §3.2 task detail modal */}
      <Modal visible={showAdd} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={ss.modalBg}
        >
          <View style={[ss.modal, { backgroundColor: c.bg }]}>
           <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={[ss.modalTitle, { color: c.text }]}>New Task</Text>

            <TextInput
              style={[ss.input, { backgroundColor: c.surface, color: c.text, borderColor: c.border }]}
              placeholder="Task title"
              placeholderTextColor={c.sub}
              value={newTitle}
              onChangeText={setNewTitle}
              autoFocus
            />

            <TextInput
              style={[ss.input, ss.notesInput, { backgroundColor: c.surface, color: c.text, borderColor: c.border }]}
              placeholder="Notes (optional)"
              placeholderTextColor={c.sub}
              value={newNotes}
              onChangeText={setNewNotes}
              multiline
            />

            <Text style={[ss.label, { color: c.sub }]}>Priority</Text>
            <View style={ss.priRow}>
              {(['low', 'medium', 'high'] as const).map(p => (
                <TouchableOpacity
                  key={p}
                  style={[ss.priBtn, { backgroundColor: c.primaryBg }, newPriority === p && { backgroundColor: priorityColor(p) }]}
                  onPress={() => setNewPriority(p)}
                >
                  <Text style={[ss.priBtnText, { color: c.sub }, newPriority === p && { color: '#fff' }]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[ss.label, { color: c.sub }]}>Due Date</Text>
            <View style={ss.priRow}>
              {([
                { label: 'Today', value: dayjs().endOf('day').toISOString() },
                { label: 'Tomorrow', value: dayjs().add(1, 'day').endOf('day').toISOString() },
                { label: 'Next Week', value: dayjs().add(1, 'week').startOf('day').toISOString() },
                { label: 'None', value: null },
              ] as const).map(d => (
                <TouchableOpacity
                  key={d.label}
                  style={[ss.priBtn, { backgroundColor: c.primaryBg }, newDueDate === d.value && { backgroundColor: c.primary }]}
                  onPress={() => setNewDueDate(d.value)}
                >
                  <Text style={[ss.priBtnText, { color: c.sub }, newDueDate === d.value && { color: '#fff' }]}>{d.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[ss.label, { color: c.sub }]}>Repeat</Text>
            <View style={[ss.priRow, { flexWrap: 'wrap' }]}>
              {([
                { label: 'None', value: null },
                { label: 'Daily', value: 'daily' },
                { label: 'Weekdays', value: 'every weekday' },
                { label: 'Weekly', value: 'weekly' },
              ] as const).map(r => (
                <TouchableOpacity
                  key={r.label}
                  style={[ss.priBtn, { backgroundColor: c.primaryBg }, newRecurrence === r.value && { backgroundColor: c.primary }]}
                  onPress={() => {
                    setNewRecurrence(r.value);
                    // Auto-set due date to today if recurring and no date set
                    if (r.value && !newDueDate) setNewDueDate(dayjs().endOf('day').toISOString());
                  }}
                >
                  <Text style={[ss.priBtnText, { color: c.sub }, newRecurrence === r.value && { color: '#fff' }]}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={ss.modalActions}>
              <TouchableOpacity style={ss.cancelBtn} onPress={() => setShowAdd(false)}>
                <Text style={[ss.cancelText, { color: c.sub }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[ss.saveBtn, { backgroundColor: c.primary }]}
                onPress={onAdd}
              >
                <Text style={ss.saveBtnText}>Add Task</Text>
              </TouchableOpacity>
            </View>
           </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  addBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  addBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 12 },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  filterText: { fontSize: 13, fontWeight: '600' },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  taskRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8, gap: 12 },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  checkMark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  taskBody: { flex: 1, gap: 4 },
  taskTitle: { fontSize: 16, fontWeight: '500' },
  strikethrough: { textDecorationLine: 'line-through', opacity: 0.5 },
  taskMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  priText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  dueText: { fontSize: 12 },
  delBtn: { padding: 4 },
  delText: { fontSize: 24, fontWeight: '300' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 16 },
  modalBg: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' },
  modal: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  modalTitle: { fontSize: 22, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 },
  notesInput: { height: 80, textAlignVertical: 'top' },
  label: { fontSize: 14, fontWeight: '600' },
  priRow: { flexDirection: 'row', gap: 10 },
  priBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: '#e2e8f033' },
  priBtnText: { fontSize: 14, fontWeight: '600', textTransform: 'capitalize', color: '#687076' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  cancelText: { fontSize: 16, fontWeight: '600' },
  saveBtn: { flex: 2, alignItems: 'center', paddingVertical: 14, borderRadius: 14 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
