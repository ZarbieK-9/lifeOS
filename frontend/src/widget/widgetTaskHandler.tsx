// Widget task handler — registered in app entry point
// Handles widget render requests from the Android widget system

import React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import LifeOSWidget from './LifeOSWidget';

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
    case 'WIDGET_CLICK':
      props.renderWidget(<LifeOSWidget />);
      break;
    default:
      break;
  }
}
