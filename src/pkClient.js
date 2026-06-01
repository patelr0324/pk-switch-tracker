const axios = require("axios");

const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ECONNABORTED"
]);
const DEFAULT_BACKOFF_MS = [750, 2000, 4000];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(error) {
  const status = error?.response?.status;
  if (TRANSIENT_HTTP_STATUSES.has(status)) return true;
  if (TRANSIENT_NETWORK_CODES.has(error?.code)) return true;
  return String(error?.message || "").includes("timeout");
}

async function withRetries(fn, maxRetries, backoffMs = DEFAULT_BACKOFF_MS) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxRetries || !isTransientError(error)) throw error;
      await delay(backoffMs[attempt] ?? backoffMs.at(-1));
    }
  }
}

function authConfig(token, extra = {}) {
  return { headers: { Authorization: token }, ...extra };
}

class PKClient {
  constructor(baseUrl, options = {}) {
    this._maxRetries = Number.isFinite(Number(options.maxRetries))
      ? Math.max(0, Number(options.maxRetries))
      : 4;

    this.http = axios.create({
      baseURL: baseUrl,
      timeout: Number(options.timeoutMs ?? 45000)
    });
  }

  _get(url, config) {
    return withRetries(() => this.http.get(url, config), this._maxRetries);
  }

  getOwnSystem(token) {
    return this._get("/systems/@me", authConfig(token)).then((r) => r.data);
  }

  getLatestSwitch(systemId, token) {
    return this._get(`/systems/${systemId}/switches`, authConfig(token, { params: { limit: 1 } })).then(
      (r) => r.data?.[0] || null
    );
  }

  getMember(memberId, token) {
    return this._get(`/members/${memberId}`, authConfig(token)).then((r) => r.data);
  }

  getCurrentFronters(systemId, token) {
    return this._get(`/systems/${systemId}/fronters`, authConfig(token)).then((r) =>
      Array.isArray(r.data?.members) ? r.data.members : []
    );
  }
}

module.exports = {
  PKClient
};
