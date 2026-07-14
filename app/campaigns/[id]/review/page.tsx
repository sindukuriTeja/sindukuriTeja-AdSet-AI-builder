"use client";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import Shell from "@/components/Shell";
import StepNav from "@/components/StepNav";
import { Campaign, CreativeVariant } from "@/lib/types";
import { getFormat, groupedFormats } from "@/lib/formats";
import { IconDownload, IconRefresh, IconGrid, IconList, IconCheck, IconWarning, IconEdit } from "@/components/icons";

interface CampaignRecord { campaign: Campaign; variants: CreativeVariant[] }

function Pill({ status }: { status?: "pass" | "warn" | "fail" }) {
  if (!status) return null;
  const cls = status === "pass" ? "pill-good" : status === "warn" ? "pill-warn" : "pill-bad";
  const label = status === "pass" ? "On brand" : status === "warn" ? "Needs review" : "Off brand";
  return <span className={`pill ${cls}`}>{label}</span>;
}

const THUMBS_PER_ROW = 5;

function mediaExt(format: { mediaType?: "image" | "video" }) {
  return format.mediaType === "video" ? "mp4" : "png";
}

function MediaPreview({ variant, format }: { variant?: CreativeVariant; format: { name: string; mediaType?: "image" | "video" } }) {
  if (!variant?.imagePath) return null;
  const src = `${variant.imagePath}?v=${variant.version}`;
  if (format.mediaType === "video") return <video src={src} autoPlay muted loop playsInline />;
  return <img src={src} alt={format.name} />;
}

const CHECK_LABELS: Record<string, string> = {
  logo_usage: "Logo Usage",
  brand_colors: "Brand Colors",
  font_usage: "Font Usage",
  contrast: "Contrast",
  text_readability: "Text Readability",
  image_quality: "Image Quality",
  cta_visible: "CTA Visibility",
  legal_copy: "Legal Copy",
  layout_density: "Layout Density",
  safe_zone: "Safe Zone",
};

export default function Review() {
  const { id } = useParams<{ id: string }>();
  const [record, setRecord] = useState<CampaignRecord | null>(null);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [view, setView] = useState<"grouped" | "grid">("grouped");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showFullReport, setShowFullReport] = useState(false);
  const [editingInfo, setEditingInfo] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${id}`);
    const data = await res.json();
    setRecord(data);
    return data as CampaignRecord;
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Poll every 3s while any variant is pending/generating
  useEffect(() => {
    if (!record) return;
    const hasPending = record.variants.some((v) => v.status === "pending" || v.status === "generating");
    if (hasPending || generating) {
      pollRef.current = setInterval(() => {
        load().then((rec) => {
          const stillPending = rec.variants.some((v) => v.status === "pending" || v.status === "generating");
          if (!stillPending && !generating) {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          }
        });
      }, 3000);
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [record, generating, load]);

  const groups = useMemo(() => groupedFormats(), []);

  async function runGenerate(body: Record<string, unknown>) {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setGenError(data?.error || `Generation failed (HTTP ${res.status}).`);
      }
      await load();
    } catch {
      setGenError("Couldn't reach the server. Is the dev server still running?");
    } finally {
      setGenerating(false);
    }
  }

  async function generateAll(force = false) { await runGenerate({ force }); }
  async function regenerateOne(formatId: string) { await runGenerate({ formatIds: [formatId], force: true }); }

  async function saveVariant(variant: CreativeVariant, patch: Partial<CreativeVariant>) {
    await fetch(`/api/campaigns/${id}/variants/${variant.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setEditing(null);
    await load();
  }

  async function saveCampaignInfo(patch: Record<string, string>) {
    await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setEditingInfo(false);
    await load();
  }

  if (!record) {
    return <Shell active="campaigns"><div className="empty">Loading…</div></Shell>;
  }

  const { campaign, variants } = record;
  const selected = new Set(campaign.selectedFormatIds);
  const byFormat = new Map(variants.map((v) => [v.formatId, v]));
  const readyCount = variants.filter((v) => v.status === "ready").length;
  const pendingCount = variants.filter((v) => v.status === "pending" || v.status === "generating").length;
  const avgScore = variants.length ? Math.round(variants.reduce((a, v) => a + (v.brandCheck?.score ?? 0), 0) / variants.length) : 0;
  const notGenerated = Array.from(selected).filter((fid) => !byFormat.has(fid) || byFormat.get(fid)!.status !== "ready");

  const activeGroups = Object.entries(groups)
    .map(([name, formats]) => ({ name, formats: formats.filter((f) => selected.has(f.id)) }))
    .filter((g) => g.formats.length > 0);

  const editingVariant = editing ? variants.find((v) => v.id === editing) ?? null : null;

  return (
    <Shell active="campaigns" title={campaign.campaignName} status="All changes saved">
      <StepNav campaignId={id} active="review" />

      <div className="page-header">
        <div>
          <h1>Generate &amp; Review</h1>
          <div className="muted">
            AI-generated ads across {selected.size} formats
            {pendingCount > 0 && <span style={{ color: "var(--warn)", marginLeft: 8 }}>• {pendingCount} generating…</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {notGenerated.length > 0 && (
            <button className="btn" disabled={generating} onClick={() => generateAll(false)}>
              <IconRefresh size={14} /> {generating ? "Generating…" : `Generate missing (${notGenerated.length})`}
            </button>
          )}
          <a className="btn btn-primary" href={`/api/campaigns/${id}/export`}>
            <IconDownload size={14} /> Export All ({readyCount})
          </a>
        </div>
      </div>

      {genError && (
        <div className="card" style={{ borderColor: "var(--bad)", background: "var(--bad-bg)", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 13, color: "var(--bad)" }}>⚠ {genError}</div>
          <button className="btn btn-sm" onClick={() => setGenError(null)}>Dismiss</button>
        </div>
      )}

      <div className="review-layout">
        <div className="review-main">
          <div className="toolbar">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong>AI Generated Ad Previews</strong>
              <span className="count-badge">{selected.size} formats</span>
              {readyCount > 0 && <span className="count-badge" style={{ background: "var(--good-bg)", color: "var(--good)" }}>{readyCount} ready</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="btn btn-sm" disabled={generating || readyCount === 0} onClick={() => generateAll(true)}>
                <IconRefresh size={12} /> Regenerate All
              </button>
              <div className="view-toggle">
                <button className={view === "grouped" ? "active" : ""} onClick={() => setView("grouped")}><IconList /></button>
                <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><IconGrid /></button>
              </div>
            </div>
          </div>

          {selected.size === 0 ? (
            <div className="card empty">No formats selected. Go back to Ad Formats to choose sizes.</div>
          ) : readyCount === 0 && !generating ? (
            <div className="card" style={{ textAlign: "center", padding: "40px 24px" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🎨</div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Ready to generate {selected.size} ads</div>
              <div className="muted" style={{ marginBottom: 20 }}>
                Claude will design a unique layout for each format. Runway generates brand-matched backgrounds. Usually takes 1–3 minutes.
              </div>
              <button className="btn btn-primary" onClick={() => generateAll(false)} disabled={generating}>
                <IconRefresh size={14} /> {generating ? "Generating…" : "Generate All Ads"}
              </button>
            </div>
          ) : view === "grouped" ? (
            <div className="ad-groups">
              {activeGroups.map((g) => {
                const isExpanded = expanded.has(g.name);
                const visible = isExpanded ? g.formats : g.formats.slice(0, THUMBS_PER_ROW);
                const remaining = g.formats.length - visible.length;
                return (
                  <div className="ad-group-row" key={g.name}>
                    <div className="ad-group-label">
                      <div className="name">{g.name}</div>
                      <div className="count">{g.formats.length} sizes</div>
                    </div>
                    <div className="ad-group-thumbs" style={isExpanded ? { flexWrap: "wrap" } : undefined}>
                      {visible.map((format) => {
                        const variant = byFormat.get(format.id);
                        return (
                          <Thumb
                            key={format.id}
                            format={format}
                            variant={variant}
                            onRegenerate={() => regenerateOne(format.id)}
                            onEdit={() => variant && setEditing(editing === variant.id ? null : variant.id)}
                            editing={!!variant && editing === variant.id}
                            disabled={generating}
                          />
                        );
                      })}
                      {remaining > 0 && !isExpanded && (
                        <div className="ad-thumb-more" onClick={() => setExpanded((s) => new Set(s).add(g.name))}>
                          +{remaining} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="ad-grid">
              {Array.from(selected).map((fid) => {
                const format = getFormat(fid);
                const variant = byFormat.get(fid);
                if (!format) return null;
                return (
                  <div className="ad-card" key={fid}>
                    {variant?.imagePath ? (
                      <MediaPreview variant={variant} format={format} />
                    ) : (
                      <div className="ph" style={{ aspectRatio: `${format.width}/${format.height}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: 8, textAlign: "center", fontSize: 11, color: "#999" }}>
                        {variant?.status === "pending" || variant?.status === "generating" ? (
                          <><span style={{ fontSize: 18 }}>⚙️</span><span>Generating…</span></>
                        ) : variant?.status === "failed" ? (
                          <><span style={{ fontSize: 16 }}>⚠</span><span style={{ color: "var(--bad)" }}>Failed</span></>
                        ) : "Not generated"}
                      </div>
                    )}
                    <div className="ad-card-meta">
                      <div style={{ fontWeight: 600 }}>{format.name}</div>
                      <div className="sz">{format.width} × {format.height}</div>
                      {variant?.brandCheck && <Pill status={variant.brandCheck.passOrFail} />}
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <button className="btn btn-sm" onClick={() => regenerateOne(fid)} disabled={generating}>Regen</button>
                        <button className="btn btn-sm" onClick={() => variant && setEditing(editing === variant.id ? null : variant.id)}>Edit</button>
                        {variant?.imagePath && (
                          <a className="btn btn-sm" href={variant.imagePath} download={`${format.id}.${mediaExt(format)}`}><IconDownload size={12} /></a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {editingVariant && (
            <div className="card" style={{ marginTop: 16 }}>
              <strong>Editing — {getFormat(editingVariant.formatId)?.name}</strong>
              <EditPanel variant={editingVariant} onSave={(patch) => saveVariant(editingVariant, patch)} onCancel={() => setEditing(null)} />
            </div>
          )}
        </div>

        <div className="review-side">
          {/* Score card */}
          <div className="card">
            <div className="score-card">
              <div>
                <div className="score" style={{ color: avgScore >= 85 ? "var(--good)" : avgScore >= 65 ? "var(--warn)" : "var(--bad)" }}>
                  {variants.length > 0 ? avgScore : "—"}<span style={{ color: "var(--ink-soft)" }}>/100</span>
                </div>
                <div className="score-sub">Brand Check</div>
              </div>
              {variants.length > 0 && (
                <div style={{ fontSize: 28 }}>{avgScore >= 85 ? "✅" : avgScore >= 65 ? "⚠️" : "❌"}</div>
              )}
            </div>
            <div className="score-sub" style={{ marginTop: 4 }}>{scoreMessage(avgScore, variants.length)}</div>
          </div>

          {/* Brand check checklist */}
          <div className="card">
            <strong>Brand Check</strong>
            <div className="checklist" style={{ marginTop: 12 }}>
              {aggregateChecks(variants).map((c) => (
                <div className="row" key={c.code}>
                  <div className="left">
                    <span className={`status-icon ${c.status === "pass" ? "good" : c.status === "warn" ? "warn" : "bad"}`}>
                      {c.status === "pass" ? <IconCheck size={11} /> : <IconWarning size={11} />}
                    </span>
                    {CHECK_LABELS[c.code] || c.label}
                  </div>
                  <span className={`status-label ${c.status === "pass" ? "good" : c.status === "warn" ? "warn" : "bad"}`}>
                    {c.status === "pass" ? "Good" : c.status === "warn" ? "Review" : "Failed"}
                  </span>
                </div>
              ))}
              {variants.length === 0 && <div className="muted">Generate ads to see brand-check results.</div>}
            </div>
            {variants.length > 0 && (
              <button className="btn btn-sm btn-block" style={{ marginTop: 14 }} onClick={() => setShowFullReport((s) => !s)}>
                {showFullReport ? "Hide Full Report" : "View Full Report"}
              </button>
            )}
            {showFullReport && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {variants.map((v) => {
                  const format = getFormat(v.formatId);
                  return (
                    <div className="row" key={v.id} style={{ fontSize: 12 }}>
                      <span>{format?.name || v.formatId}</span>
                      <Pill status={v.brandCheck?.passOrFail} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Campaign info */}
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Campaign Info</strong>
              <button className="btn btn-sm" onClick={() => setEditingInfo((s) => !s)}>
                <IconEdit size={12} /> {editingInfo ? "Cancel" : "Edit"}
              </button>
            </div>
            {editingInfo ? (
              <CampaignInfoEditForm campaign={campaign} onSave={saveCampaignInfo} />
            ) : (
              <div style={{ marginTop: 12 }}>
                <div className="info-row">
                  <div className="k">Brand Kit</div>
                  <div className="brandkit-chip">
                    <span className="brandkit-avatar">{campaign.brand.brandName.slice(0, 2).toUpperCase()}</span>
                    <span className="v">{campaign.brand.brandName}</span>
                  </div>
                </div>
                <div className="info-row"><div className="k">Objective</div><div className="v">{campaign.objective || "—"}</div></div>
                <div className="info-row"><div className="k">CTA</div><div className="v">{campaign.cta}</div></div>
                <div className="info-row"><div className="k">Headline</div><div className="v">{campaign.headline}</div></div>
                {campaign.subhead && <div className="info-row"><div className="k">Subhead</div><div className="v">{campaign.subhead}</div></div>}
                {campaign.companyUrl && <div className="info-row"><div className="k">Website</div><div className="v" style={{ wordBreak: "break-all", fontSize: 12 }}>{campaign.companyUrl}</div></div>}
                {campaign.researchSummary && (
                  <div className="info-row">
                    <div className="k">AI Research</div>
                    <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.45 }}>{campaign.researchSummary}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Export */}
          <div className="card">
            <strong>Export</strong>
            <div className="muted" style={{ margin: "8px 0 12px" }}>{readyCount} of {selected.size} formats ready</div>
            <a className="btn btn-primary btn-block" href={`/api/campaigns/${id}/export`}>
              <IconDownload size={14} /> Export All ({readyCount})
            </a>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function scoreMessage(avgScore: number, count: number) {
  if (count === 0) return "Generate ads to see your brand-check score.";
  if (avgScore >= 90) return "Great job! Your ads are on brand.";
  if (avgScore >= 70) return "Looking good — a few things worth a second look.";
  return "Several formats need attention before export.";
}

function aggregateChecks(variants: CreativeVariant[]) {
  const byCode = new Map<string, { label: string; worst: "pass" | "warn" | "fail" }>();
  for (const v of variants) {
    for (const c of v.brandCheck?.checks || []) {
      const cur = byCode.get(c.code);
      const rank = { pass: 0, warn: 1, fail: 2 } as const;
      if (!cur || rank[c.severity] > rank[cur.worst]) {
        byCode.set(c.code, { label: c.code.replace(/_/g, " "), worst: c.severity });
      }
    }
  }
  return Array.from(byCode.entries()).map(([code, v]) => ({ code, label: v.label, status: v.worst }));
}

function Thumb({ format, variant, onRegenerate, onEdit, editing, disabled }: {
  format: { id: string; name: string; width: number; height: number; mediaType?: "image" | "video" };
  variant?: CreativeVariant;
  onRegenerate: () => void;
  onEdit: () => void;
  editing: boolean;
  disabled: boolean;
}) {
  const isPending = variant?.status === "pending" || variant?.status === "generating";
  return (
    <div className={`ad-thumb ${editing ? "editing" : ""}`}>
      <div className="ad-thumb-frame" title={variant?.error}>
        {variant?.imagePath ? (
          <MediaPreview variant={variant} format={format} />
        ) : (
          <span style={{ fontSize: 11, color: "#999", textAlign: "center", padding: "0 8px" }}>
            {isPending ? (
              <span style={{ color: "var(--warn)" }}>Generating…</span>
            ) : variant?.status === "failed" ? (
              <><span style={{ color: "var(--bad)" }}>Failed</span>{variant.error && <><br /><span style={{ fontSize: 10, opacity: 0.8 }}>{variant.error.slice(0, 40)}</span></>}</>
            ) : "Not generated"}
          </span>
        )}
      </div>
      <div className="ad-thumb-meta">
        <div style={{ fontWeight: 600, fontSize: 12 }}>{format.name}</div>
        <div className="sz">{format.width} × {format.height}</div>
        {variant?.brandCheck && <Pill status={variant.brandCheck.passOrFail} />}
        <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
          <button className="btn btn-sm" onClick={onRegenerate} disabled={disabled || isPending}>
            {isPending ? "…" : "Regen"}
          </button>
          <button className="btn btn-sm" onClick={onEdit} disabled={!variant}>{editing ? "Close" : "Edit"}</button>
          {variant?.imagePath && (
            <a className="btn btn-sm" href={variant.imagePath} download={`${format.id}.${mediaExt(format)}`}><IconDownload size={12} /></a>
          )}
        </div>
      </div>
    </div>
  );
}

function EditPanel({ variant, onSave, onCancel }: { variant: CreativeVariant; onSave: (patch: Partial<CreativeVariant>) => void; onCancel: () => void }) {
  const [headline, setHeadline] = useState(variant.headline);
  const [cta, setCta] = useState(variant.cta);
  const [logoPosition, setLogoPosition] = useState(variant.logoPosition);
  const [bgColor, setBgColor] = useState(variant.bgColor || "#14141c");
  const [lockCrop, setLockCrop] = useState(variant.locks.crop);
  const [lockHeadline, setLockHeadline] = useState(variant.locks.headline);
  const [lockLogo, setLockLogo] = useState(variant.locks.logo);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave({ headline, cta, logoPosition, bgColor, locks: { crop: lockCrop, headline: lockHeadline, logo: lockLogo } });
    setSaving(false);
  }

  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10, maxWidth: 440 }}>
      <div className="field-row">
        <div className="field" style={{ flex: 2, marginBottom: 0 }}>
          <label className="label">Headline</label>
          <input className="input" value={headline} onChange={(e) => setHeadline(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <label className="label">CTA</label>
          <input className="input" value={cta} onChange={(e) => setCta(e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="label">Logo position</label>
          <select className="input" value={logoPosition} onChange={(e) => setLogoPosition(e.target.value as CreativeVariant["logoPosition"])}>
            <option value="top-left">Top left</option>
            <option value="top-right">Top right</option>
            <option value="bottom-left">Bottom left</option>
            <option value="bottom-right">Bottom right</option>
            <option value="center">Center</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="label">Background color</label>
          <input className="input" type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} style={{ height: 40 }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={lockCrop} onChange={(e) => setLockCrop(e.target.checked)} /> Lock crop
        </label>
        <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={lockHeadline} onChange={(e) => setLockHeadline(e.target.checked)} /> Lock headline
        </label>
        <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={lockLogo} onChange={(e) => setLockLogo(e.target.checked)} /> Lock logo
        </label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save & Re-render"}
        </button>
        <button className="btn btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function CampaignInfoEditForm({ campaign, onSave }: { campaign: Campaign; onSave: (patch: Record<string, string>) => void }) {
  const [brandName, setBrandName] = useState(campaign.brand.brandName);
  const [objective, setObjective] = useState(campaign.objective || "");
  const [cta, setCta] = useState(campaign.cta);
  const [headline, setHeadline] = useState(campaign.headline);
  const [subhead, setSubhead] = useState(campaign.subhead || "");

  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <input className="input" value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Brand name" />
      <input className="input" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Objective" />
      <input className="input" value={cta} onChange={(e) => setCta(e.target.value)} placeholder="CTA" />
      <input className="input" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Primary headline" />
      <input className="input" value={subhead} onChange={(e) => setSubhead(e.target.value)} placeholder="Sub headline" />
      <button className="btn btn-primary btn-sm" onClick={() => onSave({ brandName, objective, cta, headline, subhead })}>Save</button>
    </div>
  );
}
