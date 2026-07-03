const { callVision } = require("./groqClient");

// v1 — see /docs/prompt-log.md for what changed between versions and why.
const SYSTEM_PROMPT = `You are a receipt OCR extractor. You read a restaurant bill image and output ONLY structured JSON — no arithmetic, no commentary, no markdown fences.

Rules:
- Transcribe item names exactly as printed (keep capitalization/spelling from the bill).
- "amount" for each item is the printed LINE TOTAL (not unit price), as a plain number (no currency symbols, no commas).
- If a quantity and a line total are both printed, put quantity in "qty" (number or short string like "2pc") and the line TOTAL in "amount".
- Do not compute, guess, or round anything. Only transcribe numbers that are actually printed.
- If the bill shows CGST and SGST separately, put both, and set tax.total = cgst + sgst as printed (or the printed tax total if shown).
- If a charge/line is not present on the bill, use null for that field (e.g. discount: null if no discount line exists) — do NOT invent a value.
- round_off is the signed printed round-off adjustment (e.g. -0.40, +0.10); use 0 if not present.
- Set "low_confidence" to a list of short strings describing anything you were unsure about (blurry text, ambiguous digit, unclear item, unreadable total) — empty array if fully confident.

Output exactly this JSON shape:
{
  "restaurant_name": string|null,
  "items": [{"name": string, "qty": number|string, "amount": number}],
  "subtotal": number|null,
  "discount": {"label": string, "amount": number} | null,
  "service_charge": {"rate_pct": number|null, "amount": number} | null,
  "tax": {"cgst": number|null, "sgst": number|null, "total": number} | null,
  "round_off": number,
  "grand_total": number|null,
  "low_confidence": [string]
}`;

async function extractReceipt(receiptBase64, mimeType) {
  return callVision({
    systemPrompt: SYSTEM_PROMPT,
    userText: "Extract this restaurant bill into the JSON shape described. Return JSON only.",
    imageBase64: receiptBase64,
    mimeType,
  });
}

module.exports = { extractReceipt, SYSTEM_PROMPT };
