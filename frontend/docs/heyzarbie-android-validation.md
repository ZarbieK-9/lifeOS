# Hey Zarbie Android Validation Checklist

Use this checklist on a dev build (`expo run:android` or EAS dev client), not Expo Go.

## Preflight

- Confirm microphone permission is granted.
- Confirm foreground notification appears when Hey Zarbie is enabled.
- Confirm consent toggle must be enabled before wake listener can start.

## Wake and popup behavior

- With app in foreground, say wake phrase and verify popup activity appears.
- With app backgrounded, say wake phrase and verify popup activity appears.
- Trigger wake phrase repeatedly and verify cooldown suppresses repeated launches.
- Tap "Test popup now" from settings and verify assistant popup opens.

## Voice handoff and agent parity

- Speak "add a task to buy groceries tomorrow" and verify task is created.
- Speak "log 250 ml water" and verify hydration updates.
- Speak "set focus mode 30 minutes" and verify focus timer starts.
- Confirm command appears in AI command history and resolves to `executed` or `failed`.

## Battery and runtime safeguards

- Enable "Only when charging", unplug device, verify wake listener stops/reacts safely.
- Enable "Pause on low battery", enter battery saver, verify listener pauses/reacts safely.
- Reopen app and verify settings persist across restart.

## Cold-start resilience

- Force-stop app, invoke wake phrase, verify app process boots and transcript still executes.
- If process is cold and command fails, verify failure is surfaced and app remains usable.

## Telemetry

- Verify `agent_outcome` events are enqueued for:
  - `wake_detected`
  - `transcript_received`
  - `command_executed` / `command_failed`
