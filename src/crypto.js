const crypto = require("crypto");

function getKeyBuffer(rawKey) {
  const trimmed = rawKey.trim();

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  try {
    const base64 = Buffer.from(trimmed, "base64");
    if (base64.length === 32) {
      return base64;
    }
  } catch (error) {
    // Fall through and try utf-8 parsing.
  }

  const utf8 = Buffer.from(trimmed, "utf8");
  if (utf8.length === 32) {
    return utf8;
  }

  throw new Error(
    "TOKEN_ENCRYPTION_KEY must be 32 bytes (utf8), 64-char hex, or 32-byte base64."
  );
}

function encryptString(value, rawKey) {
  const key = getKeyBuffer(rawKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString(
    "base64"
  )}`;
}

function decryptString(payload, rawKey) {
  const [ivPart, tagPart, encryptedPart] = payload.split(".");
  if (!ivPart || !tagPart || !encryptedPart) {
    throw new Error("Invalid encrypted payload format.");
  }

  const key = getKeyBuffer(rawKey);
  const iv = Buffer.from(ivPart, "base64");
  const tag = Buffer.from(tagPart, "base64");
  const encrypted = Buffer.from(encryptedPart, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

module.exports = {
  encryptString,
  decryptString,
  encryptToken: encryptString,
  decryptToken: decryptString
};
