/**
 * PM2 ecosystem for production: place this file in the backend deploy root
 * (same directory as `app/` and `.venv/`). Loads `.env` from that directory
 * so JWT_SECRET and DATABASE_URL are real values — do not use shell $(...)
 * inside the env object; PM2 does not execute it.
 */
const fs = require("fs");
const path = require("path");

const root = __dirname;

function loadEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const dotenv = loadEnv(path.join(root, ".env"));

const envoyBin = process.env.LIFEOS_ENVOY_BIN || "/home/zarbie/envoy";

module.exports = {
  apps: [
    {
      name: "lifeos-backend",
      script: path.join(root, ".venv/bin/python"),
      args: "-m app.server",
      cwd: root,
      interpreter: "none",
      env: {
        ...dotenv,
        DATABASE_URL:
          dotenv.DATABASE_URL ||
          "postgresql+asyncpg://lifeos:lifeos@127.0.0.1:5432/lifeos",
        MQTT_BROKER_HOST: dotenv.MQTT_BROKER_HOST || "127.0.0.1",
        MQTT_BROKER_PORT: String(dotenv.MQTT_BROKER_PORT || "1883"),
        MQTT_USERNAME: dotenv.MQTT_USERNAME || "lifeos_server",
        MQTT_PASSWORD: dotenv.MQTT_PASSWORD || "lifeos_server_pass",
        COACH_TIMEZONE: dotenv.COACH_TIMEZONE || "UTC",
        ACCESS_TOKEN_EXPIRE_MINUTES: String(
          dotenv.ACCESS_TOKEN_EXPIRE_MINUTES || "60",
        ),
        REFRESH_TOKEN_EXPIRE_DAYS: String(
          dotenv.REFRESH_TOKEN_EXPIRE_DAYS || "30",
        ),
      },
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: "lifeos-envoy",
      script: envoyBin,
      args: `-c ${path.join(root, "envoy.yaml")}`,
      cwd: root,
      interpreter: "none",
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
