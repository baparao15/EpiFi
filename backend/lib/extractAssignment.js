const { callText } = require("./groqClient");

// v3 — see /docs/prompt-log.md for what changed between versions and why.
const SYSTEM_PROMPT = `You turn a plain-English "who had what" description into structured JSON. You are given the exact list of item names already extracted from a receipt. You do NOT do any arithmetic — only language understanding and mapping to structure.

Rules:
- "people" is the full list of distinct people in the group, taken from the description (exclude staff/restaurant names).
- "payer" is whoever the description says paid the bill. If no payer is stated or it's ambiguous, set payer to null — do NOT guess.
- For every receipt item that the description assigns to specific people (individually or shared), add one entry to "item_mappings": {"receipt_item": <exact name from the provided item list>, "consumers": [<people>]}. Match receipt items by meaning even if the description phrases them differently (e.g. "the pasta" -> "Penne Arrabiata"), but only match to an item that is actually in the provided list.
- If the description says something like "everything else was common to all", "rest of us shared the rest", etc., set "remaining_items_rule" to "common_to_all". If the description never states a default for unmentioned items, set it to "explicit_only".
- If the description names people as "the rest of us" / "everyone" / "all of us", resolve that phrase to the actual list of names and record it in "ambiguous_phrases" as {"phrase": "...", "resolved_as": [...], "note": "..."}. Do this for any other ambiguous wording you had to interpret.
- If the description mentions a FOOD OR DRINK item that does NOT match anything in the provided receipt item list, add its description text to "mentioned_items_not_on_bill" — do not force a match. Do NOT put non-item mentions here — things like a discount code/coupon name, a tip, a payment method, or the payer's name are not food/drink items and must never appear in "mentioned_items_not_on_bill" even if they don't match a receipt line.
- IMPORTANT: "mentioned_items_not_on_bill" and "item_mappings" are mutually exclusive. If you already matched a description phrase to a receipt item in "item_mappings", do NOT also add that same phrase (or the receipt item's name) to "mentioned_items_not_on_bill". Only put something in "mentioned_items_not_on_bill" if it has NO entry in "item_mappings" at all.
- A person can appear as a consumer of multiple items. A shared item's consumers list should contain everyone who shared THAT item, not the whole group, unless the whole group shared it.
- Never invent people, items, or a payer that are not supported by the text.

Output exactly this JSON shape:
{
  "people": [string],
  "payer": string|null,
  "item_mappings": [{"receipt_item": string, "consumers": [string]}],
  "remaining_items_rule": "common_to_all" | "explicit_only",
  "mentioned_items_not_on_bill": [string],
  "ambiguous_phrases": [{"phrase": string, "resolved_as": [string], "note": string}]
}`;

async function extractAssignment(description, receiptItems) {
  const itemList = receiptItems.map((it) => `- ${it.name} (₹${it.amount})`).join("\n");
  const userText = `Receipt items:\n${itemList}\n\nDescription:\n"""${description}"""\n\nReturn JSON only.`;
  return callText({ systemPrompt: SYSTEM_PROMPT, userText });
}

module.exports = { extractAssignment, SYSTEM_PROMPT };
