/**
 * Expo config plugin that bundles the fast LLM model (GGUF) into the app binary
 * so it's available offline immediately after install.
 *
 * Automatically downloads the model from HuggingFace if not already cached locally.
 *
 * Android: copies .gguf into android/app/src/main/assets/models/
 * iOS: adds .gguf to the Xcode project as a bundle resource
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const {
  withDangerousMod,
  withXcodeProject,
  createRunOncePlugin,
} = require("@expo/config-plugins");

const MODEL_FILENAME = "qwen2.5-0.5b-instruct-q4_k_m.gguf";
const MODEL_URL =
  "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/" +
  MODEL_FILENAME;
const MODEL_SRC_DIR = "assets/models";
const MODEL_MIN_SIZE = 100_000_000; // 100 MB — sanity check

/**
 * Download the model from HuggingFace if it doesn't exist locally.
 * Follows redirects (HuggingFace uses 302).
 */
function downloadModel(destPath, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    function follow(url, redirectsLeft) {
      const client = url.startsWith("https") ? https : http;
      client
        .get(url, { headers: { "User-Agent": "LifeOS-Build/1.0" } }, (res) => {
          // Follow redirects
          if (
            (res.statusCode === 301 || res.statusCode === 302) &&
            res.headers.location
          ) {
            if (redirectsLeft <= 0) {
              reject(new Error("Too many redirects"));
              return;
            }
            follow(res.headers.location, redirectsLeft - 1);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} downloading model`));
            return;
          }

          const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
          let downloaded = 0;
          let lastLog = 0;

          const file = fs.createWriteStream(destPath);
          res.pipe(file);

          res.on("data", (chunk) => {
            downloaded += chunk.length;
            const now = Date.now();
            if (now - lastLog > 3000 && totalBytes > 0) {
              const pct = Math.round((downloaded / totalBytes) * 100);
              const mb = (downloaded / 1e6).toFixed(0);
              const totalMb = (totalBytes / 1e6).toFixed(0);
              console.log(
                `[withBundledModel] Downloading... ${mb}/${totalMb} MB (${pct}%)`
              );
              lastLog = now;
            }
          });

          file.on("finish", () => {
            file.close(() => {
              const stat = fs.statSync(destPath);
              if (stat.size < MODEL_MIN_SIZE) {
                fs.unlinkSync(destPath);
                reject(
                  new Error(
                    `Downloaded file too small (${stat.size} bytes), expected ~397 MB`
                  )
                );
                return;
              }
              resolve();
            });
          });

          res.on("error", (err) => {
            fs.unlinkSync(destPath);
            reject(err);
          });
        })
        .on("error", reject);
    }

    follow(MODEL_URL, maxRedirects);
  });
}

/** Ensure the model file exists locally — download if missing */
async function ensureModelDownloaded(projectRoot) {
  const modelSrc = path.join(projectRoot, MODEL_SRC_DIR, MODEL_FILENAME);

  // Check if already downloaded and valid
  if (fs.existsSync(modelSrc)) {
    const stat = fs.statSync(modelSrc);
    if (stat.size >= MODEL_MIN_SIZE) {
      console.log(
        `[withBundledModel] Model already cached (${(stat.size / 1e6).toFixed(0)} MB)`
      );
      return modelSrc;
    }
    // Invalid/partial file — remove and re-download
    fs.unlinkSync(modelSrc);
  }

  console.log(
    `[withBundledModel] Downloading fast model (~397 MB) from HuggingFace...`
  );
  console.log(`[withBundledModel] This is a one-time download, cached for future builds.`);

  await downloadModel(modelSrc);

  console.log(`[withBundledModel] Download complete. Cached at ${modelSrc}`);
  return modelSrc;
}

/** Android: download (if needed) + copy model into app/src/main/assets/models/ */
function withBundledModelAndroid(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const root = cfg.modRequest.platformProjectRoot;
      const projectRoot = cfg.modRequest.projectRoot;
      const assetsDir = path.join(
        root,
        "app",
        "src",
        "main",
        "assets",
        "models"
      );

      const modelSrc = await ensureModelDownloaded(projectRoot);

      fs.mkdirSync(assetsDir, { recursive: true });
      const dest = path.join(assetsDir, MODEL_FILENAME);

      // Only copy if source is newer or dest doesn't exist
      if (
        !fs.existsSync(dest) ||
        fs.statSync(modelSrc).mtimeMs > fs.statSync(dest).mtimeMs
      ) {
        console.log(
          `[withBundledModel] Copying ${MODEL_FILENAME} to Android assets...`
        );
        fs.copyFileSync(modelSrc, dest);
      } else {
        console.log(`[withBundledModel] Android model asset up to date.`);
      }

      return cfg;
    },
  ]);
}

/** iOS: download (if needed) + add model to Xcode project resources */
function withBundledModelIOS(config) {
  return withXcodeProject(config, async (cfg) => {
    const projectRoot = cfg.modRequest.projectRoot;

    const modelSrc = await ensureModelDownloaded(projectRoot);

    const project = cfg.modResults;

    // Check if already added
    const existingFile = project.pbxFileReferenceSection();
    const alreadyAdded = Object.values(existingFile).some(
      (ref) => typeof ref === "object" && ref.name === `"${MODEL_FILENAME}"`
    );

    if (!alreadyAdded) {
      console.log(
        `[withBundledModel] Adding ${MODEL_FILENAME} to iOS bundle resources...`
      );
      project.addResourceFile(
        path.relative(cfg.modRequest.platformProjectRoot, modelSrc),
        { target: project.getFirstTarget().uuid }
      );
    } else {
      console.log(`[withBundledModel] iOS model resource already added.`);
    }

    return cfg;
  });
}

const withBundledModel = (config) => {
  config = withBundledModelAndroid(config);
  config = withBundledModelIOS(config);
  return config;
};

module.exports = createRunOncePlugin(
  withBundledModel,
  "with-bundled-model",
  "1.0.0"
);
