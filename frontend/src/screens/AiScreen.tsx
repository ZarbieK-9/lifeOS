// AI chat — PicoClaw with gradient, avatars, correct message order, keyboard-aware

import { PressableScale } from "@/components/PressableScale";
import { CALM, Typography } from "@/constants/theme";
import dayjs from "dayjs";
import * as Clipboard from "expo-clipboard";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Easing,
  FlatList,
  Image,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { run, runVoiceCommand, cleanOutput } from "../agent/agent";
import MarkdownOutput from "../components/MarkdownOutput";
import VoiceInput, { type VoiceInputHandle } from "../components/VoiceInput";
import { useAppTheme } from "../hooks/useAppTheme";
import { useTTS } from "../hooks/useTTS";
import { useHaptics } from "../hooks/useHaptics";
import { markUserAiInteraction } from "../hooks/useProactiveAI";
import { useStore, type AiCommand } from "../store/useStore";
import { extractSuggestedReply } from "../utils/suggestedReply";

function PendingDots() {
  const theme = useColorScheme();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  const opacity = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 1],
  });
  const calmDot = theme === "dark" ? CALM.dark : CALM.light;
  return (
    <View style={ss.dotsRow}>
      {[0, 1, 2].map((i) => (
        <Animated.Text
          key={i}
          style={[ss.dotsDot, { color: calmDot.textSecondary, opacity }]}
        >
          .
        </Animated.Text>
      ))}
    </View>
  );
}

const LOGO_IMAGE = require("../../assets/images/logo.jpg");

const proactiveLabel = (source: AiCommand["source"]) => {
  switch (source) {
    case "morning":
      return "Morning Briefing";
    case "checkin":
      return "Check-in";
    case "evening":
      return "Evening Reflection";
    case "calendar_alert":
      return "Calendar Alert";
    case "calendar_gap":
      return "Free Time";
    case "email_alert":
      return "New Email";
    case "notification_alert":
      return "App Notification";
    default:
      return null;
  }
};

export default function AiScreen() {
  const { calm, theme, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const haptic = useHaptics();

  const isOnline = useStore((s) => s.isOnline);
  const queueCount = useStore((s) => s.queueCount);
  const isGoogleConnected = useStore((s) => s.isGoogleConnected);
  const notificationListenerEnabled = useStore((s) => s.notificationListenerEnabled);
  const commands = useStore((s) => s.aiCommands);
  const addCmd = useStore((s) => s.addAiCommand);
  const resolveCmd = useStore((s) => s.resolveAiCommand);
  const init = useStore((s) => s.init);
  const routines = useStore((s) => s.routines);
  const llmFastModelStatus = useStore((s) => s.llmFastModelStatus);
  const llmFastDownloadProgress = useStore((s) => s.llmFastDownloadProgress);
  const llmModelStatus = useStore((s) => s.llmModelStatus);
  const llmDownloadProgress = useStore((s) => s.llmDownloadProgress);
  const llmStreamingText = useStore((s) => s.llmStreamingText);
  const chatSessions = useStore((s) => s.chatSessions);
  const currentChatId = useStore((s) => s.currentChatId);
  const addChatSession = useStore((s) => s.addChatSession);
  const setCurrentChat = useStore((s) => s.setCurrentChat);
  const loadChatSessions = useStore((s) => s.loadChatSessions);

  // Agentic system
  const watcherQueueCount = useStore((s) => s.watcherQueue.filter(n => !n.read).length);
  const activeGoalCount = useStore((s) => s.goals.filter(g => g.status === 'active').length);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Show download banner for whichever model is downloading
  const isDownloading = llmFastModelStatus === "downloading" || llmModelStatus === "downloading";
  const downloadLabel = llmFastModelStatus === "downloading" ? "chat model" : "reasoning model";
  const downloadProgress = llmFastModelStatus === "downloading" ? llmFastDownloadProgress : llmDownloadProgress;

  const [input, setInput] = useState("");
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceInFlightRef = useRef(false);
  const lastVoiceSendRef = useRef<{ text: string; ts: number }>({ text: '', ts: 0 });
  const listRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const voiceRef = useRef<VoiceInputHandle>(null);

  // TTS — speaks AI responses in voice conversation mode
  const tts = useTTS({
    onDone: () => {
      // After PicoClaw finishes speaking, auto-listen for next input
      if (voiceMode) {
        setTimeout(() => voiceRef.current?.startRecording(), 300);
      }
    },
  });

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    loadChatSessions();
  }, [loadChatSessions, currentChatId]);

  // Preload calendar & Gmail modules when Google is connected so first tool use doesn't trigger on-demand bundle
  useEffect(() => {
    if (!isGoogleConnected) return;
    import("../services/google-calendar").catch(() => {});
    import("../services/google-gmail").catch(() => {});
  }, [isGoogleConnected]);

  const onSend = useCallback(
    async (textOverride?: string, speakResponse = false) => {
      const text = (textOverride ?? input).trim();
      if (!text) return;
      if (!textOverride) haptic.light();
      setInput("");

      const sendTag = `[AiScreen onSend] "${text.slice(0, 30)}"`;
      console.time(sendTag);

      markUserAiInteraction();
      console.time(`${sendTag} addCmd`);
      const cmdId = await addCmd(text);
      console.timeEnd(`${sendTag} addCmd`);

      try {
        console.log(`${sendTag} calling run()`);
        console.time(`${sendTag} run()`);
        const response = speakResponse
          ? await runVoiceCommand(text, { cmdId, handsFree: true })
          : await run(text, routines, { cmdId });
        console.timeEnd(`${sendTag} run()`);

        haptic.success();
        console.time(`${sendTag} resolveCmd`);
        await resolveCmd(cmdId, response.output, "executed");
        console.timeEnd(`${sendTag} resolveCmd`);
        console.timeEnd(sendTag);

        // Speak response in voice conversation mode
        if (speakResponse) {
          const cleaned = cleanOutput(response.output);
          if (cleaned) tts.speak(cleaned);
        }
      } catch (e) {
        console.timeEnd(sendTag);
        console.error("[PicoClaw] Agent error:", e);
        await resolveCmd(
          cmdId,
          `Error processing command: "${text}"`,
          "failed",
        );
        // Exit voice mode on error
        if (speakResponse) setVoiceMode(false);
      }
    },
    [input, routines, addCmd, resolveCmd, haptic, tts],
  );

  const onCopySuggestedReply = useCallback(
    async (cmd: AiCommand) => {
      const reply = cmd.output ? extractSuggestedReply(cleanOutput(cmd.output)) : null;
      if (reply) {
        await Clipboard.setStringAsync(reply);
        haptic.success();
      }
    },
    [haptic],
  );

  const addTask = useStore((s) => s.addTask);
  const onAddAsTask = useCallback(
    async (cmd: AiCommand) => {
      const title = cmd.input.replace(/^\[|\]$/g, '').trim();
      await addTask(`Reply: ${title}`, 'medium', dayjs().format('YYYY-MM-DD'), 'From notification suggestion');
      haptic.success();
    },
    [addTask, haptic],
  );

  // Voice conversation mode: auto-send transcribed text and speak the response
  const onVoiceAutoSend = useCallback(
    (text: string) => {
      const normalized = text.trim().toLowerCase();
      const now = Date.now();
      if (!normalized) return;
      if (
        voiceInFlightRef.current ||
        (normalized === lastVoiceSendRef.current.text && now - lastVoiceSendRef.current.ts < 2200)
      ) {
        return;
      }
      lastVoiceSendRef.current = { text: normalized, ts: now };
      voiceInFlightRef.current = true;
      setVoiceMode(true);
      Promise.resolve(onSend(text, true)).finally(() => {
        voiceInFlightRef.current = false;
      });
    },
    [onSend],
  );

  // Exit voice mode when user types manually
  const onChangeText = useCallback(
    (text: string) => {
      setInput(text);
      if (text.length > 0 && voiceMode) {
        setVoiceMode(false);
        tts.stop();
      }
    },
    [voiceMode, tts],
  );

  const onRetry = useCallback(
    async (cmd: AiCommand) => {
      haptic.light();
      try {
        const response = await run(cmd.input, routines, { cmdId: cmd.id });
        haptic.success();
        await resolveCmd(cmd.id, response.output, "executed");
      } catch (e) {
        await resolveCmd(
          cmd.id,
          `Retry failed: ${(e as Error).message}`,
          "failed",
        );
      }
    },
    [routines, resolveCmd, haptic],
  );

  const onSuggestionChip = useCallback(
    (text: string) => {
      setInput(text);
      setTimeout(() => onSend(text), 0);
    },
    [onSend],
  );

  const isProactive = (cmd: AiCommand) => cmd.source !== "user";

  const getDateLabel = (dateStr: string) => {
    const d = dayjs(dateStr);
    if (d.isSame(dayjs(), "day")) return "Today";
    if (d.isSame(dayjs().subtract(1, "day"), "day")) return "Yesterday";
    return d.format("MMM D");
  };

  // Store order: oldest first (ASC). Reverse so newest is first in array; inverted FlatList then draws first at BOTTOM → latest at bottom.
  const listData = useMemo(() => [...commands].reverse(), [commands]);
  const renderItem = useCallback(
    ({ item, index }: { item: AiCommand; index: number }) => {
      const nextOlder = listData[index + 1]; // older message (next in reversed array = above in list)
      const showDateSep =
        !nextOlder ||
        !dayjs(item.created_at).isSame(dayjs(nextOlder.created_at), "day");
      const proactive = isProactive(item);
      const displayOutput = item.output ? cleanOutput(item.output) : null;
      const isUser = item.source === "user";
      const isFailed = item.status === "failed";
      const isPending = item.status === "pending";

      return (
        <View style={ss.bubbleWrap}>
          {showDateSep && (
            <View style={ss.dateSep}>
              <Text style={[ss.dateSepText, { color: calm.textSecondary }]}>
                {getDateLabel(item.created_at)}
              </Text>
            </View>
          )}

          {isUser && (
            <View style={ss.userRow}>
              <View style={[ss.userBubble, { backgroundColor: calm.teal }]}>
                <Text style={ss.userBubbleText}>{item.input}</Text>
                <Text style={[ss.timeInline, { color: "rgba(255,255,255,0.8)" }]}>
                  {dayjs(item.created_at).format("HH:mm")}
                </Text>
              </View>
            </View>
          )}

          {proactive && (
            <View style={ss.aiRow}>
              <Image source={LOGO_IMAGE} style={ss.avatarImage} resizeMode="cover" />
              <View style={ss.glassFrame}>
                <BlurView intensity={28} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
                <LinearGradient
                  colors={isDark ? ([calm.tealBg, calm.tealSoft] as const) : (["#FFF8F2", "#F2FBF3"] as const)}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={ss.aiBubble}
                >
                  {proactiveLabel(item.source) && (
                    <Text style={[ss.proactiveTagText, { color: calm.coral }]}>
                      {proactiveLabel(item.source)}
                    </Text>
                  )}
                  <Text style={[ss.aiBubbleText, { color: calm.text }]}>{item.input}</Text>
                  <Text style={[ss.timeInline, { color: calm.textSecondary }]}>
                    {dayjs(item.created_at).format("HH:mm")}
                  </Text>
                </LinearGradient>
              </View>
            </View>
          )}

          {(displayOutput || isPending || isFailed) && (
            <View style={ss.aiRow}>
              <Image source={LOGO_IMAGE} style={ss.avatarImage} resizeMode="cover" />
              {isFailed ? (
                <View style={[ss.aiBubble, { backgroundColor: isDark ? calm.coralSoft + "99" : "#fce8e6" }]}>
                  <Text style={[ss.aiBubbleText, { color: calm.error }]}>{item.output || "Failed"}</Text>
                  <PressableScale style={[ss.retryBtn, { backgroundColor: calm.error }]} onPress={() => onRetry(item)}>
                    <Text style={ss.retryBtnText}>Retry</Text>
                  </PressableScale>
                  <Text style={[ss.timeInline, { color: calm.textSecondary }]}>{dayjs(item.created_at).format("HH:mm")}</Text>
                </View>
              ) : isPending ? (
                <View style={ss.glassFrame}>
                  <BlurView intensity={28} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
                  <LinearGradient
                    colors={isDark ? ([calm.tealBg, calm.tealSoft] as const) : (["#FFF8F2", "#F2FBF3"] as const)}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={ss.aiBubble}
                  >
                  {llmStreamingText ? (
                    <Text style={[ss.aiBubbleText, { color: calm.text }]}>
                      {llmStreamingText}
                      <Text style={[ss.streamCursor, { color: calm.teal }]}>{"\u2588"}</Text>
                    </Text>
                  ) : (
                    <PendingDots />
                  )}
                  <Text style={[ss.timeInline, { color: calm.textSecondary }]}>{dayjs(item.created_at).format("HH:mm")}</Text>
                  </LinearGradient>
                </View>
              ) : displayOutput ? (
                <View style={ss.glassFrame}>
                  <BlurView intensity={28} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
                  <LinearGradient
                    colors={isDark ? ([calm.tealBg, calm.tealSoft] as const) : (["#FFF8F2", "#F2FBF3"] as const)}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={ss.aiBubble}
                  >
                  <MarkdownOutput
                    theme={{
                      text: calm.text,
                      codeBg: calm.tealSoft + "44",
                      border: calm.textSecondary + "66",
                    }}
                  >
                    {displayOutput}
                  </MarkdownOutput>
                  {item.source === "notification_alert" && (
                    <View style={ss.actionRow}>
                      {item.output && extractSuggestedReply(cleanOutput(item.output)) && (
                        <PressableScale style={[ss.actionPill, { backgroundColor: calm.sage + "cc" }]} onPress={() => onCopySuggestedReply(item)}>
                          <Text style={[ss.actionPillText, { color: calm.teal }]}>Copy reply</Text>
                        </PressableScale>
                      )}
                      <PressableScale style={[ss.actionPill, { backgroundColor: calm.tealSoft + "99" }]} onPress={() => onAddAsTask(item)}>
                        <Text style={[ss.actionPillText, { color: calm.teal }]}>Add as task</Text>
                      </PressableScale>
                    </View>
                  )}
                  <Text style={[ss.timeInline, { color: calm.textSecondary }]}>{dayjs(item.created_at).format("HH:mm")}</Text>
                  </LinearGradient>
                </View>
              ) : null}
            </View>
          )}
        </View>
      );
    },
    [listData, calm, onCopySuggestedReply, onAddAsTask, onRetry, llmStreamingText, isDark],
  );

  const emptyState = (
    <View style={ss.empty}>
      <Text style={[ss.emptyGreeting, { color: calm.text }]}>
        Hey! I&apos;m PicoClaw
      </Text>
      <Text style={[ss.emptySub, { color: calm.textSecondary }]}>
        I can manage tasks, track health, and organize your day.
      </Text>
      {Platform.OS === "android" && notificationListenerEnabled && (
        <Text style={[ss.emptySub, { color: calm.textSecondary, fontSize: 13, marginBottom: 12 }]}>
          When you get a message from WhatsApp or other apps, I&apos;ll suggest a reply here and send you a notification.
        </Text>
      )}
      <View style={ss.chipRow}>
        <PressableScale
          style={[ss.chip, { backgroundColor: calm.tealSoft + "dd" }]}
          onPress={() => onSuggestionChip("Plan my day")}
        >
          <Text style={[ss.chipText, { color: calm.teal }]}>Plan my day</Text>
        </PressableScale>
        <PressableScale
          style={[ss.chip, { backgroundColor: calm.tealSoft + "dd" }]}
          onPress={() => onSuggestionChip("Add a task")}
        >
          <Text style={[ss.chipText, { color: calm.teal }]}>Add a task</Text>
        </PressableScale>
        <PressableScale
          style={[ss.chip, { backgroundColor: calm.coralSoft }]}
          onPress={() => onSuggestionChip("Log water")}
        >
          <Text style={[ss.chipText, { color: calm.coral }]}>Log water</Text>
        </PressableScale>
      </View>
    </View>
  );

  const onNewChat = useCallback(async () => {
    haptic.light();
    await addChatSession();
  }, [addChatSession, haptic]);

  const currentSession = chatSessions.find((s) => s.id === currentChatId);
  const chatTitle = currentSession?.title ?? "PicoClaw";

  const keyboardOffset = Platform.OS === "android" ? 80 : 0;

  // Animated drawer for chat history (defined before useEffect that uses closeDrawer)
  const drawerAnim = useRef(new Animated.Value(0)).current;
  const overlayOpacity = drawerAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] });
  const drawerTranslateX = drawerAnim.interpolate({ inputRange: [0, 1], outputRange: [-320, 0] });

  const openDrawer = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSidebarOpen(true);
    Animated.timing(drawerAnim, {
      toValue: 1,
      duration: 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [drawerAnim]);

  const closeDrawer = useCallback(() => {
    Animated.timing(drawerAnim, {
      toValue: 0,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setSidebarOpen(false);
    });
  }, [drawerAnim]);

  // Android back button closes drawer when open
  useEffect(() => {
    if (!sidebarOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeDrawer();
      return true;
    });
    return () => sub.remove();
  }, [sidebarOpen, closeDrawer]);

  const onSelectChatAndClose = useCallback((chatId: string) => {
    setCurrentChat(chatId);
    closeDrawer();
  }, [setCurrentChat, closeDrawer]);

  return (
    <SafeAreaView style={[ss.fill, { backgroundColor: theme.background }]} edges={["top", "left", "right", "bottom"]}>
      <KeyboardAvoidingView
        style={ss.fill}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={keyboardOffset}
      >
          <LinearGradient
            colors={[theme.surface, theme.surfaceMuted] as const}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[ss.header, { borderBottomColor: theme.border }]}
          >
            <Pressable onPress={() => { haptic.light(); openDrawer(); }} style={ss.headerSide}>
              <MaterialIcons name="menu" size={24} color={calm.text} />
            </Pressable>
            <View style={ss.headerCenter}>
              <Image source={LOGO_IMAGE} style={ss.headerAvatarImage} resizeMode="cover" />
              <Text style={[ss.title, { color: calm.text }]} numberOfLines={1}>
                {chatTitle}
              </Text>
              <View style={[ss.statusDot, { backgroundColor: isOnline ? calm.sage : calm.sendInactive }]} />
              {!isOnline && queueCount > 0 && (
                <View style={[ss.queueBadge, { backgroundColor: calm.coral }]}>
                  <Text style={ss.queueBadgeText}>{queueCount}</Text>
                </View>
              )}
            </View>
            <Pressable
              onPress={onNewChat}
              style={ss.headerSide}
            >
              <MaterialIcons name="add" size={26} color={calm.teal} />
            </Pressable>
          </LinearGradient>

          {/* Animated chat history drawer */}
          {sidebarOpen && (
            <>
              <Animated.View
                style={[StyleSheet.absoluteFill, ss.drawerOverlay, { opacity: overlayOpacity }]}
                pointerEvents="box-none"
              >
                <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
              </Animated.View>
              <Animated.View
                style={[
                  ss.drawerPanel,
                  {
                    backgroundColor: theme.surfaceElevated,
                    transform: [{ translateX: drawerTranslateX }],
                  },
                ]}
                pointerEvents="box-none"
              >
                <View style={[ss.sidebarHeader, { borderBottomColor: theme.border }]}>
                  <Text style={[ss.sidebarTitle, { color: calm.text }]}>Chats</Text>
                  <Pressable onPress={closeDrawer} style={ss.headerSide}>
                    <MaterialIcons name="close" size={24} color={calm.text} />
                  </Pressable>
                </View>
                <PressableScale
                  style={[ss.newChatBtn, { backgroundColor: calm.teal }]}
                  onPress={() => { onNewChat(); closeDrawer(); }}
                >
                  <MaterialIcons name="add" size={20} color="#fff" />
                  <Text style={ss.newChatBtnText}>New chat</Text>
                </PressableScale>
                <FlatList
                  data={chatSessions}
                  keyExtractor={(s) => s.id}
                  style={ss.sidebarList}
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item }) => {
                    const isActive = item.id === currentChatId;
                    const preview = item.title || dayjs(item.updated_at).format("MMM D, h:mm A");
                    return (
                      <Pressable
                        style={[ss.sidebarItem, isActive && { backgroundColor: calm.tealSoft + "44" }]}
                        onPress={() => onSelectChatAndClose(item.id)}
                      >
                        <Text style={[ss.sidebarItemTitle, { color: calm.text }]} numberOfLines={1}>
                          {preview}
                        </Text>
                        <Text style={[ss.sidebarItemDate, { color: calm.textSecondary }]}>
                          {dayjs(item.updated_at).format("MMM D")}
                        </Text>
                      </Pressable>
                    );
                  }}
                />
              </Animated.View>
            </>
          )}

          {isDownloading && downloadProgress && (
            <View
              style={[
                ss.downloadBanner,
                { backgroundColor: theme.primaryBg + "22", borderBottomColor: theme.border },
              ]}
            >
              <Text style={[ss.downloadText, { color: calm.textSecondary }]}>
                Downloading {downloadLabel}... {downloadProgress.percent}%
              </Text>
              <View
                style={[ss.downloadBar, { backgroundColor: theme.border }]}
              >
                <View
                  style={[
                    ss.downloadFill,
                    {
                      backgroundColor: calm.sage,
                      width: `${downloadProgress.percent}%` as any,
                    },
                  ]}
                />
              </View>
            </View>
          )}

          <FlatList
            ref={listRef}
            data={listData}
            keyExtractor={(cmd) => cmd.id}
            renderItem={renderItem}
            contentContainerStyle={[
              ss.list,
              listData.length === 0 && ss.listEmpty,
            ]}
            inverted
            ListEmptyComponent={emptyState}
            keyboardShouldPersistTaps="handled"
          />

          {/* Agent status chips */}
          {(watcherQueueCount > 0 || activeGoalCount > 0) && (
            <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 4, gap: 8, backgroundColor: theme.surfaceElevated, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }}>
              {watcherQueueCount > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.warnBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 }}>
                  <Text style={{ color: theme.warn, fontSize: 11, fontWeight: '600' }}>{watcherQueueCount} insight{watcherQueueCount > 1 ? 's' : ''}</Text>
                </View>
              )}
              {activeGoalCount > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.successBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 }}>
                  <Text style={{ color: theme.success, fontSize: 11, fontWeight: '600' }}>{activeGoalCount} goal{activeGoalCount > 1 ? 's' : ''} active</Text>
                </View>
              )}
            </View>
          )}

          <View
            style={[
              ss.inputBar,
              {
                backgroundColor: theme.surfaceElevated,
                borderTopColor: theme.border,
                paddingBottom: insets.bottom + 8,
              },
            ]}
          >
            {!input.trim() && (
              <VoiceInput
                ref={voiceRef}
                onTranscription={setInput}
                onAutoSend={onVoiceAutoSend}
              />
            )}
            <TextInput
              ref={inputRef}
              style={[
                ss.textInput,
                {
                  color: theme.text,
                  backgroundColor: theme.inputBg,
                  borderWidth: voiceMode ? 1.5 : 1,
                  borderColor: voiceMode ? theme.primary : theme.inputBorder,
                },
              ]}
              placeholder={voiceMode ? "Voice mode active..." : "Message PicoClaw..."}
              placeholderTextColor={voiceMode ? theme.primary : theme.textSecondary}
              value={input}
              onChangeText={onChangeText}
              onSubmitEditing={() => onSend()}
              returnKeyType="send"
            />
            <PressableScale
              style={[
                ss.sendBtn,
                {
                  backgroundColor: input.trim() ? theme.primary : theme.inputBorder,
                },
              ]}
              onPress={() => onSend()}
              disabled={!input.trim()}
            >
              <MaterialIcons name="arrow-upward" size={20} color="#fff" />
            </PressableScale>
          </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  headerSide: { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  headerCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  headerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  title: { ...Typography.title2, maxWidth: 160 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  drawerOverlay: {
    backgroundColor: "#000",
    zIndex: 100,
  },
  drawerPanel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 300,
    zIndex: 101,
    paddingTop: 48,
    shadowColor: "#000",
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  sidebarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sidebarTitle: { fontSize: 18, fontWeight: "600" },
  newChatBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  newChatBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  sidebarList: { flex: 1, marginTop: 12 },
  sidebarItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  sidebarItemTitle: { fontSize: 15, fontWeight: "500" },
  sidebarItemDate: { fontSize: 12, marginTop: 2 },
  list: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },
  listEmpty: { flexGrow: 1 },
  bubbleWrap: { marginBottom: 20 },
  dateSep: { alignItems: "center", marginBottom: 16 },
  dateSepText: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5 },
  userRow: { flexDirection: "row", justifyContent: "flex-end", paddingLeft: 48 },
  aiRow: { flexDirection: "row", alignItems: "flex-start", paddingRight: 24 },
  userBubble: {
    maxWidth: "85%",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    borderBottomRightRadius: 10,
  },
  userBubbleText: { color: "#fff", fontSize: 16, lineHeight: 22 },
  aiBubble: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    borderBottomLeftRadius: 10,
  },
  aiBubbleText: { fontSize: 16, lineHeight: 24 },
  glassFrame: {
    flex: 1,
    maxWidth: "85%",
    marginLeft: 10,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  avatarWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginTop: 4,
  },
  avatarLetter: { color: "#fff", fontSize: 14, fontWeight: "700" },
  avatarLabel: { fontSize: 14, fontWeight: "700" },
  proactiveTagText: { fontSize: 11, fontWeight: "700", marginBottom: 4 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
  actionPill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
  actionPillText: { fontSize: 13, fontWeight: "600" },
  retryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    alignSelf: "flex-start",
    marginTop: 10,
  },
  retryBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  timeInline: { fontSize: 11, marginTop: 6, opacity: 0.85 },
  dotsRow: { flexDirection: "row", gap: 2 },
  dotsDot: { fontSize: 18, fontWeight: "700" },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 80,
  },
  emptyGreeting: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  emptySub: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
  },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  chipText: { fontSize: 14, fontWeight: "600" },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 10,
  },
  textInput: {
    flex: 1,
    ...Typography.callout,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  queueBadge: { minWidth: 18, height: 18, borderRadius: 9, justifyContent: "center" as const, alignItems: "center" as const, paddingHorizontal: 4 },
  queueBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" as const },
  streamCursor: { fontSize: 13, opacity: 0.6 },
  downloadBanner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  downloadText: { fontSize: 13, fontWeight: "600", marginBottom: 6 },
  downloadBar: { height: 4, borderRadius: 2, overflow: "hidden" as const },
  downloadFill: { height: 4, borderRadius: 2 },
});
