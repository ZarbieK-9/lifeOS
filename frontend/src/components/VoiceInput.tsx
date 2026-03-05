// VoiceInput — Voice input button with animated rings
// Uses expo-speech-recognition for on-device speech-to-text (works offline)
// Supports imperative start via ref (for auto-listen after TTS)

import React, { useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Alert, TouchableOpacity, View, StyleSheet, Animated } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Speech from 'expo-speech';
import { useAppTheme } from '../hooks/useAppTheme';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

export interface VoiceInputHandle {
  startRecording: () => void;
  stopRecording: () => void;
  isRecording: boolean;
}

interface Props {
  onTranscription: (text: string) => void;
  onAutoSend?: (text: string) => void;
}

/** Animated expanding ring behind the mic button. */
function PulseRing({ delay, color }: { delay: number; color: string }) {
  const scale = React.useRef(new Animated.Value(0.8)).current;
  const opacity = React.useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scale, { toValue: 2.2, duration: 1400, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 1400, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 0.8, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.6, duration: 0, useNativeDriver: true }),
        ]),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [delay, scale, opacity]);

  return (
    <Animated.View
      style={[
        ss.ring,
        {
          backgroundColor: color,
          transform: [{ scale }],
          opacity,
        },
      ]}
    />
  );
}

const VoiceInput = forwardRef<VoiceInputHandle, Props>(
  function VoiceInput({ onTranscription, onAutoSend }, ref) {
    const { calm } = useAppTheme();
    const [isRecording, setIsRecording] = React.useState(false);
    const btnScale = React.useRef(new Animated.Value(1)).current;
    const permissionGranted = React.useRef(false);

    // Request permission on mount
    useEffect(() => {
      (async () => {
        const status = await ExpoSpeechRecognitionModule.getPermissionsAsync();
        permissionGranted.current = status.granted;
      })();
    }, []);

    // Speech recognition event handlers
    useSpeechRecognitionEvent('start', () => {
      setIsRecording(true);
    });

    useSpeechRecognitionEvent('end', () => {
      setIsRecording(false);
    });

    useSpeechRecognitionEvent('result', (event) => {
      if (event.isFinal && event.results[0]?.transcript) {
        const text = event.results[0].transcript;
        if (onAutoSend) {
          onAutoSend(text);
        } else {
          onTranscription(text);
        }
      }
    });

    useSpeechRecognitionEvent('error', (event) => {
      console.error('[Voice] Recognition error:', event.error, event.message);
      setIsRecording(false);
      if (event.error === 'no-speech' || event.error === 'speech-timeout') {
        // Silent failure — user just didn't say anything
        return;
      }
      if (event.error === 'not-allowed') {
        Alert.alert(
          'Microphone Access',
          'LifeOS needs microphone and speech recognition permission. Please grant them in your device settings.',
        );
      }
    });

    // Bounce animation on state change
    useEffect(() => {
      Animated.sequence([
        Animated.timing(btnScale, { toValue: 0.85, duration: 80, useNativeDriver: true }),
        Animated.spring(btnScale, { toValue: 1, friction: 3, useNativeDriver: true }),
      ]).start();
    }, [isRecording, btnScale]);

    const ensurePermission = useCallback(async (): Promise<boolean> => {
      if (permissionGranted.current) return true;
      const status = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      permissionGranted.current = status.granted;
      if (!status.granted) {
        Alert.alert(
          'Microphone Access',
          'LifeOS needs microphone and speech recognition permission for voice input. Please grant them in your device settings.',
        );
        return false;
      }
      return true;
    }, []);

    const startRecording = useCallback(async () => {
      const ok = await ensurePermission();
      if (!ok) return;
      try {
        // Stop any TTS before starting recognition
        Speech.stop();
        ExpoSpeechRecognitionModule.start({
          lang: 'en-US',
          interimResults: false,
          continuous: false,
          addsPunctuation: true,
        });
      } catch (e) {
        console.error('[Voice] Failed to start recognition:', e);
        Alert.alert('Voice Error', 'Could not start voice recognition. Please try again.');
      }
    }, [ensurePermission]);

    const stopRecording = useCallback(() => {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch (e) {
        console.error('[Voice] Failed to stop recognition:', e);
      }
    }, []);

    const onPress = useCallback(() => {
      if (isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    }, [isRecording, startRecording, stopRecording]);

    useImperativeHandle(ref, () => ({
      startRecording,
      stopRecording,
      isRecording,
    }), [startRecording, stopRecording, isRecording]);

    const iconName = isRecording ? 'stop' : 'mic';
    const btnBg = isRecording ? calm.coral : calm.teal;

    return (
      <View style={ss.container}>
        {/* Animated rings behind button when recording */}
        {isRecording && (
          <View style={ss.ringsContainer}>
            <PulseRing delay={0} color={calm.coral + '40'} />
            <PulseRing delay={450} color={calm.coral + '30'} />
            <PulseRing delay={900} color={calm.coral + '20'} />
          </View>
        )}

        <Animated.View style={{ transform: [{ scale: btnScale }] }}>
          <TouchableOpacity
            style={[ss.micBtn, { backgroundColor: btnBg }]}
            onPress={onPress}
            activeOpacity={0.7}
          >
            <MaterialIcons name={iconName} size={22} color="#fff" />
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  },
);

export default VoiceInput;

const BTN_SIZE = 44;

const ss = StyleSheet.create({
  container: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ringsContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ring: {
    position: 'absolute',
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
  },
  micBtn: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
});
