// Model download/delete/cache manager via expo-file-system (legacy API)
// Supports dual models: fast (0.5B) for chat, heavy (3B) for reasoning.

import * as FileSystem from 'expo-file-system/legacy';
import { FAST_MODEL, HEAVY_MODEL, type ModelRole, type DownloadProgress, type ModelInfo } from './types';

const MODELS_DIR = `${FileSystem.documentDirectory}models/`;

function getModel(role: ModelRole): ModelInfo {
  return role === 'fast' ? FAST_MODEL : HEAVY_MODEL;
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MODELS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
  }
}

/** Full local path for a model file */
export function modelPath(role: ModelRole = 'heavy'): string {
  return `${MODELS_DIR}${getModel(role).filename}`;
}

/** Check if a model is already downloaded */
export async function isDownloaded(role: ModelRole = 'heavy'): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(modelPath(role));
  return info.exists && (info.size ?? 0) > 0;
}

/**
 * Start downloading a model. Returns a resumable download handle.
 * Caller should await `handle.downloadAsync()` and can call `handle.pauseAsync()`.
 */
export function download(
  role: ModelRole,
  onProgress: (p: DownloadProgress) => void,
): FileSystem.DownloadResumable {
  ensureDir(); // fire-and-forget
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
