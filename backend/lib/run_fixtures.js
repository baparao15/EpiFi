const fs = require("fs");
const path = require("path");

const CASES = [
  {
    file: "r1_brew_bite.png",
    description:
      "Three of us — Ravi, Neha, Sameer. Ravi had the cappuccino and the sandwich. Neha had the pasta and the lime soda. Sameer had the brownie. Sameer paid.",
  },
  {
    file: "r2_tamarind_kitchen.png",
    description:
      "Four of us: Aman, Priya, Karan, Sara. The Gulab Jamun was shared just by Priya and Karan. Everything else was common to all four. Priya paid.",
  },
  {
    file: "r3_daily_grind.png",
    description:
      "Ishaan, Meera, Rohit. Pizza, pasta and garlic bread shared equally by all three. The two beers were Ishaan and Rohit only. The mojito was Meera's. Rohit paid.",
  },
  {
    file: "r4_spice_route.png",
    description:
      "Dev and Nikhil each had a chicken biryani. Anjali had the veg biryani. Farah had the rogan josh. The raita and soft drinks were common to all four. We used a 15% off coupon. Anjali paid.",
  },
];

async function main() {
  const dir = path.join(__dirname, "..", "..", "fixtures", "receipts");
  for (const c of CASES) {
    const imgPath = path.join(dir, c.file);
    const b64 = fs.readFileSync(imgPath).toString("base64");
    const res = await fetch("http://localhost:8787/api/split", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receipt_base64: b64, description: c.description }),
    });
    const data = await res.json();
    console.log("=".repeat(70));
    console.log(c.file, "status:", res.status);
    console.log(JSON.stringify(data, null, 2));
  }
}

main();
