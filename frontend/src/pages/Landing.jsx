import { useNavigate } from "react-router-dom";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="page">
      <h1>Fair Split</h1>
      <p className="sub">Photo of a bill + a plain-English "who had what" → a reconciled, per-person, who-owes-whom breakdown.</p>

      <div className="card">
        <p>
          Upload a receipt image, describe who had what (and who paid), and Fair Split works out each
          person's fair share — items, tax, service charge, and any discount — rounded to the rupee
          and checked against the bill's printed total.
        </p>
        <ul className="list" style={{ fontSize: 14, color: "#333" }}>
          <li>Shared items are split equally among the people who shared them.</li>
          <li>Tax and service charge are allocated proportional to each person's food subtotal.</li>
          <li>Anything ambiguous or that doesn't add up is flagged, not silently guessed.</li>
        </ul>
        <button onClick={() => navigate("/upload")}>Get started</button>
      </div>
    </div>
  );
}
