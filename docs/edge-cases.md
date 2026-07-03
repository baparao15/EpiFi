# Edge Cases

No real bill photos were supplied with the assignment, so all inputs below (R1–R4 and every
edge case) were rendered as synthetic receipt PNGs via
[`fixtures/gen_receipts.py`](../fixtures/gen_receipts.py) and run through the live deployed
pipeline (Groq vision + text extraction, then the deterministic compute engine) — nothing in
this document is a hypothetical prediction. Raw request/response pairs are reproducible via
[`backend/lib/run_fixtures.js`](../backend/lib/run_fixtures.js) and
[`run_edge_cases.js`](../backend/lib/run_edge_cases.js).

Legend: ✅ verified against a live run · ⚠️ handled by design, not separately verified · ⛔ knowingly not handled

## Cases from the 4 sample receipts (R1–R4)

| # | Input | Handling | Verified |
|---|---|---|---|
| R1 | 3 people, only individual items, no discount | Each item mapped to exactly one person; proportional tax/service on subtotal | ✅ `matches_bill: true`, ₹1147 |
| R2 | 4 people, one item shared by 2 of 4, rest "common to all four" | `remaining_items_rule: common_to_all` fills in unmentioned items; Gulab Jamun split only between Priya & Karan | ✅ `matches_bill: true`, ₹1345 |
| R3 | 3 people, 3-way shared items + 2-way shared item + 1 individual item | Fractional splits (e.g. ₹380/3) rounded per person, ₹1 leftover absorbed by payer | ✅ `matches_bill: true`, ₹1720 |
| R4 | 4 people, "each had one" (qty-2 line treated as 2-way shared), bill-level 15% discount | Discount allocated proportional to subtotal, independent of tax/service | ✅ `matches_bill: true`, ₹1436 |

## Additional edge cases probed

| # | Input | Handling | Verified |
|---|---|---|---|
| E1 | Bill with **no service charge line at all** | `service_charge: null` → treated as 0; no fabricated service line | ✅ `matches_bill: true`, ₹462 |
| E2 | **Printed grand total doesn't reconcile with its own line items** (bill's own arithmetic is wrong by ₹24) | Split is still computed against the printed total (so the group can still settle up), but `flags` names the exact unexplained amount and `matches_bill` is forced to `false` | ✅ flag: *"...₹24.15 unexplained"*, `matches_bill: false` |
| E3 | Description mentions an item **not on the bill** ("a mango lassi") | Ignored from the split; named explicitly in `flags` rather than silently dropped or hallucinated as a receipt item | ✅ flag naming the exact phrase; rest of split unaffected, `matches_bill: true` |
| E4 | Ambiguous group reference — **"the rest of us"** | Resolved to the concrete name list and the resolution is written into `assumptions` so a human can check it | ✅ *"'the rest of us' interpreted as Priya, Karan, Sara"* |
| E5a | Bill has a **line item the fairness rules don't cover** (a staff-added "Tip") | The rules only define subtotal/discount/service/tax. Rather than silently fold the tip into someone's share or invent a 6th allocation rule, the gap between reconciled components and the printed total is surfaced as an unexplained amount in `flags`, and `matches_bill: false` | ✅ flag: *"...₹100.1 unexplained"* (= the tip) |
| E5b | **Uneven quantity within one shared line** — "Leo had one beer, then they split the remaining beers" (3 beers on one ₹450 line, consumption is 2:1, not 1:1) | ⛔ **Not handled precisely.** The assignment schema only supports "equal split among named consumers" per line item; it has no concept of per-unit weighting within a line. The tool split the ₹450 line 50/50 between Leo and Maya, which is *not* what the text implies (Leo drank two-thirds). See `ai-mistakes.md` #3. | ✅ (verified the simplification happens; not a case where the numbers are "right") |
| E6 | **No payer stated** in the description | `paid_by: null`, `settle_up: []`, and an explicit flag explains why settle-up couldn't be computed — the tool does not guess who paid | ✅ flag: *"No payer could be identified..."*, rest of split still reconciles (`matches_bill: true`) |
| E7 | Completely **unreadable/blank receipt image** | Returns the full contracted JSON shape with empty `per_person`, `grand_total: 0`, and a flag — never a raw 500 or a malformed response | ✅ flag: *"Could not read any line items..."* |

## Cases considered but not built (with reasoning)

- **Multiple bill-level discounts / stacked coupons.** The schema has one `discount` object.
  A bill with two separate discount lines would have the second one either merged into the
  first by the vision model or silently dropped — not verified either way. Given the time box,
  I chose not to special-case this; a bill with two discount lines would likely produce a
  subtotal/grand-total mismatch flag (caught, not silently wrong) rather than a clean split.
- **Per-person itemized quantity weighting** (see E5b above) — a real limitation, documented
  rather than fixed, because fixing it requires a materially different schema (fractional
  ownership per unit within a line, not just a consumer list) and the assignment's own fairness
  rules ("shared items split equally among the people who shared that specific item") don't
  actually ask for unequal weighting — they define equal splitting as the rule. E5b is really a
  case of the *description* implying something the *stated fairness rules* don't model, which
  is arguably out of scope by the letter of the rules, but worth flagging as a gap.
- **Multiple payers / split payment** (e.g. "Priya and Karan split the bill 50/50 upfront").
  The output contract has a single `paid_by: string`. Not attempted — would require redefining
  the settle-up shape entirely, which the contract doesn't allow for.
- **Currency/locale variance** (bills not in ₹, or non-Indian tax schemes like a flat VAT%).
  The vision prompt transcribes whatever numbers are printed regardless of currency symbol, and
  the compute engine is currency-agnostic (it never hardcodes "₹" in the math, only in flag
  text) — likely works, but not tested against a non-INR bill.
- **Handwritten or heavily crumpled/rotated receipts.** No such image was available to
  construct; flagged as a known gap rather than claimed as tested. The `low_confidence` field
  in the extraction schema is the intended safety net (the model is asked to name anything it's
  unsure about) but its behavior on genuinely poor-quality photos is unverified.
