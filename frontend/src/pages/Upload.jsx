import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Upload() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [base64, setBase64] = useState(null);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
    setBase64(await fileToBase64(file));
  }

  async function handleSubmit() {
    setError("");
    if (!base64) {
      setError("Please choose a receipt image first.");
      return;
    }
    if (!description.trim()) {
      setError("Please describe who had what.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ""}/api/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt_base64: base64, description: description.trim() }),
      });
      const data = await res.json();
      navigate("/result", { state: { result: data, ok: res.ok } });
    } catch (e) {
      setError("Network error: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <h1>Upload your bill</h1>
      <p className="sub">Add a photo of the receipt and describe who had what — name the payer too.</p>

      <div className="card">
        <label htmlFor="file">Receipt image</label>
        <input ref={fileInputRef} id="file" type="file" accept="image/*" onChange={handleFileChange} />
        {previewUrl && <img className="preview" src={previewUrl} alt="preview" />}

        <label htmlFor="desc" style={{ marginTop: 14 }}>
          Who had what (plain English, name the payer)
        </label>
        <textarea
          id="desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Aman skipped drinks. Priya and I shared the pasta. The cheesecake was Karan's. Everything else was common to all four of us. Priya paid the bill."
        />

        <button onClick={handleSubmit} disabled={loading}>
          {loading ? "Splitting…" : "Split the bill"}
        </button>
        {error && <div className="error">{error}</div>}
      </div>

      <details className="raw">
        <summary>Use the API directly instead</summary>
        <div className="card" style={{ marginTop: 10 }}>
          <p>
            <code>POST /api/split</code> with header <code>Content-Type: application/json</code> and this body:
          </p>
          <pre className="raw-json">{`{
  "receipt_base64": "<base64-encoded image bytes, no data-URI prefix>",
  "description": "<the plain-English string>"
}`}</pre>
          <p>Example with curl (reads an image file, base64-encodes it, and posts it):</p>
          <pre className="raw-json">{`curl -X POST http://localhost:8787/api/split \\
  -H "Content-Type: application/json" \\
  -d "{\\"receipt_base64\\": \\"$(base64 -w0 receipt.jpg)\\", \\"description\\": \\"Priya and I shared the pasta. Priya paid.\\"}"`}</pre>
          <p>The response is always this shape, whether the split succeeded or something needed to be flagged:</p>
          <pre className="raw-json">{`{
  "per_person": [{"name": "...", "items": [...], "subtotal": 0,
    "tax_share": 0, "service_share": 0, "discount_share": 0, "total": 0}],
  "grand_total": 0,
  "reconciliation": {"sum_of_person_totals": 0, "matches_bill": true},
  "paid_by": "...",
  "settle_up": [{"from": "...", "to": "...", "amount": 0}],
  "assumptions": ["..."],
  "flags": ["..."]
}`}</pre>
        </div>
      </details>
    </div>
  );
}
