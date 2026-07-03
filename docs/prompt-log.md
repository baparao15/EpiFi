# Prompt Log

## Arithmetic: model vs. code — and why

**Decision: extract structured data with the model, compute every number in code.** Two
different Groq models are used, once each per request: `llama-4-scout-17b-16e-instruct`
(multimodal — Groq has no dense 70B model that also does vision) for the receipt image, and
the dense 70B `llama-3.3-70b-versatile` for the text-only description-parsing step, since that
step is pure language understanding and benefits from the larger dense model.

1. **Receipt → JSON.** Read the image, transcribe item names/amounts/subtotal/discount/
   service/tax/round-off/grand-total into a fixed schema. Explicitly told: *"Do not compute,
   guess, or round anything. Only transcribe numbers that are actually printed."*
2. **Description → JSON.** Map free-text ("Priya and I shared the pasta") onto the receipt's
   item names and a list of consumers per item, plus who paid. Explicitly told: *"You do NOT
   do any arithmetic — only language understanding and mapping to structure."*

Everything after that — splitting shared items, proportional tax/service/discount allocation,
rounding, the reconciliation check, settle-up — happens in plain JavaScript
([`computeSplit.js`](../backend/lib/computeSplit.js)), with no LLM in the loop.

Why: the assignment's `reconciliation` field exists specifically to catch arithmetic that
doesn't add up. An LLM asked to "compute the tax share for 4 people" will frequently produce
numbers that don't sum to the tax total, or silently round differently for different people —
and it can't be trusted to *notice* its own error. A deterministic function either reconciles
exactly (by construction, via forced remainder-absorption — see rule 5 handling below) or it
doesn't, and when it doesn't, the mismatch is a **discovery about the input data** (e.g. the
bill's own arithmetic is broken) rather than **model noise**. That distinction is the entire
point of the `flags`/`assumptions` contract. Letting the model touch money would make every
mismatch ambiguous: is the bill wrong, or did the model just miscalculate again?

## Iteration history

### extractReceipt.js (vision → structured receipt)

- **v1.** Single pass: instructed the model to transcribe (not compute) every line item, qty,
  amount, subtotal, discount, service charge (with rate if shown), CGST/SGST or combined tax,
  signed round-off, grand total — using `null` for anything not printed on the bill (never
  invent a value), plus a `low_confidence` array for anything it wasn't sure about. Tested cold
  against all 4 real sample receipts (R1–R4, synthesized as images since no photos were
  provided — see [edge-cases.md](edge-cases.md)) and all extracted cleanly on the first try:
  correct items, correct subtotal/service/tax/round-off, correct grand total. No revision was
  needed — the schema constraints (line total not unit price, explicit "don't invent" rule,
  `low_confidence` escape hatch) held up on the first pass, so this stayed at v1.

### extractAssignment.js (description → structured assignment)

- **v1.** Given the receipt's exact item names as context, instructed the model to output
  `people`, `payer` (or `null` if not stated — never guess), `item_mappings` (receipt item →
  consumer list), a `remaining_items_rule` flag for "everything else was common to all," an
  `ambiguous_phrases` list for things like "the rest of us," and `mentioned_items_not_on_bill`
  for anything in the description that doesn't match a receipt item.
- **v2 (real fix, found via testing).** Ran the edge case "Neha had the pasta, the lime soda,
  and a mango lassi" against R1 (which has no mango lassi). The model correctly matched "pasta"
  → "Penne Arrabiata" in `item_mappings` **and incorrectly also listed "pasta" a second time**
  in `mentioned_items_not_on_bill`, alongside the genuinely-unmatched "mango lassi." That
  produced a spurious flag on an otherwise-correct split and (before a separate fix, below)
  incorrectly forced `matches_bill: false`. Fixed by adding an explicit rule: *"'
  mentioned_items_not_on_bill' and 'item_mappings' are mutually exclusive... only put something
  in mentioned_items_not_on_bill if it has NO entry in item_mappings at all."* Re-ran the same
  case: only "mango lassi" is flagged now. Also added a defensive dedupe in `computeSplit.js`
  (belt-and-suspenders) that drops any `mentioned_items_not_on_bill` entry whose string exactly
  matches a name already present in `item_mappings`.
- **v3 (real fix, found after switching to `llama-3.3-70b-versatile`).** R4's description
  includes "We used a 15% off coupon." The discount itself was applied correctly (proportional
  `discount_share` on every person, summing to exactly ₹228 as expected) — but the model
  additionally listed `"coupon"` in `mentioned_items_not_on_bill`, producing a spurious "no
  matching item found" flag on a word that was never meant to be a menu item. Fixed by
  narrowing the rule: *"If the description mentions a FOOD OR DRINK item that does NOT
  match... Do NOT put non-item mentions here — things like a discount code/coupon name, a tip,
  a payment method, or the payer's name are not food/drink items."* Re-ran R1–R4: no more
  spurious flags, `matches_bill: true` on all four with an empty `flags` array.

### computeSplit.js (the one real compute-engine bug found)

Not a prompt issue, but surfaced by the same test run: `matches_bill` was originally defined as
"reconciles AND zero flags of any kind," which meant a merely *informational* flag (no payer
stated, an unrelated item ignored) made an arithmetically-perfect split report as "does not
match." Fixed by splitting concerns: a `billArithmeticOk` flag now tracks only whether the
bill's own printed numbers are internally consistent (line items sum to printed subtotal;
subtotal − discount + service + tax + round-off equals the printed grand total). `matches_bill`
is `true` iff the bill is internally consistent, every item had a resolved consumer, and
per-person totals sum to the grand total — independent of unrelated flags like a missing payer.

## Rounding (rule 5)

Handled entirely in code, not by the model: each person's exact (fractional) item-split
subtotal is rounded to the nearest rupee; the difference between the sum of those roundings and
the rounded subtotal total is dumped onto one designated **absorber** (the payer, or the first
person alphabetically if no payer was named). The same absorb-the-remainder approach is applied
independently to tax, service, and discount shares (each proportional to rounded subtotal
weight), and finally to any residual gap between the sum of rounded components and the bill's
printed grand total (which folds in the bill's own printed round-off line). Every non-zero
absorption is written into `assumptions` by name, e.g. *"Bill-level rounding difference of ₹1
absorbed by Rohit."*
