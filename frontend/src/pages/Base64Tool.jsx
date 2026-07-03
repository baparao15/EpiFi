import { useState } from "react";
import { useNavigate } from "react-router-dom";

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Base64Tool() {
  const navigate = useNavigate();
  const [previewUrl, setPreviewUrl] = useState(null);
  const [base64, setBase64] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    setCopied(false);
    setPreviewUrl(URL.createObjectURL(file));
    setBase64(await fileToBase64(file));
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(base64);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="page">
      <h1>Image → base64</h1>
      <p className="sub">
        Upload an image and get its base64 string back — handy for building the{" "}
        <code>receipt_base64</code> field when calling <code>/api/split</code> directly.
      </p>

      <div className="card">
        <label htmlFor="file">Image</label>
        <input id="file" type="file" accept="image/*" onChange={handleFileChange} />
        {previewUrl && <img className="preview" src={previewUrl} alt="preview" />}

        {base64 && (
          <>
            <label htmlFor="b64" style={{ marginTop: 14 }}>
              Base64 string ({base64.length.toLocaleString()} characters)
            </label>
            <textarea id="b64" readOnly value={base64} style={{ minHeight: 140, fontFamily: "monospace", fontSize: 12 }} />
            <button onClick={handleCopy}>{copied ? "Copied!" : "Copy to clipboard"}</button>
          </>
        )}
      </div>

      <button className="secondary" onClick={() => navigate("/upload")}>
        Back to upload
      </button>
    </div>
  );
}
