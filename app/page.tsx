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

const ALL_STATUSES = [
  "new", "queued_to_apply", "applied", "failed", "manual_required",
  "no_response", "screening", "interviewing", "offer", "rejected", "withdrawn"
];

const STATUS_LABELS: Record<string, string> = {
  new: "New", queued_to_apply: "Queued", applied: "Applied", failed: "Failed",
  manual_required: "Manual Required", no_response: "No Response", screening: "Screening",
  interviewing: "Interviewing", offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn"
};

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [filter, setFilter] = useState("to_apply");
  const [selected, setSelected] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scanMsg, setScanMsg] = useState("");
  const [searchText, setSearchText] = useState("");
  const [sortBy, setSortBy] = useState("score");
  const [appLog, setAppLog] = useState<any[]>([]);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState<any[]>([]);
  const [noteForm, setNoteForm] = useState<any>(null);
  const [userNotes, setUserNotes] = useState("");

  const fetchStats = useCallback(async () => {
    const r = await fetch("/api/stats");
    setStats(await r.json());
  }, []);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("status", filter);
    params.set("limit", "50");
    params.set("sort", sortBy);
    params.set("order", "desc");
    if (searchText) params.set("search", searchText);
    const r = await fetch(`/api/jobs?${params}`);
    setJobs(await r.json());
    setLoading(false);
  }, [filter, sortBy, searchText]);

  const fetchNotes = useCallback(async () => {
    const r = await fetch("/api/notes");
    if (r.ok) setNotes(await r.json());
  }, []);

  const fetchAppLog = useCallback(async (jobId: string) => {
    const r = await fetch(`/api/application-log?job_id=${jobId}`);
    if (r.ok) setAppLog(await r.json());
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  useEffect(() => {
    if (selected) {
      setUserNotes(selected.user_notes || "");
      fetchAppLog(selected.id);
    }
  }, [selected, fetchAppLog]);

  const updateJob = async (id: string, status: string, extra?: any) => {
    await fetch("/api/jobs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, ...extra })
    });
    setSelected(null);
    fetchJobs();
    fetchStats();
  };

  const saveUserNotes = async (id: string) => {
    await fetch("/api/jobs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, user_notes: userNotes })
    });
  };

  const triggerScan = async () => {
    setScanning(true);
    setScanMsg("Scanning Indeed...");
    try {
      const r = await fetch("/api/scan", { method: "POST" });
      const d = await r.json();
      setScanMsg(`Done. ${d.jobs_new || 0} new, ${d.jobs_queued || 0} queued.`);
      fetchStats();
      fetchJobs();
    } catch {
      setScanMsg("Scan failed. Check API keys.");
    } finally {
      setScanning(false);
      setTimeout(() => setScanMsg(""), 5000);
    }
  };

  const logout = async () => {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.href = "/login";
  };

  const saveNote = async () => {
    if (!noteForm) return;
    if (noteForm.id) {
      await fetch(`/api/notes/${noteForm.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(noteForm)
      });
    } else {
      await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(noteForm)
      });
    }
    setNoteForm(null);
    fetchNotes();
  };

  const deleteNote = async (id: number) => {
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
    fetchNotes();
  };

  const FILTERS = [
    { key: "to_apply", label: "TO APPLY", count: (stats?.queued_to_apply || 0) + (stats?.strong_fits_pending || 0) },
    { key: "applied", label: "APPLIED", count: stats?.total_applied },
    { key: "interviewing", label: "INTERVIEWING", count: stats?.active_interviews },
    { key: "manual_required", label: "MANUAL ACTION", count: stats?.manual_required, alert: true },
    { key: "all", label: "ALL", count: stats?.total },
  ];

  const STAT_CARDS = [
    { label: "APPLIED TODAY", val: stats?.applied_today ?? "—", color: C.green },
    { label: "APPLIED THIS WEEK", val: stats?.applied_this_week ?? "—", color: C.green },
    { label: "TOTAL APPLIED", val: stats?.total_applied ?? "—", color: C.blue },
    { label: "ACTIVE INTERVIEWS", val: stats?.active_interviews ?? "—", color: C.orange },
    { label: "MANUAL REQUIRED", val: stats?.manual_required ?? "—", color: C.red },
    { label: "STRONG FITS PENDING", val: stats?.strong_fits_pending ?? "—", color: C.green },
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
        .fbar { cursor: pointer; padding: 6px 14px; font-size: 10px; letter-spacing: 0.1em; border-radius: 3px; border: 1px solid ${C.border}; background: transparent; color: ${C.muted}; font-family: inherit; transition: all 0.15s; position: relative; }
        .fbar:hover { color: ${C.text}; } .fbar.on { border-color: ${C.green}; color: ${C.green}; background: rgba(0,255,136,0.06); }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100; display: flex; align-items: center; justify-content: center; }
        .modal { background: ${C.surface}; border: 1px solid ${C.border}; border-radius: 8px; padding: 24px; width: 700px; max-height: 80vh; overflow-y: auto; }
        select, input, textarea { background: ${C.bg}; border: 1px solid ${C.border}; color: ${C.text}; font-family: inherit; font-size: 11px; padding: 6px 10px; border-radius: 3px; outline: none; }
        select:focus, input:focus, textarea:focus { border-color: ${C.green}; }
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
          <button className="btn" onClick={() => { setShowNotes(true); fetchNotes(); }}
            style={{ background: C.dim, color: C.blue, padding: "7px 14px" }}>NOTES BANK</button>
          <button className="btn" onClick={triggerScan} disabled={scanning}
            style={{ background: scanning ? C.dim : C.green, color: scanning ? C.muted : "#060912", padding: "7px 16px", fontWeight: 600 }}>
            {scanning ? "SCANNING..." : "SCAN NOW"}
          </button>
          <button className="btn" onClick={logout}
            style={{ background: C.dim, color: C.red, padding: "7px 12px" }}>LOGOUT</button>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 1, borderBottom: `1px solid ${C.border}`, background: C.border }}>
        {STAT_CARDS.map(s => (
          <div key={s.label} style={{ background: C.surface, padding: "14px 18px" }}>
            <div style={{ fontSize: 26, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.val}</div>
            <div style={{ fontSize: 8, color: C.muted, marginTop: 5, letterSpacing: "0.12em" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Active interviews banner */}
      {stats?.active_interviews > 0 && (
        <div style={{ background: "rgba(240,168,75,0.1)", borderBottom: `1px solid ${C.orange}33`, padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, color: C.orange, fontWeight: 600 }}>
            {stats.active_interviews} ACTIVE INTERVIEW{stats.active_interviews > 1 ? "S" : ""} IN PIPELINE
          </span>
          <button className="btn" onClick={() => setFilter("interviewing")}
            style={{ background: C.orange, color: "#060912", padding: "5px 14px", fontWeight: 600 }}>VIEW</button>
        </div>
      )}

      {/* Filter tabs + search/sort + content */}
      <div style={{ display: "flex", height: `calc(100vh - ${stats?.active_interviews > 0 ? "175px" : "135px"})` }}>

        {/* Left: job list */}
        <div style={{ width: selected ? "44%" : "100%", borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", transition: "width 0.25s" }}>
          {/* Filter bar */}
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 6, alignItems: "center" }}>
            {FILTERS.map(f => (
              <button key={f.key} className={`fbar ${filter === f.key ? "on" : ""}`} onClick={() => setFilter(f.key)}>
                {f.label}{f.count != null ? ` (${f.count})` : ""}
                {f.alert && (f.count || 0) > 0 && (
                  <span style={{ position: "absolute", top: -3, right: -3, width: 8, height: 8, borderRadius: "50%", background: C.red }} />
                )}
              </button>
            ))}
          </div>

          {/* Search + sort */}
          <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              placeholder="Search title or company..."
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={{ flex: 1 }}
            />
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="score">Sort: Score</option>
              <option value="date">Sort: Date</option>
              <option value="company">Sort: Company</option>
            </select>
          </div>

          {/* Job list */}
          <div style={{ overflowY: "auto", flex: 1, padding: "8px 12px" }}>
            {loading && <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 11 }} className="pulse">Loading jobs...</div>}
            {!loading && jobs.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 12 }}>
                {filter === "to_apply" ? "No jobs to apply to. Hit Scan Now." : "Nothing here yet."}
              </div>
            )}
            {(jobs as any[]).map(job => (
              <div key={job.id} className={`card fade ${selected?.id === job.id ? "sel" : ""}`}
                style={{ background: C.surface, padding: "12px 14px", marginBottom: 6 }}
                onClick={() => setSelected(selected?.id === job.id ? null : job)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 13, color: C.bright, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{job.title}</div>
                    </div>
                    <div style={{ fontSize: 10, color: C.muted, display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                      {job.company} · {job.location}
                      {/* Federal/Defense badges */}
                      {job.is_defense_prime && (
                        <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 2, background: "rgba(126,184,247,0.15)", color: C.blue, border: `1px solid ${C.blue}44` }}>DEFENSE PRIME</span>
                      )}
                      {job.is_federal && !job.is_defense_prime && (
                        <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 2, background: "rgba(126,184,247,0.1)", color: C.blue, border: `1px solid ${C.blue}33` }}>FEDERAL</span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", color: verdictColor(job.verdict), lineHeight: 1 }}>{job.score}</div>
                    {job.status === "applied" && <div style={{ fontSize: 9, color: C.green }}>APPLIED</div>}
                    {job.status === "queued_to_apply" && <div style={{ fontSize: 9, color: C.orange }}>QUEUED</div>}
                    {job.status === "interviewing" && <div style={{ fontSize: 9, color: C.orange }}>INTERVIEW</div>}
                    {job.status === "screening" && <div style={{ fontSize: 9, color: C.orange }}>SCREENING</div>}
                    {job.status === "manual_required" && <div style={{ fontSize: 9, color: C.red }}>MANUAL</div>}
                    {job.status === "failed" && <div style={{ fontSize: 9, color: C.red }}>FAILED</div>}
                    {job.status === "offer" && <div style={{ fontSize: 9, color: C.green }}>OFFER</div>}
                  </div>
                </div>
                <div style={{ height: 2, background: C.dim, borderRadius: 1, margin: "8px 0", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${job.score}%`, background: verdictColor(job.verdict), transition: "width 0.6s" }} />
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 2, background: `${verdictColor(job.verdict)}18`, color: verdictColor(job.verdict), border: `1px solid ${verdictColor(job.verdict)}35` }}>{job.verdict}</span>
                  {job.salary_estimate && job.salary_estimate !== "N/A" && <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 2, background: C.dim, color: C.blue }}>{job.salary_estimate}</span>}
                  {job.ats_type && job.ats_type !== "unknown" && <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 2, background: C.dim, color: C.muted }}>{job.ats_type.toUpperCase()}</span>}
                  {(job.key_requirements || []).slice(0, 2).map((r: string) => (
                    <span key={r} style={{ fontSize: 9, padding: "2px 7px", borderRadius: 2, background: C.dim, color: C.muted }}>{r}</span>
                  ))}
                </div>
                {job.match_reasons?.[0] && <div style={{ fontSize: 10, color: C.muted, marginTop: 5, lineHeight: 1.4 }}>{job.match_reasons[0]}</div>}
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
                <div style={{ fontSize: 12, color: C.muted, display: "flex", alignItems: "center", gap: 8 }}>
                  {selected.company} · {selected.location}
                  {selected.is_defense_prime && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: "rgba(126,184,247,0.15)", color: C.blue }}>DEFENSE PRIME</span>}
                  {selected.is_federal && !selected.is_defense_prime && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: "rgba(126,184,247,0.1)", color: C.blue }}>FEDERAL</span>}
                </div>
                {selected.salary && <div style={{ fontSize: 11, color: C.blue, marginTop: 2 }}>{selected.salary}</div>}
              </div>
              <button className="btn" onClick={() => setSelected(null)} style={{ background: C.dim, color: C.muted, padding: "5px 10px" }}>X</button>
            </div>

            {/* Status dropdown + ATS type */}
            <div style={{ display: "flex", gap: 12, marginBottom: 14, alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.1em", marginBottom: 4 }}>STATUS</div>
                <select value={selected.status} onChange={e => updateJob(selected.id, e.target.value)} style={{ width: 160 }}>
                  {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              {selected.ats_type && (
                <div>
                  <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.1em", marginBottom: 4 }}>ATS TYPE</div>
                  <div style={{ fontSize: 11, color: C.text, padding: "6px 10px", background: C.dim, borderRadius: 3 }}>{selected.ats_type.toUpperCase()}</div>
                </div>
              )}
              {selected.clearance_mentioned && (
                <div style={{ fontSize: 9, padding: "6px 10px", borderRadius: 3, background: "rgba(0,255,136,0.08)", color: C.green, border: `1px solid ${C.green}33`, alignSelf: "flex-end" }}>CLEARANCE MENTIONED</div>
              )}
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
                <div style={{ fontSize: 9, color: C.green, letterSpacing: "0.1em", marginBottom: 8 }}>WHY YOU FIT</div>
                {(selected.match_reasons || []).map((r: string, i: number) => (
                  <div key={i} style={{ fontSize: 11, color: C.text, padding: "5px 0", borderBottom: `1px solid ${C.dim}`, lineHeight: 1.4 }}>{r}</div>
                ))}
              </div>
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: 13 }}>
                <div style={{ fontSize: 9, color: C.orange, letterSpacing: "0.1em", marginBottom: 8 }}>GAPS</div>
                {(selected.gaps || []).length > 0
                  ? (selected.gaps || []).map((g: string, i: number) => (
                    <div key={i} style={{ fontSize: 11, color: C.text, padding: "5px 0", borderBottom: `1px solid ${C.dim}`, lineHeight: 1.4 }}>{g}</div>
                  ))
                  : <div style={{ fontSize: 11, color: C.muted }}>No significant gaps</div>}
              </div>
            </div>

            {/* Key requirements */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.1em", marginBottom: 7 }}>KEY REQUIREMENTS</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {(selected.key_requirements || []).map((r: string) => (
                  <span key={r} style={{ fontSize: 10, padding: "3px 9px", background: C.dim, color: C.blue, borderRadius: 3 }}>{r}</span>
                ))}
              </div>
            </div>

            {/* User notes */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.1em", marginBottom: 5 }}>YOUR NOTES</div>
              <textarea
                value={userNotes}
                onChange={e => setUserNotes(e.target.value)}
                onBlur={() => saveUserNotes(selected.id)}
                placeholder="Add personal notes about this job..."
                rows={3}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>

            {/* Action buttons */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, marginBottom: 16 }}>
              <button className="btn" onClick={() => updateJob(selected.id, "applied")}
                style={{ background: C.green, color: "#060912", padding: "9px", fontWeight: 700 }}>APPLIED</button>
              <button className="btn" onClick={() => { window.open(selected.url || `https://www.indeed.com/viewjob?jk=${selected.id}`, "_blank"); }}
                style={{ background: C.dim, color: C.blue, padding: "9px" }}>OPEN JOB</button>
              <button className="btn" onClick={() => updateJob(selected.id, "interviewing")}
                style={{ background: C.dim, color: C.orange, padding: "9px" }}>INTERVIEW</button>
              <button className="btn" onClick={() => updateJob(selected.id, "withdrawn")}
                style={{ background: C.dim, color: C.red, padding: "9px 13px" }}>X</button>
            </div>

            {/* Manual action section (for manual_required jobs) */}
            {selected.status === "manual_required" && (
              <div style={{ background: "rgba(255,107,107,0.08)", border: `1px solid ${C.red}33`, borderRadius: 5, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 9, color: C.red, letterSpacing: "0.1em", marginBottom: 8 }}>MANUAL ACTION REQUIRED</div>
                {selected.agent_log && <div style={{ fontSize: 10, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>Agent log: {selected.agent_log}</div>}
                <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.1em", marginBottom: 6 }}>QUICK APPLY CHECKLIST</div>
                {[
                  `Upload: Aryan_Gupta_Backend_SDETResume.docx`,
                  `Name: Aryan Gupta | Email: aryangupta074@gmail.com | Phone: (443) 253-5169`,
                  `Location: Nottingham, MD 21236 (Remote preferred)`,
                  `Clearance: Public Trust (US Citizen)`,
                  selected.quick_pitch ? `Pitch: ${selected.quick_pitch}` : null,
                  `No cover letter required`
                ].filter(Boolean).map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, padding: "3px 0", fontSize: 10, color: C.muted }}>
                    <span style={{ color: C.green, flexShrink: 0 }}>[ ]</span><span>{item}</span>
                  </div>
                ))}
                <button className="btn" onClick={() => updateJob(selected.id, "applied")}
                  style={{ background: C.green, color: "#060912", padding: "8px 20px", fontWeight: 700, marginTop: 10 }}>MARK APPLIED</button>
              </div>
            )}

            {/* Application log timeline */}
            {appLog.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.1em", marginBottom: 8 }}>APPLICATION LOG</div>
                {appLog.map((log: any) => (
                  <div key={log.id} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: `1px solid ${C.dim}`, fontSize: 10 }}>
                    <span style={{ color: log.success ? C.green : C.red, flexShrink: 0 }}>{log.success ? "OK" : "FAIL"}</span>
                    <span style={{ color: C.muted }}>{new Date(log.attempted_at).toLocaleString()}</span>
                    <span style={{ color: C.text }}>{log.ats_type}</span>
                    {log.failure_reason && <span style={{ color: C.red }}>{log.failure_reason}</span>}
                    <span style={{ color: C.muted }}>{log.pages_navigated}pg {log.fields_filled}f</span>
                  </div>
                ))}
              </div>
            )}

            {/* Application checklist */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: 13 }}>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.1em", marginBottom: 8 }}>APPLICATION CHECKLIST</div>
              {[
                "Upload: Aryan_Gupta_Backend_SDETResume.docx",
                "Name: Aryan Gupta | Email: aryangupta074@gmail.com | Phone: (443) 253-5169",
                "Location: Nottingham, MD 21236 (Remote preferred)",
                "Clearance: Public Trust (US Citizen)",
                "Copy pitch above into LinkedIn/Indeed summary field",
                "No cover letter required"
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", fontSize: 10, color: C.muted, alignItems: "flex-start" }}>
                  <span style={{ color: C.green, flexShrink: 0 }}>[ ]</span><span>{item}</span>
                </div>
              ))}
            </div>

            {selected.description && (
              <details style={{ marginTop: 12 }}>
                <summary style={{ fontSize: 10, color: C.muted, cursor: "pointer", letterSpacing: "0.1em" }}>FULL JOB DESCRIPTION</summary>
                <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.7, marginTop: 8, padding: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, whiteSpace: "pre-wrap" }}>
                  {selected.description}
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      {/* Notes Bank Modal */}
      {showNotes && (
        <div className="modal-overlay" onClick={() => setShowNotes(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16, color: C.bright }}>Notes Bank</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={() => setNoteForm({ category: "", title: "", story: "", keywords: [] })}
                  style={{ background: C.green, color: "#060912", padding: "6px 14px", fontWeight: 600 }}>+ ADD NOTE</button>
                <button className="btn" onClick={() => setShowNotes(false)}
                  style={{ background: C.dim, color: C.muted, padding: "6px 10px" }}>X</button>
              </div>
            </div>

            {/* Note form */}
            {noteForm && (
              <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5, padding: 14, marginBottom: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <input placeholder="Category (e.g. leadership)" value={noteForm.category} onChange={e => setNoteForm({ ...noteForm, category: e.target.value })} />
                  <input placeholder="Title" value={noteForm.title} onChange={e => setNoteForm({ ...noteForm, title: e.target.value })} />
                </div>
                <textarea placeholder="Story (your experience, first person past tense)" value={noteForm.story}
                  onChange={e => setNoteForm({ ...noteForm, story: e.target.value })} rows={5} style={{ width: "100%", marginBottom: 8 }} />
                <input placeholder="Keywords (comma separated)" value={(noteForm.keywords || []).join(", ")}
                  onChange={e => setNoteForm({ ...noteForm, keywords: e.target.value.split(",").map((k: string) => k.trim()).filter(Boolean) })}
                  style={{ width: "100%", marginBottom: 8 }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" onClick={saveNote} style={{ background: C.green, color: "#060912", padding: "6px 14px", fontWeight: 600 }}>SAVE</button>
                  <button className="btn" onClick={() => setNoteForm(null)} style={{ background: C.dim, color: C.muted, padding: "6px 14px" }}>CANCEL</button>
                </div>
              </div>
            )}

            {/* Notes list grouped by category */}
            {Object.entries(
              notes.reduce((acc: any, n: any) => {
                (acc[n.category] = acc[n.category] || []).push(n);
                return acc;
              }, {})
            ).map(([cat, catNotes]: [string, any]) => (
              <div key={cat} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 9, color: C.blue, letterSpacing: "0.1em", marginBottom: 6, textTransform: "uppercase" }}>{cat}</div>
                {catNotes.map((n: any) => (
                  <div key={n.id} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: 12, marginBottom: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ fontWeight: 600, fontSize: 12, color: C.bright }}>{n.title}</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn" onClick={() => setNoteForm(n)} style={{ background: C.dim, color: C.blue, padding: "3px 8px", fontSize: 9 }}>EDIT</button>
                        <button className="btn" onClick={() => deleteNote(n.id)} style={{ background: C.dim, color: C.red, padding: "3px 8px", fontSize: 9 }}>DEL</button>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: C.text, lineHeight: 1.6, marginBottom: 6 }}>{n.story.slice(0, 200)}{n.story.length > 200 ? "..." : ""}</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {(n.keywords || []).map((kw: string) => (
                        <span key={kw} style={{ fontSize: 8, padding: "1px 6px", background: C.dim, color: C.muted, borderRadius: 2 }}>{kw}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {notes.length === 0 && <div style={{ color: C.muted, fontSize: 11, textAlign: "center", padding: 20 }}>No notes yet. Run the database migration to seed initial stories.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
