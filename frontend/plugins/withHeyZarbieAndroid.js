const fs = require("fs");
const path = require("path");
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  createRunOncePlugin,
} = require("@expo/config-plugins");

const PKG = "com.lifeos.app";
const SERVICE_NAME = `${PKG}.heyzarbie.WakeWordForegroundService`;
const ACTIVITY_NAME = `${PKG}.heyzarbie.HeyZarbieActivity`;

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeIfMissing(filePath, contents) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, contents, "utf8");
  }
}

function writeAlways(filePath, contents) {
  fs.writeFileSync(filePath, contents, "utf8");
}

function removePathIfExists(p) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}

function copyDirRecursive(src, dest) {
  ensureDir(dest);
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

const MODULE_TEMPLATE = `package com.lifeos.app.heyzarbie

import android.content.Context
import android.content.Intent
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class HeyZarbieModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  companion object {
    private var currentState: String = "idle"
    const val PREFS_NAME: String = "heyzarbie_pending"
    const val KEY_PENDING: String = "pending_transcript"
    fun emitEvent(context: ReactApplicationContext, type: String, payload: WritableMap) {
      context
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(type, payload)
    }
    fun setState(state: String) { currentState = state }
  }

  override fun getName(): String = "HeyZarbieModule"

  @ReactMethod
  fun consumePendingVoiceCommand(promise: Promise) {
    try {
      val prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val text = prefs.getString(KEY_PENDING, null) ?: ""
      prefs.edit().remove(KEY_PENDING).apply()
      promise.resolve(text)
    } catch (e: Exception) {
      promise.reject("consume_failed", e)
    }
  }

  @ReactMethod
  fun startWakeListener(config: ReadableMap?, promise: Promise) {
    try {
      val intent = Intent(reactContext, WakeWordForegroundService::class.java)
      intent.action = WakeWordForegroundService.ACTION_START
      if (config != null) {
        intent.putExtra("configJson", config.toHashMap().toString())
      }
      reactContext.startForegroundService(intent)
      setState("listening")
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("start_failed", e)
    }
  }

  @ReactMethod
  fun stopWakeListener(promise: Promise) {
    try {
      val intent = Intent(reactContext, WakeWordForegroundService::class.java)
      intent.action = WakeWordForegroundService.ACTION_STOP
      reactContext.startService(intent)
      setState("idle")
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("stop_failed", e)
    }
  }

  @ReactMethod
  fun getWakeState(promise: Promise) {
    promise.resolve(currentState)
  }

  @ReactMethod
  fun openAssistant(promise: Promise) {
    try {
      val intent = Intent(reactContext, HeyZarbieActivity::class.java)
      intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      reactContext.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("open_failed", e)
    }
  }
}
`;

const PACKAGE_TEMPLATE = `package com.lifeos.app.heyzarbie

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class HeyZarbiePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): MutableList<NativeModule> {
    return mutableListOf(HeyZarbieModule(reactContext))
  }
  override fun createViewManagers(reactContext: ReactApplicationContext): MutableList<ViewManager<*, *>> {
    return mutableListOf()
  }
}
`;

const ACTIVITY_TEMPLATE = `package com.lifeos.app.heyzarbie

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.widget.Toast
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext

class HeyZarbieActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    startVoiceCapture()
  }

  private fun startVoiceCapture() {
    if (!SpeechRecognizer.isRecognitionAvailable(this)) {
      Toast.makeText(this, "Speech recognition unavailable", Toast.LENGTH_SHORT).show()
      finish()
      return
    }
    val recognizer = SpeechRecognizer.createSpeechRecognizer(this)
    recognizer.setRecognitionListener(SimpleRecognitionListener(
      onFinalText = { transcript ->
        val app = application as? com.facebook.react.ReactApplication
        val reactContext = app?.reactNativeHost?.reactInstanceManager?.currentReactContext as? ReactApplicationContext
        if (reactContext != null) {
          val payload = Arguments.createMap()
          payload.putString("text", transcript)
          payload.putString("source", "heyzarbie_activity")
          HeyZarbieModule.emitEvent(reactContext, "onTranscript", payload)
        } else {
          // App in background / bridge torn down: persist and bring main task forward.
          getSharedPreferences(HeyZarbieModule.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(HeyZarbieModule.KEY_PENDING, transcript)
            .apply()
          val launch = packageManager.getLaunchIntentForPackage(packageName)
          if (launch != null) {
            launch.addFlags(
              Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            )
            startActivity(launch)
          }
        }
        finish()
      },
      onError = {
        finish()
      }
    ))
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
    }
    recognizer.startListening(intent)
  }
}
`;

const LISTENER_TEMPLATE = `package com.lifeos.app.heyzarbie

import android.os.Bundle
import android.speech.RecognitionListener

class SimpleRecognitionListener(
  private val onFinalText: (String) -> Unit,
  private val onError: (Int) -> Unit
) : RecognitionListener {
  override fun onReadyForSpeech(params: Bundle?) {}
  override fun onBeginningOfSpeech() {}
  override fun onRmsChanged(rmsdB: Float) {}
  override fun onBufferReceived(buffer: ByteArray?) {}
  override fun onEndOfSpeech() {}
  override fun onError(error: Int) = onError.invoke(error)
  override fun onResults(results: Bundle?) {
    val matches = results?.getStringArrayList(android.speech.SpeechRecognizer.RESULTS_RECOGNITION)
    val text = matches?.firstOrNull()?.trim().orEmpty()
    if (text.isNotEmpty()) onFinalText.invoke(text) else onError.invoke(-1)
  }
  override fun onPartialResults(partialResults: Bundle?) {}
  override fun onEvent(eventType: Int, params: Bundle?) {}
}
`;

const SERVICE_TEMPLATE = `package com.lifeos.app.heyzarbie

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.lifeos.app.R

class WakeWordForegroundService : Service() {
  companion object {
    const val CHANNEL_ID = "heyzarbie_wake"
    const val NOTIFICATION_ID = 4411
    const val ACTION_START = "heyzarbie.action.START"
    const val ACTION_STOP = "heyzarbie.action.STOP"
  }

  private var detector: WakeWordDetector? = null
  private var lastDetectedAtMs: Long = 0

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopDetector()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_START, null -> {
        startForeground(NOTIFICATION_ID, buildNotification())
        startDetector()
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    stopDetector()
    super.onDestroy()
  }

  private fun startDetector() {
    if (detector != null) return
    detector = WakeWordDetector(this) {
      val now = System.currentTimeMillis()
      if (now - lastDetectedAtMs < 10000) return@WakeWordDetector
      lastDetectedAtMs = now
      val intent = Intent(this, HeyZarbieActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      }
      startActivity(intent)
    }
    detector?.start()
    HeyZarbieModule.setState("listening")
  }

  private fun stopDetector() {
    detector?.stop()
    detector = null
    HeyZarbieModule.setState("idle")
  }

  private fun buildNotification(): Notification {
    createChannel()
    val openIntent = Intent(this, HeyZarbieActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or
        Intent.FLAG_ACTIVITY_CLEAR_TOP or
        Intent.FLAG_ACTIVITY_SINGLE_TOP or
        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
    }
    val pending = PendingIntent.getActivity(
      this,
      0,
      openIntent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("Hey Zarbie listening")
      .setContentText("Listening for wake phrase")
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(pending)
      .build()
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(CHANNEL_ID, "Hey Zarbie Wake Listener", NotificationManager.IMPORTANCE_LOW)
    manager.createNotificationChannel(channel)
  }
}
`;

const DETECTOR_TEMPLATE = `package com.lifeos.app.heyzarbie

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import org.vosk.android.StorageService
import java.util.Locale

private const val TAG = "HeyZarbieWake"

/**
 * Offline wake phrase using Vosk (Apache-2.0). Bundle assets under model-en-us/
 * (see https://alphacephei.com/vosk/models — e.g. vosk-model-small-en-us).
 */
class WakeWordDetector(
  private val context: Context,
  private val onDetected: () -> Unit
) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var model: Model? = null
  private var speechService: SpeechService? = null

  fun start() {
    if (speechService != null) return
    LibVosk.setLogLevel(LogLevel.WARN)
    StorageService.unpack(
      context,
      "model-en-us",
      "model",
      { m: Model ->
        model = m
        startListening(m)
      },
      { err ->
        Log.e(TAG, "Vosk model failed — add frontend/assets/model-en-us from alphacephei.com/vosk/models then prebuild", err)
      }
    )
  }

  private fun startListening(m: Model) {
    try {
      val grammar =
        "[\"hey zarbie\",\"hey barbie\",\"hi zarbie\",\"hi barbie\",\"zarbie\",\"[unk]\"]"
      val recognizer = Recognizer(m, 16000.0f, grammar)
      val service = SpeechService(recognizer, 16000.0f)
      speechService = service
      service.startListening(object : RecognitionListener {
        override fun onPartialResult(hypothesis: String?) {
          if (matchesWake(hypothesis)) fireDetected()
        }
        override fun onResult(hypothesis: String?) {
          if (matchesWake(hypothesis)) fireDetected()
        }
        override fun onFinalResult(hypothesis: String?) {
          if (matchesWake(hypothesis)) fireDetected()
        }
        override fun onError(exception: Exception?) {
          Log.e(TAG, "Vosk recognition error", exception)
        }
        override fun onTimeout() {}
      })
    } catch (e: Exception) {
      Log.e(TAG, "Vosk SpeechService failed", e)
    }
  }

  private fun matchesWake(hypothesis: String?): Boolean {
    if (hypothesis.isNullOrBlank()) return false
    val text = try {
      val o = JSONObject(hypothesis)
      val merged = (o.optString("text") + " " + o.optString("partial")).trim().lowercase(Locale.US)
      merged.ifBlank { hypothesis.lowercase(Locale.US) }
    } catch (_: Exception) {
      hypothesis.lowercase(Locale.US)
    }
    if (text.isBlank()) return false
    if (text.contains("zarbie")) return true
    if (text.contains("zorby") || text.contains("zarby")) return true
    if ((text.contains("hey") || text.contains("hi")) && text.contains("barbie")) return true
    return false
  }

  private fun fireDetected() {
    mainHandler.post { onDetected.invoke() }
  }

  fun stop() {
    try {
      speechService?.stop()
      speechService?.shutdown()
    } catch (_: Exception) {
    }
    speechService = null
    try {
      model?.close()
    } catch (_: Exception) {
    }
    model = null
  }
}
`;

function withHeyZarbieManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;
    app["uses-permission"] = app["uses-permission"] || [];

    const permissions = cfg.modResults.manifest["uses-permission"] || [];
    const addPerm = (name) => {
      if (!permissions.some((p) => p.$["android:name"] === name)) {
        permissions.push({ $: { "android:name": name } });
      }
    };
    addPerm("android.permission.RECORD_AUDIO");
    addPerm("android.permission.FOREGROUND_SERVICE");
    addPerm("android.permission.FOREGROUND_SERVICE_MICROPHONE");
    addPerm("android.permission.POST_NOTIFICATIONS");
    cfg.modResults.manifest["uses-permission"] = permissions;

    app.service = app.service || [];
    if (!app.service.some((s) => s.$["android:name"] === SERVICE_NAME)) {
      app.service.push({
        $: {
          "android:name": SERVICE_NAME,
          "android:exported": "false",
          "android:foregroundServiceType": "microphone",
        },
      });
    }

    app.activity = app.activity || [];
    if (!app.activity.some((a) => a.$["android:name"] === ACTIVITY_NAME)) {
      app.activity.push({
        $: {
          "android:name": ACTIVITY_NAME,
          "android:exported": "false",
          "android:theme": "@android:style/Theme.Translucent.NoTitleBar",
          "android:excludeFromRecents": "true",
          "android:launchMode": "singleTop",
          "android:taskAffinity": "",
        },
      });
    }
    return cfg;
  });
}

function withHeyZarbieBuildGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    let c = cfg.modResults.contents;
    c = c.replace(/\s*implementation\s*["']ai\.picovoice:porcupine-android:[^"']+["']\s*\n?/g, "\n");
    if (!c.includes("com.alphacephei:vosk-android")) {
      c = c.replace(
        /dependencies\s*\{/,
        `dependencies {\n    implementation "net.java.dev.jna:jna:5.18.1@aar"\n    implementation "com.alphacephei:vosk-android:0.3.75@aar"`
      );
    }
    cfg.modResults.contents = c;
    return cfg;
  });
}

function withHeyZarbieNativeSources(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const root = cfg.modRequest.platformProjectRoot;
      const pkgPath = PKG.replace(/\./g, "/");
      const sourceDir = path.join(root, "app", "src", "main", "java", pkgPath, "heyzarbie");
      ensureDir(sourceDir);

      writeAlways(path.join(sourceDir, "HeyZarbieModule.kt"), MODULE_TEMPLATE);
      writeIfMissing(path.join(sourceDir, "HeyZarbiePackage.kt"), PACKAGE_TEMPLATE);
      writeAlways(path.join(sourceDir, "HeyZarbieActivity.kt"), ACTIVITY_TEMPLATE);
      writeIfMissing(path.join(sourceDir, "SimpleRecognitionListener.kt"), LISTENER_TEMPLATE);
      writeAlways(path.join(sourceDir, "WakeWordForegroundService.kt"), SERVICE_TEMPLATE);
      writeAlways(path.join(sourceDir, "WakeWordDetector.kt"), DETECTOR_TEMPLATE);

      const mainApp = path.join(root, "app", "src", "main", "java", pkgPath, "MainApplication.kt");
      if (fs.existsSync(mainApp)) {
        let content = fs.readFileSync(mainApp, "utf8");
        if (!content.includes("HeyZarbiePackage")) {
          content = content.replace(
            "import com.facebook.react.ReactPackage",
            "import com.facebook.react.ReactPackage\nimport com.lifeos.app.heyzarbie.HeyZarbiePackage"
          );
          content = content.replace(
            /packages\s*=\s*PackageList\(this\)\.packages/,
            "packages = PackageList(this).packages.apply { add(HeyZarbiePackage()) }"
          );
          fs.writeFileSync(mainApp, content, "utf8");
        }
      }

      return cfg;
    },
  ]);
}

/** Copy Vosk model folder (assets/model-en-us) into Android assets; drop legacy Picovoice files. */
function withVoskModelAssets(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const root = cfg.modRequest.platformProjectRoot;
      const projectRoot = cfg.modRequest.projectRoot;
      const assetsDir = path.join(root, "app", "src", "main", "assets");
      const modelSrc = path.join(projectRoot, "assets", "model-en-us");
      const modelDest = path.join(assetsDir, "model-en-us");
      ensureDir(assetsDir);

      if (fs.existsSync(modelSrc)) {
        removePathIfExists(modelDest);
        copyDirRecursive(modelSrc, modelDest);
      }

      const porcupineXml = path.join(
        root,
        "app",
        "src",
        "main",
        "res",
        "values",
        "zz_heyzarbie_porcupine.xml"
      );
      if (fs.existsSync(porcupineXml)) fs.unlinkSync(porcupineXml);

      const oldPpn = path.join(assetsDir, "hey_zarbie.ppn");
      if (fs.existsSync(oldPpn)) fs.unlinkSync(oldPpn);

      return cfg;
    },
  ]);
}

const withHeyZarbieAndroid = (config) => {
  config = withHeyZarbieManifest(config);
  config = withHeyZarbieBuildGradle(config);
  config = withVoskModelAssets(config);
  config = withHeyZarbieNativeSources(config);
  return config;
};

module.exports = createRunOncePlugin(
  withHeyZarbieAndroid,
  "with-hey-zarbie-android",
  "1.0.0"
);
