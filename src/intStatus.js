const FIELD_LABEL = "int status";
const MAX_LENGTH = 400;

function normalize(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed || null;
}

function validateForSet(raw) {
  const status = normalize(raw);
  if (!status) {
    return { ok: false, message: "status cannot be empty. use `/int-status clear` to remove one." };
  }
  if (status.length > MAX_LENGTH) {
    return { ok: false, message: `status is too long. keep it under ${MAX_LENGTH} characters.` };
  }
  return { ok: true, status };
}

module.exports = {
  FIELD_LABEL,
  MAX_LENGTH,
  normalize,
  validateForSet
};
