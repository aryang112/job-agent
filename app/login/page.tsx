"use client";
import { useState } from "react";

export default function Login() {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) {
      window.location.href = "/";
    } else {
      setError("Wrong password");
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: "#080c18", minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Mono', monospace",
    }}>
      <form onSubmit={submit} style={{
        background: "#0d1526", border: "1px solid #1a2540", borderRadius: 6,
        padding: "36px 32px", width: 340, textAlign: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 24 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#00ff88", boxShadow: "0 0 8px #00ff88" }} />
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 14, color: "#e0ecff", letterSpacing: "0.12em" }}>JOB.AGENT</span>
        </div>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Password"
          autoFocus
          style={{
            width: "100%", padding: "10px 14px", background: "#080c18",
            border: "1px solid #1a2540", borderRadius: 4, color: "#c8d6ef",
            fontSize: 13, fontFamily: "inherit", outline: "none", marginBottom: 14,
          }}
        />
        {error && <div style={{ color: "#ff6b6b", fontSize: 11, marginBottom: 10 }}>{error}</div>}
        <button type="submit" disabled={loading} style={{
          width: "100%", padding: "10px", background: "#00ff88", color: "#060912",
          border: "none", borderRadius: 4, fontWeight: 700, fontSize: 12,
          fontFamily: "inherit", letterSpacing: "0.08em", cursor: "pointer",
        }}>
          {loading ? "..." : "ENTER"}
        </button>
      </form>
    </div>
  );
}
