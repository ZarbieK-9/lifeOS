// Android Home Screen Widget — shows daily score, hydration, streak, and next event
// Uses react-native-android-widget FlexWidget for layout

import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { ColorProp } from 'react-native-android-widget';
import { kv } from '../db/mmkv';
import dayjs from 'dayjs';

const C = {
  bg: '#1a2f2c' as ColorProp,
  surface: '#223a36' as ColorProp,
  primary: '#5a8f86' as ColorProp,
  text: '#e8f0ee' as ColorProp,
  textSub: '#8fa8a3' as ColorProp,
  success: '#4ade80' as ColorProp,
  warn: '#fbbf24' as ColorProp,
};

function LifeOSWidget() {
  const hydration = kv.getNumber('hydration_today') ?? 0;
  const goal = kv.getNumber('hydration_goal_ml') ?? 2500;
  const hydPct = Math.min(Math.round((hydration / goal) * 100), 100);
  const streak = kv.getNumber('current_streak') ?? 0;
  const score = kv.getNumber('daily_score') ?? 0;

  let nextEvent = '';
  try {
    const cached = kv.getString('widget_next_event');
    if (cached) nextEvent = cached;
  } catch { /* ignore */ }

  const timeStr = dayjs().format('h:mm A');

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        flex: 1,
        flexDirection: 'column',
        backgroundColor: C.bg,
        borderRadius: 20,
        padding: 16,
        flexGap: 8,
      }}
    >
      {/* Header */}
      <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <TextWidget
          text="LifeOS"
          style={{ fontSize: 16, fontWeight: 'bold', color: C.primary }}
        />
        <TextWidget
          text={timeStr}
          style={{ fontSize: 12, color: C.textSub }}
        />
      </FlexWidget>

      {/* Score + Streak row */}
      <FlexWidget style={{ flexDirection: 'row', flexGap: 12, alignItems: 'center' }}>
        <FlexWidget
          style={{
            flex: 1,
            backgroundColor: C.surface,
            borderRadius: 12,
            padding: 10,
            alignItems: 'center',
          }}
        >
          <TextWidget
            text={`${score}`}
            style={{ fontSize: 28, fontWeight: 'bold', color: score >= 80 ? C.success : C.primary }}
          />
          <TextWidget
            text="Daily Score"
            style={{ fontSize: 11, color: C.textSub }}
          />
        </FlexWidget>
        <FlexWidget
          style={{
            flex: 1,
            backgroundColor: C.surface,
            borderRadius: 12,
            padding: 10,
            alignItems: 'center',
          }}
        >
          <TextWidget
            text={streak > 0 ? `${streak}` : '--'}
            style={{ fontSize: 28, fontWeight: 'bold', color: C.warn }}
          />
          <TextWidget
            text="Day Streak"
            style={{ fontSize: 11, color: C.textSub }}
          />
        </FlexWidget>
      </FlexWidget>

      {/* Hydration bar */}
      <FlexWidget style={{ flexGap: 4 }}>
        <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <TextWidget
            text={`${hydration}ml`}
            style={{ fontSize: 13, color: C.text }}
          />
          <TextWidget
            text={`${hydPct}%`}
            style={{ fontSize: 13, color: hydPct >= 100 ? C.success : C.primary }}
          />
        </FlexWidget>
        <FlexWidget
          style={{
            height: 6,
            backgroundColor: C.surface,
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <FlexWidget
            style={{
              width: Math.round((hydPct / 100) * 220),
              height: 6,
              backgroundColor: hydPct >= 100 ? C.success : C.primary,
              borderRadius: 3,
            }}
          />
        </FlexWidget>
      </FlexWidget>

      {/* Next event */}
      {nextEvent ? (
        <TextWidget
          text={nextEvent}
          style={{ fontSize: 12, color: C.textSub }}
          maxLines={1}
          truncate="END"
        />
      ) : null}
    </FlexWidget>
  );
}

export default LifeOSWidget;
