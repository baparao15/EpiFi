require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const { extractReceipt } = require("./lib/extractReceipt");
const { extractAssignment } = require("./lib/extractAssignment");
const { computeSplit } = require("./lib/computeSplit");

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));

// In dev, the React app runs on its own Vite server (frontend/) and proxies /api here.
// In production, `npm run build` in frontend/ produces frontend/dist — serve it (with a
// catch-all so client-side routes like /result survive a hard refresh) if it exists.
const frontendDist = path.join(__dirname, "..", "frontend", "dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(frontendDist, "index.html")));
}

function emptyResult(flags) {
  return {
    per_person: [],
    grand_total: 0,
    reconciliation: { sum_of_person_totals: 0, matches_bill: false },
    paid_by: null,
    settle_up: [],
    assumptions: [],
    flags,
  };
}

app.post("/api/split", async (req, res) => {
  const { receipt_base64, description } = req.body || {};

  if (!receipt_base64 || typeof receipt_base64 !== "string") {
    return res.status(400).json(emptyResult(["Missing or invalid 'receipt_base64'."]));
  }
  if (!description || typeof description !== "string") {
    return res.status(400).json(emptyResult(["Missing or invalid 'description'."]));
  }

  try {
    const receipt = await extractReceipt(receipt_base64, "image/jpeg");

    if (!receipt.items || receipt.items.length === 0) {
      return res.json(emptyResult(["Could not read any line items from the receipt image."]));
    }

    const assignment = await extractAssignment(description, receipt.items);

    const result = computeSplit(receipt, assignment);

    if (receipt.low_confidence && receipt.low_confidence.length > 0) {
      result.flags.push(...receipt.low_confidence.map((f) => `OCR low confidence: ${f}`));
    }

    res.json(result);
  } catch (err) {
    console.error("split error:", err);
    res.status(500).json(emptyResult([`Server error: ${err.message}`]));
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`Fair Split backend listening on :${PORT}`));
