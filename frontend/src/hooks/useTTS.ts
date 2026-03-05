// useTTS — Text-to-speech hook wrapping expo-speech
// Strips markdown before speaking, tracks speaking state, fires onDone for auto-listen

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';

/**
 * Strip markdown/formatting so TTS reads natural text.
 * Removes headings, bold, italic, links, code blocks, bullet points, etc.
 */
function stripMarkdown(text: string): string {
  return text
    // Code blocks (fenced)
    .replace(/```[\s\S]*?```/g, '')
    // Inline code
    .replace(/`([^`]+)`/g, '$1')
    // Images
    .replace(/!\[.*?\]\(.*?\)/g, '')
    // Links — keep text
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
    // Headings
    .replace(/^#{1,6}\s+/gm, '')
    // Bold/italic
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
    // Strikethrough
    .replace(/~~([^~]+)~~/g, '$1')
    // Bullet / numbered lists — strip marker
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // HTML tags
    .replace(/<[^>]+>/g, '')
    // Collapse whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface UseTTSOptions {
  /** Called when speech finishes (for auto-listen cycle). */
  onDone?: () => void;
  /** Speech rate (0.5 = slow, 1 = normal, 1.5 = fast). Default 1.0. */
  rate?: number;
  /** Speech pitch (0.5 = low, 1 = normal, 2 = high). Default 1.0. */
  pitch?: number;
}

export function useTTS(options: UseTTSOptions = {}) {
  const { onDone, rate = 1.0, pitch = 1.0 } = options;
  const [isSpeaking, setIsSpeaking] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Stop speech on unmount
  useEffect(() => {
    return () => {
      Speech.stop();
    };
  }, []);

  const speak = useCallback(
    (text: string) => {
      const cleaned = stripMarkdown(text);
      if (!cleaned) return;

      // Stop any current speech first
      Speech.stop();

      setIsSpeaking(true);
      Speech.speak(cleaned, {
        rate,
        pitch,
        onDone: () => {
          setIsSpeaking(false);
          onDoneRef.current?.();
        },
        onStopped: () => {
          setIsSpeaking(false);
        },
        onError: () => {
          setIsSpeaking(false);
        },
      });
    },
    [rate, pitch],
  );

  const stop = useCallback(() => {
    Speech.stop();
    setIsSpeaking(false);
  }, []);

  return { speak, stop, isSpeaking };
}
