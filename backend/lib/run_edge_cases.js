const fs = require("fs");
const path = require("path");

const CASES = [
  {
    name: "E1 no service charge",
    file: "e1_no_service_charge.png",
    description: "Two of us, Kunal and Zoya. Kunal had the burger and fries. Zoya had both cold coffees. Zoya paid.",
  },
  {
    name: "E2 printed total does not reconcile with its own line items",
    file: "e2_total_mismatch.png",
    description: "Two of us, Farhan and Ira. Farhan had the butter chicken and naan. Ira had the paneer tikka and lassi. Farhan paid.",
  },
  {
    name: "E5 bill has a tip line not covered by the stated fairness rules",
    file: "e5_extra_tip_line.png",
    description: "Two of us, Leo and Maya. Leo had the fish curry and one beer. Maya had the prawn fry and the rice. They split the remaining beers. Leo paid.",
  },
  {
    name: "E3 description mentions an item not on the bill",
    file: "r1_brew_bite.png",
    description:
      "Three of us — Ravi, Neha, Sameer. Ravi had the cappuccino and the sandwich. Neha had the pasta, the lime soda, and a mango lassi. Sameer had the brownie. Sameer paid.",
  },
  {
    name: "E4 ambiguous 'rest of us' wording",
    file: "r2_tamarind_kitchen.png",
    description:
      "Four of us: Aman, Priya, Karan, Sara. Aman skipped the Gulab Jamun. The rest of us shared it. Everything else was common to all four. Priya paid.",
  },
  {
    name: "E6 no payer stated",
    file: "r1_brew_bite.png",
    description: "Three of us — Ravi, Neha, Sameer. Ravi had the cappuccino and the sandwich. Neha had the pasta and the lime soda. Sameer had the brownie.",
  },
];

async function main() {
  const dir = path.join(__dirname, "..", "..", "fixtures", "receipts");
  for (const c of CASES) {
    const b64 = fs.readFileSync(path.join(dir, c.file)).toString("base64");
    const res = await fetch("http://localhost:8787/api/split", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receipt_base64: b64, description: c.description }),
    });
    const data = await res.json();
    console.log("=".repeat(70));
    console.log(c.name, "| status:", res.status);
    console.log("grand_total:", data.grand_total, "sum:", data.reconciliation?.sum_of_person_totals, "matches:", data.reconciliation?.matches_bill);
    console.log("paid_by:", data.paid_by);
    console.log("assumptions:", data.assumptions);
    console.log("flags:", data.flags);
    console.log("per_person:", data.per_person?.map((p) => `${p.name}:${p.total}`).join(", "));
  }
}

main();
