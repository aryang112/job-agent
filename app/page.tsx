"use client";
import { useState, useEffect, useCallback } from "react";

const C = {
  bg: "#080c18", surface: "#0d1526", border: "#1a2540", muted: "#3a5080",
  text: "#c8d6ef", bright: "#e0ecff", green: "#00ff88", blue: "#7eb8f7",
  orange: "#f0a84b", red: "#ff6b6b", dim: "#1f2e4a"
};

function verdictColor(v: string) {
  if (v === "STRONG FIT") return C.green;
  if (v === "GOOD FIT") return C.blue;
  if (v === "WEAK FIT") return C.orange;
  return C.red;
}

function timeAgo(iso: string) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [filter, setFilter] = useState("new");
  const [selected, setSelected] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scanMsg, setScanMsg] = useState("");

  const fetchStats = useCallback(async () => {
    const r = await fetch("/api/stats");
    setStats(await r.json());
  }, []);

  const fetchJobs = useCallback(async (status: string) => {
    setLoading(true);
    const r = await fetch(`/api/jobs?status=${status}&limit=50`);
    setJobs(await r.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchJobs(filter); }, [filter, fetchJobs]);

  const updateJob = async (id: string, status: string, notes?: string) => {
    await fetch("/api/jobs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, notes })
    });
    setSelected(null);
    fetchJobs(filter);
    fetchStats();
  };

  const triggerScan = async () => {
    setScanning(true);
    setScanMsg("Scanning Indeed...");
    try {
      const r = await fetch("/api/scan", { method: "POST" });
      const d = await r.json();
      setScanMsg(`Done. ${d.jobs_new || 0} new jobs added.`);
      fetchStats();
      fetchJobs(filter);
    } catch {
      setScanMsg("Scan failed. Check API keys.");
    } finally {
      setScanning(false);
      setTimeout(() => setScanMsg(""), 5000);
    }
  };

  const FILTERS = [
    { key: "new", label: "TO APPLY", count: stats?.action_needed },
    { key: "all", label: "ALL JOBS", count: stats?.total },
    { key: "applied", label: "APPLIED", count: stats?.applied },
    { key: "interviewing", label: "INTERVIEWS", count: stats?.interviewing },
    { key: "skipped", label: "SKIPPED", count: stats?.skipped },
  ];

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text }}>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 3px; } ::-webkit-scrollbar-thumb { background: ${C.border}; }
        .card { border: 1px solid ${C.border}; border-radius: 5px; transition: all 0.15s; }
        .card:hover { border-color: ${C.muted}; cursor: pointer; }
        .card.sel { border-color: ${C.green}; background: #0b1820; }
        .btn { border: none; cursor: pointer; font-family: inherit; font-size: 11px; letter-spacing: 0.08em; border-radius: 3px; transition: all 0.15s; }
        .btn:hover { opacity: 0.85; } .btn:active { transform: scale(0.98); }
        .pulse { animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
        .fade { animation: fade 0.3s ease; }
        @keyframes fade { from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none} }
        .fbar { cursor: pointer; padding: 6px 14px; font-size: 10px; letter-spacing: 0.1em; border-radius: 3px; border: 1px solid ${C.border}; background: transparent; color: ${C.muted}; font-family: inherit; transition: all 0.15s; }
        .fbar:hover { color: ${C.text}; } .fbar.on { border-color: ${C.green}; color: ${C.green}; background: rgba(0,255,136,0.06); }
      `}</style>

      {/* Top bar */}
      <div style={{ background: "#060912", borderBottom: `1px solid ${C.border}`, padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.green, boxShadow: `0 0 8px ${C.green}` }} />
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 14, color: C.bright, letterSpacing: "0.12em" }}>JOB.AGENT</span>
          <span style={{ color: C.muted, fontSize: 10 }}>ARYAN GUPTA · PUBLIC TRUST · REMOTE</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {scanMsg && <span style={{ fontSize: 10, color: C.orange }} className="pulse">{scanMsg}</span>}
          {stats?.last_scan && <span style={{ fontSize: 10, color: C.muted }}>Last scan: {timeAgo(stats.last_scan)}</span>}
          <button className="btn" onClick={triggerScan} disabled={scanning}
            style={{ background: scanning ? C.dim : C.green, color: scanning ? C.muted : "#060912", padding: "7px 16px", fontWeight: 600 }}>
            {scanning ? "SCANNING..." : "↻ SCAN NOW"}
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 1, borderBottom: `1px solid ${C.border}`, background: C.border }}>
        {[
          { label: "ACTION NEEDED", val: stats?.action_needed ?? "—", color: C.green },
          { label: "STRONG FITS", val: stats?.strong_fits ?? "—", color: C.green },
          { label: "TOTAL FOUND", val: stats?.total ?? "—", color: C.blue },
          { label: "RESUMES SENT", val: stats?.applied ?? "—", color: C.blue },
          { label: "INTERVIEWING", val: stats?.interviewing ?? "—", color: C.orange },
        ].map(s => (
          <div key={s.label} style={{ background: C.surface, padding: "16px 20px" }}>
            <div style={{ fontSize: 28, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.val}</div>
            <div style={{ fontSize: 9, color: C.muted, marginTop: 5, letterSpacing: "0.12em" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs + content */}
      <div style={{ display: "flex", height: "calc(100vh - 130px)" }}>

        {/* Left: job list */}
        <div style={{ width: selected ? "44%" : "100%", borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", transition: "width 0.25s" }}>
          {/* Filter bar */}
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 6, alignItems: "center" }}>
            {FILTERS.map(f => (
              <button key={f.key} className={`fbar ${filter === f.key ? "on" : ""}`} onClick={() => setFilter(f.key)}>
                {f.label}{f.count != null ? ` (${f.count})` : ""}
              </button>
            ))}
          </div>

          {/* Job list */}
          <div style={{ overflowY: "auto", flex: 1, padding: "8px 12px" }}>
            {loading && <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 11 }} className="pulse">Loading jobs...</div>}
            {!loading && jobs.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 12 }}>
                {filter === "new" ? "No new jobs. Hit Scan Now." : "Nothing here yet."}
              </div>
            )}
            {(jobs as any[]).map(job => (
              <div key={job.id} className={`card fade ${selected?.id === job.id ? "sel" : ""}`}
                style={{ background: C.surface, padding: "12px 14px", marginBottom: 6 }}
                onClick={() => setSelected(selected?.id === job.id ? null : job)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 13, color: C.bright, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{job.title}</div>
                    <div style={{ fontSize: 10, color: C.muted }}>{job.company} · {job.location}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", color: verdictColor(job.verdict), lineHeight: 1 }}>{job.score}</div>
                    {job.status === "applied" && <div style={{ fontSize: 9, color: C.green }}>✓ APPLIED</div>}
                    {job.status === "interviewing" && <div style={{ fontSize: 9, color: C.orange }}>● INTERVIEW</div>}
                  </div>
                </div>
                <div style={{ height: 2, background: C.dim, borderRadius: 1, margin: "8px 0", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${job.score}%`, background: verdictColor(job.verdict), transition: "width 0.6s" }} />
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 2, background: `${verdictColor(job.verdict)}18`, color: verdictColor(job.verdict), border: `1px solid ${verdictColor(job.verdict)}35` }}>{job.verdict}</span>
                  {job.salary_estimate && job.salary_estimate !== "N/A" && <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 2, background: C.dim, color: C.blue }}>{job.salary_estimate}</span>}
                  {(job.key_requirements || []).slice(0, 2).map((r: string) => (
                    <span key={r} style={{ fontSize: 9, padding: "2px 7px", borderRadius: 2, background: C.dim, color: C.muted }}>{r}</span>
                  ))}
                </div>
                {job.match_reasons?.[0] && <div style={{ fontSize: 10, color: C.muted, marginTop: 5, lineHeight: 1.4 }}>↑ {job.match_reasons[0]}</div>}
                <div style={{ fontSize: 9, color: C.dim, marginTop: 4 }}>{timeAgo(job.found_at)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: job detail */}
        {selected && (
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }} className="fade">
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}>
              <div>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18, color: C.bright, marginBottom: 3 }}>{selected.title}</div>
                <div style={{ fontSize: 12, color: C.muted }}>{selected.company} · {selected.location}</div>
                {selected.salary && <div style={{ fontSize: 11, color: C.blue, marginTop: 2 }}>{selected.salary}</div>}
              </div>
              <button className="btn" onClick={() => setSelected(null)} style={{ background: C.dim, color: C.muted, padding: "5px 10px" }}>✕</button>
            </div>

            {/* Score */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: 18, marginBottom: 14, display: "flex", gap: 20, alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 52, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", color: verdictColor(selected.verdict), lineHeight: 1 }}>{selected.score}</div>
                <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>FIT SCORE</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: verdictColor(selected.verdict), marginBottom: 6 }}>{selected.verdict}</div>
                <div style={{ height: 4, background: C.dim, borderRadius: 2, overflow: "hidden", marginBottom: 8 }}>
                  <div style={{ height: "100%", width: `${selected.score}%`, background: verdictColor(selected.verdict), transition: "width 0.8s" }} />
                </div>
                <div style={{ fontSize: 11, color: C.text }}>Recommendation: <strong style={{ color: selected.apply_recommendation === "YES" ? C.green : C.orange }}>{selected.apply_recommendation}</strong></div>
                {selected.salary_estimate && selected.salary_estimate !== "N/A" && (
                  <div style={{ fontSize: 11, color: C.blue, marginTop: 4 }}>Est. Salary: {selected.salary_estimate}</div>
                )}
              </div>
            </div>

            {/* Pitch */}
            {selected.quick_pitch && (
              <div style={{ background: "rgba(0,255,136,0.05)", border: `1px solid rgba(0,255,136,0.18)`, borderRadius: 5, padding: "13px 15px", marginBottom: 14 }}>
                <div style={{ fontSize: 9, color: C.green, letterSpacing: "0.1em", marginBottom: 7 }}>YOUR PITCH FOR THIS ROLE</div>
                <div style={{ fontSize: 12, color: C.text, lineHeight: 1.7 }}>{selected.quick_pitch}</div>
              </div>
            )}

            {/* Match + Gaps */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: 13 }}>
                <div style={{ fontSize: 9, color: C.green, letterSpacing: "0.1em", marginBottom: 8 }}>✓ WHY YOU FIT</div>
                {(selected.match_reasons || []).map((r: string, i: number) => (
                  <div key={i} style={{ fontSize: 11, color: C.text, padding: "5px 0", borderBottom: `1px solid ${C.dim}`, lineHeight: 1.4 }}>→ {r}</div>
                ))}
              </div>
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: 13 }}>
                <div style={{ fontSize: 9, color: C.orange, letterSpacing: "0.1em", marginBottom: 8 }}>⚠ GAPS</div>
                {(selected.gaps || []).length > 0
                  ? (selected.gaps || []).map((g: string, i: number) => (
                    <div key={i} style={{ fontSize: 11, color: C.text, padding: "5px 0", borderBottom: `1px solid ${C.dim}`, lineHeight: 1.4 }}>△ {g}</div>
                  ))
                  : <div style={{ fontSize: 11, color: C.muted }}>No significant gaps</div>}
              </div>
            </div>

            {/* Key requirements */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.1em", marginBottom: 7 }}>KEY REQUIREMENTS</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {(selected.key_requirements || []).map((r: string) => (
                  <span key={r} style={{ fontSize: 10, padding: "3px 9px", background: C.dim, color: C.blue, borderRadius: 3 }}>{r}</span>
                ))}
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, marginBottom: 16 }}>
              <button className="btn" onClick={() => updateJob(selected.id, "applied")}
                style={{ background: C.green, color: "#060912", padding: "9px", fontWeight: 700 }}>✓ APPLIED</button>
              <button className="btn" onClick={() => { window.open(selected.url || `https://www.indeed.com/viewjob?jk=${selected.id}`, "_blank"); }}
                style={{ background: C.dim, color: C.blue, padding: "9px" }}>↗ OPEN JOB</button>
              <button className="btn" onClick={() => updateJob(selected.id, "interviewing")}
                style={{ background: C.dim, color: C.orange, padding: "9px" }}>● INTERVIEW</button>
              <button className="btn" onClick={() => updateJob(selected.id, "skipped")}
                style={{ background: C.dim, color: C.red, padding: "9px 13px" }}>✕</button>
            </div>

            {/* Application checklist */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: 13 }}>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.1em", marginBottom: 8 }}>APPLICATION CHECKLIST</div>
              {[
                "Upload: Aryan_Gupta_Backend_SDETResume.docx",
                "Name: Aryan Gupta · Email: aryangupta074@gmail.com · Phone: (443) 253-5169",
                "Location: Nottingham, MD 21236 (Remote preferred)",
                "Clearance: Public Trust (US Citizen)",
                "Copy pitch above into LinkedIn/Indeed summary field",
                "No cover letter required"
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", fontSize: 10, color: C.muted, alignItems: "flex-start" }}>
                  <span style={{ color: C.green, flexShrink: 0 }}>□</span><span>{item}</span>
                </div>
              ))}
            </div>

            {selected.description && (
              <details style={{ marginTop: 12 }}>
                <summary style={{ fontSize: 10, color: C.muted, cursor: "pointer", letterSpacing: "0.1em" }}>▸ FULL JOB DESCRIPTION</summary>
                <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.7, marginTop: 8, padding: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, whiteSpace: "pre-wrap" }}>
                  {selected.description}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
