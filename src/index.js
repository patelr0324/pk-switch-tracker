const { Client, GatewayIntentBits } = require("discord.js");
const { createServer } = require("http");
const config = require("./config");
const { BotDatabase } = require("./db");
const { PKClient } = require("./pkClient");
const { handleInteraction } = require("./commands");
const { startSwitchRelay } = require("./switchWorker");

const db = new BotDatabase(config.databasePath);
const pkClient = new PKClient(config.pkApiBase);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});
let relay = null;

function startWebhookServer() {
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== config.webhookPath) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    if (config.webhookSecret) {
      const incomingSecret = req.headers["x-webhook-secret"];
      if (incomingSecret !== config.webhookSecret) {
        res.statusCode = 401;
        res.end("unauthorized");
        return;
      }
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (body.length > 1024 * 1024) {
        req.destroy();
      }
    });

    req.on("end", async () => {
      if (!relay) {
        res.statusCode = 503;
        res.end("relay not ready");
        return;
      }

      try {
        const payload = body ? JSON.parse(body) : {};
        await relay.processWebhookPayload(payload);
        res.statusCode = 202;
        res.end("accepted");
      } catch (error) {
        console.error("webhook processing failed:", error.message);
        res.statusCode = 400;
        res.end("bad request");
      }
    });
  });

  server.on("error", (error) => {
    if (error && error.code === "EADDRINUSE") {
      console.error(
        `webhook port ${config.webhookPort} is already in use; continuing with polling fallback only`
      );
      return;
    }
    console.error("webhook server error:", error);
  });

  server.listen(config.webhookPort, () => {
    console.log(`webhook listener on port ${config.webhookPort}${config.webhookPath}`);
  });
}

client.once("clientReady", () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  if (config.devMode) {
    if (!config.discordGuildId) {
      console.error("dev mode is on but DISCORD_GUILD_ID is empty; no guild scope can be applied");
    } else {
      console.log(`dev mode enabled: posting scoped to guild ${config.discordGuildId}`);
    }
  } else {
    console.log("dev mode disabled: posting allowed in all configured guilds");
  }
  relay = startSwitchRelay(
    {
      db,
      pkClient,
      client,
      encryptionKey: config.tokenEncryptionKey,
      postingGuildScopeId: config.devMode ? config.discordGuildId : null
    },
    config.pollIntervalMs
  );
});

client.on("interactionCreate", async (interaction) => {
  try {
    await handleInteraction(interaction, {
      db,
      pkClient,
      encryptionKey: config.tokenEncryptionKey
    });
  } catch (error) {
    console.error("Unhandled interaction error:", error);
  }
});

client.login(config.discordToken).catch((error) => {
  console.error("Failed to login:", error);
  process.exit(1);
});

startWebhookServer();
