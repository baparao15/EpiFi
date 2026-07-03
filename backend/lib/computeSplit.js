// All arithmetic for the Fair Split lives here. Nothing in this file talks to an LLM —
// it consumes structured JSON (receipt + assignment) and produces the contracted output
// shape deterministically, so results are reproducible and auditable.

const FRACTIONS = { 2: "½", 3: "⅓", 4: "¼", 5: "⅕", 6: "⅙" };

function fractionLabel(n, d) {
  if (n === d) return "";
  if (n === 1 && FRACTIONS[d]) return ` (${FRACTIONS[d]})`;
  return ` (${n}/${d})`;
}

function round(n) {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6; // keep float precision sane
}

function roundRupee(n) {
  return Math.round(n);
}

// Distributes `total` across `weights` (proportional), rounding each share to a whole
// rupee, then forces the rounded shares to sum exactly to round(total) by dumping the
// leftover paise onto `absorberIndex`. Returns { shares:number[], leftover:number }.
function proportionalRound(total, weights, absorberIndex) {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0 || total === 0) {
    const shares = weights.map(() => 0);
    return { shares, leftover: 0 };
  }
  const exact = weights.map((w) => (total * w) / weightSum);
  const shares = exact.map(roundRupee);
  const target = roundRupee(total);
  const sum = shares.reduce((a, b) => a + b, 0);
  const leftover = target - sum;
  shares[absorberIndex] += leftover;
  return { shares, leftover };
}

/**
 * @param {object} receipt   structured receipt from vision extraction
 * @param {object} assignment structured who-had-what from description extraction
 */
function computeSplit(receipt, assignment) {
  const flags = [];
  const assumptions = [];

  const people = Array.isArray(assignment.people) ? [...assignment.people] : [];
  const items = Array.isArray(receipt.items) ? receipt.items : [];

  // billArithmeticOk tracks whether the bill's own numbers are internally consistent —
  // kept separate from `flags` at large because informational flags (missing payer,
  // an item mentioned but not on the bill) shouldn't make an otherwise-correct
  // reconciliation report as "does not match".
  let billArithmeticOk = true;

  // ---- 0. sanity: line items vs printed subtotal, and the bill's own arithmetic ----
  const itemsSum = round(items.reduce((s, it) => s + (Number(it.amount) || 0), 0));
  const printedSubtotal = Number(receipt.subtotal);
  if (Number.isFinite(printedSubtotal) && Math.abs(itemsSum - printedSubtotal) > 0.5) {
    flags.push(
      `Extracted line items sum to ₹${itemsSum} but printed subtotal is ₹${printedSubtotal} — ₹${round(
        printedSubtotal - itemsSum
      )} unexplained.`
    );
    billArithmeticOk = false;
  }

  const discountAmount = receipt.discount && Number(receipt.discount.amount) ? Math.abs(Number(receipt.discount.amount)) : 0;
  const serviceAmount = receipt.service_charge && Number(receipt.service_charge.amount) ? Number(receipt.service_charge.amount) : 0;
  const taxAmount = receipt.tax && Number(receipt.tax.total) ? Number(receipt.tax.total) : 0;
  const roundOff = Number(receipt.round_off) || 0;
  const printedGrandTotal = Number(receipt.grand_total);

  const subtotalForCalc = Number.isFinite(printedSubtotal) ? printedSubtotal : itemsSum;
  const expectedGrandTotal = round(subtotalForCalc - discountAmount + serviceAmount + taxAmount + roundOff);
  if (Number.isFinite(printedGrandTotal) && Math.abs(expectedGrandTotal - printedGrandTotal) > 0.5) {
    flags.push(
      `Subtotal − discount + service + tax + round-off = ₹${expectedGrandTotal}, but printed grand total is ₹${printedGrandTotal} — ₹${round(
        printedGrandTotal - expectedGrandTotal
      )} unexplained.`
    );
    billArithmeticOk = false;
  }
  const grandTotal = Number.isFinite(printedGrandTotal) ? printedGrandTotal : expectedGrandTotal;

  // ---- 1. payer ----
  const payer = assignment.payer && people.includes(assignment.payer) ? assignment.payer : null;
  if (!payer) {
    flags.push("No payer could be identified from the description — settle-up cannot be computed.");
  }

  // ---- 2. ambiguous phrase resolutions -> assumptions ----
  for (const ap of assignment.ambiguous_phrases || []) {
    if (ap.phrase) {
      assumptions.push(
        `'${ap.phrase}' interpreted as ${Array.isArray(ap.resolved_as) ? ap.resolved_as.join(", ") : ap.resolved_as}${
          ap.note ? ` (${ap.note})` : ""
        }`
      );
    }
  }

  // ---- 3. items mentioned in description but not found on the bill ----
  // Defensive dedupe: if the model also matched this same name to a real receipt
  // item in item_mappings, it's not actually unmatched — skip the flag.
  const matchedReceiptItemNames = new Set(
    (assignment.item_mappings || []).map((m) => (m.receipt_item || "").toLowerCase())
  );
  for (const missing of assignment.mentioned_items_not_on_bill || []) {
    if (matchedReceiptItemNames.has(String(missing).toLowerCase())) continue;
    flags.push(`Description mentions "${missing}" but no matching item was found on the receipt — ignored.`);
  }

  if (people.length === 0) {
    flags.push("Could not identify any people from the description.");
    return {
      per_person: [],
      grand_total: roundRupee(grandTotal) || 0,
      reconciliation: { sum_of_person_totals: 0, matches_bill: false },
      paid_by: payer,
      settle_up: [],
      assumptions,
      flags,
    };
  }

  // ---- 4. resolve item -> consumers for every receipt item ----
  const mappingByItem = new Map();
  for (const m of assignment.item_mappings || []) {
    if (m.receipt_item) mappingByItem.set(m.receipt_item, m.consumers || []);
  }

  const remainingRule = assignment.remaining_items_rule === "common_to_all" ? "common_to_all" : "explicit_only";
  const personSubtotalExact = Object.fromEntries(people.map((p) => [p, 0]));
  const personItems = Object.fromEntries(people.map((p) => [p, []]));
  let anyUnresolved = false;

  for (const item of items) {
    const amount = Number(item.amount) || 0;
    let consumers = mappingByItem.get(item.name);

    if (!consumers) {
      if (remainingRule === "common_to_all") {
        consumers = people;
      } else {
        flags.push(`No one was explicitly assigned to "${item.name}" (₹${amount}) — excluded from the split.`);
        anyUnresolved = true;
        continue;
      }
    }

    consumers = consumers.filter((c) => people.includes(c));
    if (consumers.length === 0) {
      flags.push(`"${item.name}" (₹${amount}) has no valid consumers after matching to known people — excluded from the split.`);
      anyUnresolved = true;
      continue;
    }

    const share = amount / consumers.length;
    for (const c of consumers) {
      personSubtotalExact[c] += share;
      const label = item.name + fractionLabel(1, consumers.length);
      personItems[c].push(consumers.length > 1 ? label : item.name);
    }
  }

  // ---- 5. round each person's subtotal to the rupee, absorb leftover paise ----
  const absorber = payer || people[0];
  const absorberIdx = people.indexOf(absorber);

  const exactSubtotals = people.map((p) => personSubtotalExact[p]);
  const roundedSubtotals = exactSubtotals.map(roundRupee);
  const subtotalLeftover = roundRupee(exactSubtotals.reduce((a, b) => a + b, 0)) - roundedSubtotals.reduce((a, b) => a + b, 0);
  roundedSubtotals[absorberIdx] += subtotalLeftover;
  if (subtotalLeftover !== 0) {
    assumptions.push(
      `Item-split produced a ₹${Math.abs(subtotalLeftover)} rounding remainder (fractional shares from odd-way splits) — absorbed by ${absorber}.`
    );
  }

  // ---- 6. proportional tax / service / discount, using rounded subtotals as weights ----
  const { shares: taxShares, leftover: taxLeftover } = proportionalRound(taxAmount, roundedSubtotals, absorberIdx);
  const { shares: serviceShares, leftover: serviceLeftover } = proportionalRound(serviceAmount, roundedSubtotals, absorberIdx);
  const { shares: discountSharesPos, leftover: discountLeftover } = proportionalRound(discountAmount, roundedSubtotals, absorberIdx);

  if (taxLeftover !== 0 || serviceLeftover !== 0 || discountLeftover !== 0) {
    assumptions.push(`Proportional tax/service/discount rounding remainders absorbed by ${absorber}.`);
  }

  const totals = people.map((p, i) => {
    const subtotal = roundedSubtotals[i];
    const tax_share = taxShares[i];
    const service_share = serviceShares[i];
    const discount_share = discountAmount ? -discountSharesPos[i] : 0;
    return subtotal + tax_share + service_share + discount_share;
  });

  // Fold the bill's own round-off plus any residual drift between our rounded
  // components and the printed grand total into a single whole-rupee adjustment
  // on the absorber, so per-person totals always sum to a whole number of rupees.
  const preliminarySum = totals.reduce((a, b) => a + b, 0);
  const finalLeftover = anyUnresolved ? 0 : roundRupee(grandTotal) - preliminarySum;
  if (finalLeftover !== 0) {
    totals[absorberIdx] += finalLeftover;
    assumptions.push(
      `Bill-level rounding difference of ₹${finalLeftover} (incl. printed round-off) absorbed by ${absorber}.`
    );
  }

  const per_person = people.map((p, i) => ({
    name: p,
    items: personItems[p],
    subtotal: roundedSubtotals[i],
    tax_share: taxShares[i],
    service_share: serviceShares[i],
    discount_share: discountAmount ? -discountSharesPos[i] : 0,
    total: totals[i],
  }));

  const sum_of_person_totals = per_person.reduce((a, b) => a + b.total, 0);
  const matches_bill = billArithmeticOk && !anyUnresolved && Math.abs(sum_of_person_totals - grandTotal) < 0.5;

  if (anyUnresolved) {
    flags.push(
      `Because some items were excluded, per-person totals sum to ₹${sum_of_person_totals} rather than the ₹${grandTotal} grand total.`
    );
  } else if (Math.abs(sum_of_person_totals - grandTotal) >= 0.5) {
    flags.push(
      `Per-person totals sum to ₹${sum_of_person_totals}, which differs from the printed grand total ₹${grandTotal} by ₹${round(
        sum_of_person_totals - grandTotal
      )}.`
    );
  }

  // ---- 7. settle-up (single payer paid the full bill) ----
  const settle_up = [];
  if (payer) {
    for (const person of per_person) {
      if (person.name !== payer && person.total !== 0) {
        settle_up.push({ from: person.name, to: payer, amount: person.total });
      }
    }
  }

  return {
    per_person,
    grand_total: roundRupee(grandTotal),
    reconciliation: {
      sum_of_person_totals: roundRupee(sum_of_person_totals),
      matches_bill,
    },
    paid_by: payer,
    settle_up,
    assumptions,
    flags,
  };
}

module.exports = { computeSplit, proportionalRound, roundRupee };
