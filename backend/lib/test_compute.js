const { computeSplit } = require("./computeSplit");

const r2Receipt = {
  items: [
    { name: "Paneer Butter Masala", qty: 1, amount: 320 },
    { name: "Dal Makhani", qty: 1, amount: 260 },
    { name: "Butter Naan", qty: 4, amount: 240 },
    { name: "Jeera Rice", qty: 1, amount: 180 },
    { name: "Gulab Jamun", qty: "2pc", amount: 120 },
    { name: "Masala Papad", qty: 2, amount: 100 },
  ],
  subtotal: 1220,
  discount: null,
  service_charge: { rate_pct: 5, amount: 61 },
  tax: { cgst: 30.5, sgst: 30.5, total: 61 * (64.05 / 61) }, // just set total below
  round_off: -0.05,
  grand_total: 1345,
};
r2Receipt.tax.total = 64.05;

const r2Assignment = {
  people: ["Aman", "Priya", "Karan", "Sara"],
  payer: "Priya",
  item_mappings: [{ receipt_item: "Gulab Jamun", consumers: ["Priya", "Karan"] }],
  remaining_items_rule: "common_to_all",
  mentioned_items_not_on_bill: [],
  ambiguous_phrases: [],
};

const result = computeSplit(r2Receipt, r2Assignment);
console.log(JSON.stringify(result, null, 2));

const sum = result.per_person.reduce((a, b) => a + b.total, 0);
console.log("sum_of_person_totals check:", sum, "grand_total:", result.grand_total, "match:", sum === result.grand_total);
