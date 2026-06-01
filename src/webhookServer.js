const { createServer } = require("http");

function startWebhookServer({ config, getRelay }) {
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== config.webhookPath) {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    if (config.webhookSecret && req.headers["x-webhook-secret"] !== config.webhookSecret) {
      res.writeHead(401);
      res.end("unauthorized");
      return;
    }

    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", async () => {
      const relay = getRelay();
      if (!relay) {
        res.writeHead(503);
        res.end("relay not ready");
        return;
      }

      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const payload = raw ? JSON.parse(raw) : {};
        await relay.processWebhookPayload(payload);
        res.writeHead(202);
        res.end("accepted");
      } catch (error) {
        console.error("webhook processing failed:", error.message);
        res.writeHead(400);
        res.end("bad request");
      }
    });
  });

  server.on("error", (error) => {
    if (error?.code === "EADDRINUSE") {
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

  return server;
}

module.exports = {
  startWebhookServer
};
