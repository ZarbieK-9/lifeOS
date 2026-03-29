// Model download/delete/cache manager via expo-file-system (legacy API)
// Supports dual models: fast (0.5B) for chat, heavy (3B) for reasoning.
// The fast model can be bundled in the APK/IPA for instant offline use.

import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { FAST_MODEL, HEAVY_MODEL, type ModelRole, type DownloadProgress, type ModelInfo } from './types';

const MODELS_DIR = `${FileSystem.documentDirectory}models/`;

/** Path to the bundled fast model in the app binary (Android assets / iOS bundle) */
const BUNDLED_FAST_MODEL_ANDROID = `asset:///models/${FAST_MODEL.filename}`;
const BUNDLED_FAST_MODEL_IOS = `${FileSystem.bundleDirectory ?? ''}${FAST_MODEL.filename}`;

function getModel(role: ModelRole): ModelInfo {
  return role === 'fast' ? FAST_MODEL : HEAVY_MODEL;
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MODELS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
  }
}

/** Full local path for a model file (in documents dir) */
export function modelPath(role: ModelRole = 'heavy'): string {
  return `${MODELS_DIR}${getModel(role).filename}`;
}

/**
 * Check if the fast model is bundled in the app binary.
 * If so, copy it to the documents dir (llama.rn needs a real file path).
 * Returns the usable path or null if not bundled.
 */
export async function extractBundledFastModel(): Promise<string | null> {
  const destPath = modelPath('fast');

  // Already extracted previously
  const destInfo = await FileSystem.getInfoAsync(destPath);
  if (destInfo.exists && (destInfo.size ?? 0) > 0) {
    return destPath;
  }

  try {
    if (Platform.OS === 'android') {
      // On Android, assets are accessed via SAF — check if bundled asset exists
      const assetInfo = await FileSystem.getInfoAsync(BUNDLED_FAST_MODEL_ANDROID);
      if (assetInfo.exists) {
        await ensureDir();
        await FileSystem.copyAsync({
          from: BUNDLED_FAST_MODEL_ANDROID,
          to: destPath,
        });
        console.log('[ModelManager] Extracted bundled fast model from APK assets');
        return destPath;
      }
    } else if (Platform.OS === 'ios') {
      const assetInfo = await FileSystem.getInfoAsync(BUNDLED_FAST_MODEL_IOS);
      if (assetInfo.exists) {
        await ensureDir();
        await FileSystem.copyAsync({
          from: BUNDLED_FAST_MODEL_IOS,
          to: destPath,
        });
        console.log('[ModelManager] Extracted bundled fast model from iOS bundle');
        return destPath;
      }
    }
  } catch (e) {
    console.warn('[ModelManager] Failed to extract bundled model:', e);
  }

  return null;
}

/** Check if a model is already downloaded (or extracted from bundle) */
export async function isDownloaded(role: ModelRole = 'heavy'): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(modelPath(role));
  return info.exists && (info.size ?? 0) > 0;
}

/**
 * Start downloading a model. Returns a resumable download handle.
 * Caller should await `handle.downloadAsync()` and can call `handle.pauseAsync()`.
 */
export async function download(
  role: ModelRole,
  onProgress: (p: DownloadProgress) => void,
): Promise<FileSystem.DownloadResumable> {
  await ensureDir();
  const model = getModel(role);
  return FileSystem.createDownloadResumable(
    model.url,
    modelPath(role),
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      onProgress({
        totalBytes: totalBytesExpectedToWrite,
        downloadedBytes: totalBytesWritten,
        percent: Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 100),
      });
    },
  );
}

/** Delete a downloaded model file */
export async function deleteModel(role: ModelRole = 'heavy'): Promise<void> {
  const path = modelPath(role);
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) await FileSystem.deleteAsync(path);
}
