const axios = require("axios");

class PKClient {
  constructor(baseUrl) {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 15000
    });
  }

  async getOwnSystem(token) {
    const response = await this.http.get("/systems/@me", {
      headers: { Authorization: token }
    });
    return response.data;
  }

  async getLatestSwitch(systemId, token) {
    const response = await this.http.get(`/systems/${systemId}/switches`, {
      headers: { Authorization: token },
      params: { limit: 1 }
    });
    return response.data?.[0] || null;
  }

  async getMember(memberId, token) {
    const response = await this.http.get(`/members/${memberId}`, {
      headers: { Authorization: token }
    });
    return response.data;
  }

  async getCurrentFronters(systemId, token) {
    const response = await this.http.get(`/systems/${systemId}/fronters`, {
      headers: { Authorization: token }
    });
    return Array.isArray(response.data?.members) ? response.data.members : [];
  }
}

module.exports = {
  PKClient
};
