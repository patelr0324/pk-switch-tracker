const axios = require("axios");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientPkError(error) {
  const status = error?.response?.status;
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const code = error?.code;
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENETUNREACH" ||
    code === "EAI_AGAIN" ||
    code === "ECONNABORTED"
  ) {
    return true;
  }
  const msg = typeof error?.message === "string" ? error.message : "";
  return msg.includes("timeout");
}

async function runWithRetries(fn, { maxRetries = 4, backoffMs = [750, 2000, 4000] } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const canRetry = attempt < maxRetries && isTransientPkError(error);
      if (!canRetry) throw error;
      const wait = backoffMs[attempt] ?? backoffMs.at(-1);
      await delay(wait);
    }
  }
}

class PKClient {
  constructor(baseUrl, options = {}) {
    const timeout = Number(options.timeoutMs ?? options.timeout ?? 45000);
    const maxRetries = Number.isFinite(Number(options.maxRetries))
      ? Math.max(0, Number(options.maxRetries))
      : 4;

    this._maxRetries = maxRetries;

    this.http = axios.create({
      baseURL: baseUrl,
      timeout
    });
  }

  async _get(url, axiosConfig = {}) {
    return runWithRetries(() => this.http.get(url, axiosConfig), {
      maxRetries: this._maxRetries
    });
  }

  async getOwnSystem(token) {
    const response = await this._get("/systems/@me", {
      headers: { Authorization: token }
    });
    return response.data;
  }

  async getLatestSwitch(systemId, token) {
    const response = await this._get(`/systems/${systemId}/switches`, {
      headers: { Authorization: token },
      params: { limit: 1 }
    });
    return response.data?.[0] || null;
  }

  async getMember(memberId, token) {
    const response = await this._get(`/members/${memberId}`, {
      headers: { Authorization: token }
    });
    return response.data;
  }

  async getCurrentFronters(systemId, token) {
    const response = await this._get(`/systems/${systemId}/fronters`, {
      headers: { Authorization: token }
    });
    return Array.isArray(response.data?.members) ? response.data.members : [];
  }
}

module.exports = {
  PKClient
};
