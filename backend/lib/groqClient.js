const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Groq has no dense 70B vision model, so receipt OCR stays on a multimodal model.
const VISION_MODEL = process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
// Description parsing is text-only, so it runs on a real dense 70B model.
const TEXT_MODEL = process.env.GROQ_TEXT_MODEL || "llama-3.3-70b-versatile";

// ---- Multi-key rotation ----
// Supports up to N Groq API keys so a rate-limited/exhausted key doesn't fail the request —
// GROQ_API_KEYS="key1,key2,...,key10" (falls back to single GROQ_API_KEY for one key).
function loadKeys() {
  const multi = process.env.GROQ_API_KEYS;
  const list = (multi && multi.trim() ? multi : process.env.GROQ_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  return [...new Set(list)];
}

const KEYS = loadKeys();
// key -> epoch ms until which this key should be skipped (rate-limited/invalid)
const cooldownUntil = new Map();
let rotationPointer = 0;

function keyLabel(key) {
  return key ? `…${key.slice(-4)}` : "(none)";
}

function markCooldown(key, ms, reason) {
  cooldownUntil.set(key, Date.now() + ms);
  console.warn(`[groq] key ${keyLabel(key)} put on cooldown for ${Math.round(ms / 1000)}s — ${reason}`);
}

function availableKeyOrder() {
  const now = Date.now();
  const n = KEYS.length;
  const order = [];
  for (let i = 0; i < n; i++) order.push((rotationPointer + i) % n);
  return order.filter((i) => (cooldownUntil.get(KEYS[i]) || 0) <= now);
}

function stripCodeFence(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text.trim();
}

async function requestWithKey(key, { model, messages, temperature }) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Groq API error ${res.status}: ${body.slice(0, 500)}`);
    err.status = res.status;
    err.retryAfterSec = Number(res.headers.get("retry-after")) || null;
    throw err;
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Groq API returned no content");

  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(stripCodeFence(raw));
  }
}

function allKeysExhaustedError(lastErr) {
  const soonest = Math.min(...KEYS.map((k) => cooldownUntil.get(k) || 0));
  const waitSec = Math.max(0, Math.ceil((soonest - Date.now()) / 1000));
  const suffix = lastErr ? ` Last error: ${lastErr.message}` : "";
  return new Error(`All ${KEYS.length} Groq API key(s) are rate-limited or invalid. Earliest retry in ~${waitSec}s.${suffix}`);
}

async function callGroq({ model, messages, temperature = 0 }) {
  if (KEYS.length === 0) {
    throw new Error("No Groq API key configured — set GROQ_API_KEYS (comma-separated) or GROQ_API_KEY");
  }

  const order = availableKeyOrder();
  if (order.length === 0) {
    throw allKeysExhaustedError(null);
  }

  let lastErr;
  for (const idx of order) {
    const key = KEYS[idx];
    try {
      const result = await requestWithKey(key, { model, messages, temperature });
      rotationPointer = (idx + 1) % KEYS.length; // spread the next call to the next key
      return result;
    } catch (err) {
      lastErr = err;
      if (err.status === 429) {
        // Rate limited: honor Retry-After if Groq sent one, else back off a minute.
        markCooldown(key, (err.retryAfterSec || 60) * 1000, "rate limited (429)");
        continue;
      }
      if (err.status === 401 || err.status === 403) {
        // Invalid/revoked/no-quota key: not worth retrying soon.
        markCooldown(key, 24 * 60 * 60 * 1000, `auth/quota error (${err.status})`);
        continue;
      }
      // Any other error (5xx, network, bad response) is not key-specific — don't burn
      // through the rest of the keys for it, fail fast.
      rotationPointer = (idx + 1) % KEYS.length;
      throw err;
    }
  }
  throw allKeysExhaustedError(lastErr);
}

function callVision({ systemPrompt, userText, imageBase64, mimeType = "image/png" }) {
  return callGroq({
    model: VISION_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        ],
      },
    ],
  });
}

function callText({ systemPrompt, userText }) {
  return callGroq({
    model: TEXT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
  });
}

module.exports = { callVision, callText, _internal: { loadKeys, KEYS, cooldownUntil, callGroq } };
