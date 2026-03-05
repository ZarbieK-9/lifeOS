// Timeline View — vertical day timeline showing calendar events + time blocks
import React from 'react';
import { View, Text, StyleSheet, ScrollView, Modal, TouchableOpacity } from 'react-native';
import dayjs from 'dayjs';
import { useAppTheme } from '../hooks/useAppTheme';
import type { CalendarEvent, TimeBlock } from '../store/useStore';

interface Props {
  visible: boolean;
  onClose: () => void;
  calendarEvents: CalendarEvent[];
  timeBlocks: TimeBlock[];
}

const START_HOUR = 6;
const END_HOUR = 23;
const HOUR_HEIGHT = 60;

export function TimelineView({ visible, onClose, calendarEvents, timeBlocks }: Props) {
  const { theme } = useAppTheme();
  const now = dayjs();
  const todayStr = now.format('YYYY-MM-DD');

  // Filter to today's events
  const todayEvents = calendarEvents.filter(e =>
    !e.all_day && dayjs(e.start_time).format('YYYY-MM-DD') === todayStr
  );

  const getTop = (time: string) => {
    const d = dayjs(time);
    const hours = d.hour() + d.minute() / 60;
    return Math.max(0, (hours - START_HOUR) * HOUR_HEIGHT);
  };

  const getHeight = (start: string, end: string) => {
    const s = dayjs(start);
    const e = dayjs(end);
    const diffHours = e.diff(s, 'minute') / 60;
    return Math.max(diffHours * HOUR_HEIGHT, 20);
  };

  // Current time indicator position
  const nowTop = getTop(now.toISOString());

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={ss.overlay}>
        <View style={[ss.sheet, { backgroundColor: theme.background }]}>
          {/* Header */}
          <View style={ss.header}>
            <Text style={[ss.title, { color: theme.text }]}>My Day</Text>
            <TouchableOpacity onPress={onClose} style={ss.closeBtn}>
              <Text style={{ color: theme.textSecondary, fontSize: 28 }}>×</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT, position: 'relative' }}>
              {/* Hour gridlines */}
              {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => {
                const hour = START_HOUR + i;
                return (
                  <View key={hour} style={[ss.hourRow, { top: i * HOUR_HEIGHT }]}>
                    <Text style={[ss.hourLabel, { color: theme.textSecondary }]}>
                      {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                    </Text>
                    <View style={[ss.hourLine, { backgroundColor: theme.border + '40' }]} />
                  </View>
                );
              })}

              {/* Calendar events */}
              {todayEvents.map(e => (
                <View key={e.event_id} style={[ss.block, {
                  top: getTop(e.start_time),
                  height: getHeight(e.start_time, e.end_time),
                  backgroundColor: theme.warn + '30',
                  borderLeftColor: theme.warn,
                }]}>
                  <Text style={[ss.blockTitle, { color: theme.warn }]} numberOfLines={1}>{e.summary}</Text>
                  <Text style={[ss.blockTime, { color: theme.textSecondary }]}>
                    {dayjs(e.start_time).format('h:mm')}-{dayjs(e.end_time).format('h:mm A')}
                  </Text>
                </View>
              ))}

              {/* Time blocks */}
              {timeBlocks.map(b => (
                <View key={b.id} style={[ss.block, {
                  top: getTop(b.start_time),
                  height: getHeight(b.start_time, b.end_time),
                  backgroundColor: b.color + '30',
                  borderLeftColor: b.color,
                  left: 60,
                }]}>
                  <Text style={[ss.blockTitle, { color: theme.text }]} numberOfLines={1}>{b.title}</Text>
                  <Text style={[ss.blockTime, { color: theme.textSecondary }]}>
                    {dayjs(b.start_time).format('h:mm')}-{dayjs(b.end_time).format('h:mm A')}
                  </Text>
                </View>
              ))}

              {/* Current time indicator */}
              <View style={[ss.nowLine, { top: nowTop }]}>
                <View style={[ss.nowDot, { backgroundColor: theme.danger }]} />
                <View style={[ss.nowBar, { backgroundColor: theme.danger }]} />
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const ss = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '85%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  closeBtn: { padding: 4 },
  hourRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'flex-start' },
  hourLabel: { width: 50, fontSize: 11, fontWeight: '500', textAlign: 'right', paddingRight: 8 },
  hourLine: { flex: 1, height: 1, marginTop: 6 },
  block: { position: 'absolute', left: 56, right: 8, borderLeftWidth: 3, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, justifyContent: 'center' },
  blockTitle: { fontSize: 13, fontWeight: '600' },
  blockTime: { fontSize: 11 },
  nowLine: { position: 'absolute', left: 50, right: 0, flexDirection: 'row', alignItems: 'center', zIndex: 10 },
  nowDot: { width: 8, height: 8, borderRadius: 4 },
  nowBar: { flex: 1, height: 2 },
});
