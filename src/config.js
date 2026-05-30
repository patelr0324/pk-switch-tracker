const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const databasePath = process.env.DATABASE_PATH || "./data/bot.db";
const devMode = String(process.env.DEV_MODE || "false").toLowerCase() === "true";

module.exports = {
  discordToken: required("DISCORD_TOKEN"),
  discordClientId: required("DISCORD_CLIENT_ID"),
  discordGuildId: process.env.DISCORD_GUILD_ID || null,
  tokenEncryptionKey: required("TOKEN_ENCRYPTION_KEY"),
  databasePath: path.resolve(process.cwd(), databasePath),
  pkApiBase: process.env.PK_API_BASE || "https://api.pluralkit.me/v2",
  pkApiTimeoutMs: Number(process.env.PK_API_TIMEOUT_MS || 45000),
  pkApiMaxRetries: Number(process.env.PK_API_MAX_RETRIES || 4),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 30000),
  webhookPort: Number(process.env.WEBHOOK_PORT || 8787),
  webhookPath: process.env.WEBHOOK_PATH || "/pk-webhook",
  webhookSecret: process.env.WEBHOOK_SECRET || "",
  devMode
};
