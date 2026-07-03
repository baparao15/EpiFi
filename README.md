# Fair Split

Bill photo + plain-English "who had what" → a reconciled, per-person, who-owes-whom breakdown.

## Architecture

```
POST /api/split  { receipt_base64, description }
        │
        ├─ 1. extractReceipt(image)      Groq vision (llama-4-scout, multimodal) → structured
        │                                items/subtotal/tax/service/discount/total
        ├─ 2. extractAssignment(text)    Groq text (llama-3.3-70b-versatile, dense 70B) →
        │                                structured who-consumed-what + payer
        └─ 3. computeSplit(receipt, assignment)   pure JS — ALL arithmetic, ALL rounding, reconciliation
```

The LLM never does arithmetic — it only turns unstructured input (an image, a sentence) into
structured JSON. Every rupee is computed, rounded, and reconciled in
[`backend/lib/computeSplit.js`](backend/lib/computeSplit.js). See
[`docs/prompt-log.md`](docs/prompt-log.md) for why.

Groq has no dense 70B *vision* model, so OCR/extraction from the image stays on
`llama-4-scout-17b-16e-instruct` (multimodal); the text-only description-parsing step runs on
the dense 70B `llama-3.3-70b-versatile`. Both are configurable via `GROQ_VISION_MODEL` /
`GROQ_TEXT_MODEL` in `.env`.

The frontend (`frontend/`) is a small React app (Vite + react-router-dom), three routes:
- `/` — **Landing** page (what the tool does, a "Get started" button).
- `/upload` — the upload form (receipt image + description) and, in a collapsible section, the
  raw API contract for calling `/api/split` directly.
- `/result` — the breakdown, reached by submitting on `/upload`. Visiting it directly (e.g. a
  hard refresh) redirects back to `/upload` since there's no server-side state to restore.

### Multiple Groq API keys (rate-limit rotation)

`backend/lib/groqClient.js` accepts a comma-separated list of keys via `GROQ_API_KEYS` and
round-robins across them on every call. If a key comes back `429` (rate limited), it's put on
cooldown (honoring the `Retry-After` header if Groq sends one, else 60s) and the request
automatically retries the next available key — the caller never sees the rate limit. A `401`/
`403` (invalid/revoked key) puts that key on a 24h cooldown. Only if every key is currently
cooling down does the request fail, with an error naming how many keys and the earliest retry
time. Other errors (5xx, network) fail immediately without burning through the rest of the
keys, since they're not key-specific.

```
GROQ_API_KEYS=key_one,key_two,key_three,...,key_ten
```

A single `GROQ_API_KEY` still works if you only have one. See
[`backend/lib/test_key_rotation.js`](backend/lib/test_key_rotation.js) for the rotation logic
verified against mocked 429/401/500 responses (run `node lib/test_key_rotation.js` from
`backend/`) — actually exhausting real rate limits across many keys isn't practical to test
against live.

## Run locally

Two processes: the API backend, and the React frontend (dev server proxies `/api/*` to it).

```bash
# terminal 1 — backend
cd backend
npm install
cp .env.example .env      # then paste your GROQ_API_KEYS (console.groq.com) into .env
npm start                 # API at http://localhost:8787

# terminal 2 — frontend
cd frontend
npm install
npm run dev                # http://localhost:5173, proxies /api to :8787
```

Open `http://localhost:5173` (the landing page), click "Get started" to reach the upload form,
upload a receipt image, paste a description, click "Split the bill" — it redirects to the
result page.

## Test against the sample receipts / edge cases

No real bill photos were provided, so synthetic receipt images were generated for R1–R4 plus
several edge cases:

```bash
cd fixtures
python gen_receipts.py          # regenerates fixtures/receipts/*.png (requires Pillow)

cd ../backend
node lib/run_fixtures.js        # runs R1–R4 through the live /api/split endpoint
node lib/run_edge_cases.js      # runs the edge-case suite (no service charge, bill mismatch,
                                 # unmatched item, ambiguous wording, no payer)
```

Both scripts require the server to be running (`npm start` in another terminal) and a valid
`GROQ_API_KEYS` (or `GROQ_API_KEY`) in `.env`.

## Deploying

The backend is a stateless Express app with one required env var (`GROQ_API_KEYS`, or
`GROQ_API_KEY` for a single key). Two options:

- **One host, one process (simplest):** build the frontend (`cd frontend && npm run build`,
  producing `frontend/dist/`), then run the backend (`cd backend && npm start`). `server.js`
  auto-detects `frontend/dist/` and serves it (with a catch-all so `/result` survives a hard
  refresh) — so a single Node process serves both the API and the app. Deploy that one process
  to Render/Railway/Fly.io: build command `npm install --prefix backend && npm install --prefix
  frontend && npm run build --prefix frontend`, start command `npm start --prefix backend`, env
  var `GROQ_API_KEYS`.
- **Two hosts:** deploy `backend/` as a Node service (Render/Railway/Fly.io) and `frontend/` as
  a static site (Vercel/Netlify), pointing the frontend's API calls at the backend's URL (set
  `server.proxy` target in `vite.config.js` for dev, or add a `VITE_API_URL` env var for prod
  builds if you go this route).

Nothing here needs a database, auth, or persistence per the assignment's ground rules.

## Documents

- [`docs/prompt-log.md`](docs/prompt-log.md) — prompt iterations, and the model-vs-code
  arithmetic decision.
- [`docs/edge-cases.md`](docs/edge-cases.md) — every edge case considered, how it's handled,
  whether it was verified against a live run.
- [`docs/ai-mistakes.md`](docs/ai-mistakes.md) — 3 concrete cases where the model's first
  answer was wrong, how each was caught, and what was (or deliberately wasn't) fixed.

## Output contract

Every response — success, ambiguous input, or failure — is the same JSON shape:

```json
{
  "per_person": [{"name": "...", "items": [...], "subtotal": 0, "tax_share": 0, "service_share": 0, "discount_share": 0, "total": 0}],
  "grand_total": 0,
  "reconciliation": {"sum_of_person_totals": 0, "matches_bill": true},
  "paid_by": "...",
  "settle_up": [{"from": "...", "to": "...", "amount": 0}],
  "assumptions": ["..."],
  "flags": ["..."]
}
```

`matches_bill` is `true` only if: the bill's own printed numbers are internally consistent,
every item on the bill had a resolved consumer, and per-person totals sum exactly to the
grand total. A missing payer or an unmatched item mentioned in the description does **not**
by itself flip `matches_bill` to `false` — those are informational and live in `flags`
independently.
