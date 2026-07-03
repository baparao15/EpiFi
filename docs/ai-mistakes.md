# Where the AI Was Wrong

Three concrete, reproducible cases from real testing against the live pipeline (Groq
`meta-llama/llama-4-scout-17b-16e-instruct`), not hypothetical ones.

## 1. Receipt OCR hallucinated a tax amount that wasn't printed

**Input:** a synthetic receipt ([`fixtures/receipts/e8_hard_ocr.png`](../fixtures/receipts/e8_hard_ocr.png))
with a tax line printed as `GST @ 5% (as applicable)` — i.e. the rate is stated but **no rupee
amount is printed next to it** — followed by a separate `Round Off  0.30` line.

**What went wrong:** the vision model returned `"tax": {"cgst": null, "sgst": null, "total": 0.3}`
and `"round_off": -0.3`. It appears to have grabbed the *Round Off* line's value (0.30) and used
it as the tax total, then re-derived a suspiciously matching but wrong round-off — instead of
recognizing that no GST amount was actually printed and reporting it faithfully (the extraction
prompt explicitly says "Only transcribe numbers that are actually printed" and to use `null`
for anything not shown). The real tax should have been roughly ₹110 (5% of subtotal + service),
not ₹0.30.

**How I caught it:** not by eyeballing the JSON — by running the *full* pipeline and looking at
`reconciliation`. Because the compute engine independently checks
`subtotal − discount + service + tax + round_off` against the printed grand total, the ₹0.30
vs. the true ~₹110 gap showed up immediately as:
```
"flags": ["Subtotal − discount + service + tax + round-off = ₹2198.7, but printed grand total
is ₹2309 — ₹110.3 unexplained."]
"reconciliation": {"matches_bill": false}
```
**Fix:** this is the one case in this list I deliberately did *not* patch with a special rule
for "tax line with no printed amount" — real receipts with a genuinely missing tax amount would
still need a human to resolve it, and inventing a formula to compute what the tax "should" be
would violate the "don't do arithmetic in the model, don't guess" design principle this whole
tool is built around. Instead this is exactly what `flags` is for: the tool refuses to present
a confident number and tells the user precisely how much is unaccounted for. I consider this
the desired failure mode, not a bug to eliminate — the actual bug (OCR misreading a value) is
upstream and out of my control; what's in my control is making sure it can't hide.

## 2. Assignment step contradicted itself: matched an item, then also flagged it as missing

**Input:** description *"Neha had the pasta, the lime soda, and a mango lassi"* against R1's
receipt, which has "Penne Arrabiata" (the pasta) but no lassi of any kind.

**What went wrong:** the model correctly matched `"pasta"` → `"Penne Arrabiata"` in
`item_mappings`, but **also** listed `"pasta"` a second time in `mentioned_items_not_on_bill`
(alongside the genuinely-unmatched "mango lassi"). The two output fields are supposed to be
mutually exclusive — this produced a spurious flag on an item that was actually handled
correctly, which (before the fix below) incorrectly forced `matches_bill: false` on an
otherwise-perfect split.

**How I caught it:** running the description-mentions-an-untracked-item edge case
(`run_edge_cases.js`, case E3) and reading the raw flags — "pasta" showing up as unmatched was
inconsistent with Neha's total being correct.

**Fix:** two layers. (1) Prompt fix in `extractAssignment.js`: added an explicit rule that
`mentioned_items_not_on_bill` and `item_mappings` are mutually exclusive, and to only use the
former if there is truly no entry in the latter. (2) Defensive code fix in `computeSplit.js`:
even if the model slips again, any `mentioned_items_not_on_bill` entry whose text exactly
matches a name already in `item_mappings` is silently dropped rather than flagged. Re-ran the
same case after the fix: only "mango lassi" is flagged, `matches_bill: true`. See
[prompt-log.md](prompt-log.md) for the before/after.

## 3. Silently wrong: unequal per-person consumption inside a shared line, collapsed to equal split

**Input:** *"Leo had the fish curry and one beer. Maya had the prawn fry and the rice. They
split the remaining beers."* against a receipt with a single `Beer` line, qty 3, ₹450 total
(i.e. Leo drinks 2 of the 3 beers — his own plus half of the remaining two — while Maya drinks 1).

**What went wrong:** the assignment schema only supports "split this line equally among a list
of named consumers." The model mapped `Beer` → consumers `[Leo, Maya]`, which the compute engine
splits 50/50 (₹225 each) — but the description actually implies a 2:1 split (₹300 / ₹150).
**This is the most dangerous kind of mistake in this list**, because unlike cases 1 and 2, it
produces a fully self-consistent, reconciled result (`matches_bill` would be `true` on this part
of the bill in isolation) — nothing in the output flags that the number is questionable. It's a
confident, wrong-ish answer, not an obviously broken one.

**How I caught it:** by hand-computing the expected 2:1 split and comparing it to the actual
`Beer (½)` label the tool produced for both people — not something the tool's own
reconciliation would ever surface, since 50/50 is internally consistent, just not what the text
meant.

**Fix:** not fixed, and I don't think it should be silently "fixed" by guessing weights from
free text (that's a much harder, much less reliable NLP problem, and getting *that* wrong would
be worse than being transparently equal-split). Documented as a known limitation in
[edge-cases.md](edge-cases.md) (case E5b) instead: the tool's stated behavior is "shared items
split equally among their named consumers," which matches fairness rule #2 as literally
written, but the group's actual per-person drinking pattern in the description was not
literally "equal." Worth calling out to whoever reviews the output rather than pretending the
tool understood something it didn't.
