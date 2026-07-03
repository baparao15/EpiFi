import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export default function Result() {
  const { state } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!state || !state.result) {
      navigate("/upload", { replace: true });
    }
  }, [state, navigate]);

  if (!state || !state.result) return null;

  const data = state.result;
  const matches = data.reconciliation && data.reconciliation.matches_bill;

  return (
    <div className="page">
      <h1>Fair Split</h1>
      <p className="sub">Result</p>

      {!state.ok && (
        <div className="card">
          <div className="error">Request did not fully succeed (see flags below for details).</div>
        </div>
      )}

      <div className="card">
        <h3>Per-person breakdown</h3>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Items</th>
              <th className="num">Subtotal</th>
              <th className="num">Tax</th>
              <th className="num">Service</th>
              <th className="num">Discount</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.per_person && data.per_person.length > 0 ? (
              data.per_person.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td>{(p.items || []).join(", ")}</td>
                  <td className="num">{p.subtotal}</td>
                  <td className="num">{p.tax_share}</td>
                  <td className="num">{p.service_share}</td>
                  <td className="num">{p.discount_share}</td>
                  <td className="num">
                    <strong>{p.total}</strong>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>No people could be resolved.</td>
              </tr>
            )}
          </tbody>
        </table>
        <p style={{ marginTop: 10 }}>
          Grand total: <strong>₹{data.grand_total ?? "?"}</strong> &nbsp; Sum of totals:{" "}
          <strong>₹{data.reconciliation ? data.reconciliation.sum_of_person_totals : "?"}</strong> &nbsp;
          <span className={`badge ${matches ? "ok" : "bad"}`}>{matches ? "Reconciled" : "Does not reconcile"}</span>
        </p>
        <p>
          Paid by: <strong>{data.paid_by || "— not identified —"}</strong>
        </p>
      </div>

      <div className="card">
        <h3>Settle up</h3>
        {data.settle_up && data.settle_up.length > 0 ? (
          <ul className="settle">
            {data.settle_up.map((s, i) => (
              <li key={i}>
                {s.from} owes {s.to} <strong>₹{s.amount}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p>Nothing to settle.</p>
        )}
      </div>

      <div className="card">
        <h3>Assumptions</h3>
        {data.assumptions && data.assumptions.length > 0 ? (
          <ul className="list assumptions">
            {data.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        ) : (
          <p>None.</p>
        )}
      </div>

      <div className="card">
        <h3>Flags</h3>
        {data.flags && data.flags.length > 0 ? (
          <ul className="list flags">
            {data.flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        ) : (
          <p>None — nothing looked off.</p>
        )}
      </div>

      <button className="secondary" onClick={() => navigate("/upload")}>
        Split another bill
      </button>

      <details className="raw">
        <summary>Show raw JSON</summary>
        <pre className="raw-json">{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}
