"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import StepNav from "@/components/StepNav";

interface ResearchResult {
  brandName: string;
  industry: string;
  headline: string;
  subhead: string;
  cta: string;
  toneOfVoice: string;
  primaryColor: string;
  secondaryColor: string;
  suggestedFonts: string;
  creativeDirection: string;
  guidelineNotes: string;
  preferredStyles: string[];
  researchSummary: string;
}

export default function NewCampaign() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState("");
  const [researchResult, setResearchResult] = useState<ResearchResult | null>(null);

  const [companyUrl, setCompanyUrl] = useState("");
  const [form, setForm] = useState({
    campaignName: "",
    brandName: "",
    objective: "Drive Sales",
    primaryColor: "#6d4aff",
    secondaryColor: "",
    fonts: "",
    toneOfVoice: "",
    ctaStyle: "",
    headline: "",
    subhead: "",
    cta: "Shop Now",
    legalCopy: "",
    guidelineNotes: "",
  });

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function runResearch() {
    if (!companyUrl.trim()) return;
    setResearching(true);
    setResearchError("");
    setResearchResult(null);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: companyUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setResearchError(data.error || "Research failed — try again or fill in manually.");
        return;
      }
      const intel: ResearchResult = data.intel;
      setResearchResult(intel);
      // Auto-fill form with Claude's findings
      setForm((f) => ({
        ...f,
        brandName: intel.brandName || f.brandName,
        primaryColor: intel.primaryColor || f.primaryColor,
        secondaryColor: intel.secondaryColor || f.secondaryColor,
        fonts: intel.suggestedFonts || f.fonts,
        toneOfVoice: intel.toneOfVoice || f.toneOfVoice,
        headline: intel.headline || f.headline,
        subhead: intel.subhead || f.subhead,
        cta: intel.cta || f.cta,
        guidelineNotes: intel.guidelineNotes || f.guidelineNotes,
        campaignName: f.campaignName || `${intel.brandName} Campaign`,
      }));
    } catch {
      setResearchError("Network error — check your connection and try again.");
    } finally {
      setResearching(false);
    }
  }

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          companyUrl: companyUrl.trim() || undefined,
          researchSummary: researchResult?.researchSummary,
          creativeDirection: researchResult?.creativeDirection,
          preferredStyles: researchResult?.preferredStyles,
        }),
      });
      const data = await res.json();
      router.push(`/campaigns/${data.campaign.id}/upload`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Shell active="new">
      <StepNav campaignId="" active="setup" />
      <div className="page-header">
        <div>
          <h1>New Campaign</h1>
          <div className="muted">Step 1 — paste your company URL and let Claude research your brand, or fill in manually.</div>
        </div>
      </div>

      {/* AI Research panel */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 18 }}>🔍</span>
          <span style={{ fontWeight: 600 }}>Auto-fill from your website</span>
          <span className="muted" style={{ fontSize: 13 }}>— Claude reads your site and fills everything in</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            value={companyUrl}
            onChange={(e) => setCompanyUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runResearch()}
            placeholder="https://yourcompany.com"
            disabled={researching}
          />
          <button
            className="btn btn-primary"
            onClick={runResearch}
            disabled={researching || !companyUrl.trim()}
            style={{ whiteSpace: "nowrap" }}
          >
            {researching ? "Researching…" : "Research with AI"}
          </button>
        </div>

        {researching && (
          <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
            Claude is reading your site and building a creative brief — usually takes 10–20 seconds…
          </div>
        )}

        {researchError && (
          <div style={{ marginTop: 10, color: "var(--color-fail, #e05252)", fontSize: 13 }}>
            {researchError}
          </div>
        )}

        {researchResult && !researching && (
          <div style={{
            marginTop: 12, padding: "12px 14px", borderRadius: 8,
            background: "var(--color-surface-alt, #f4f4f8)",
            borderLeft: "3px solid var(--color-primary, #6d4aff)",
            fontSize: 13,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              ✓ Found: {researchResult.brandName} — {researchResult.industry}
            </div>
            <div className="muted">{researchResult.researchSummary}</div>
            {researchResult.preferredStyles?.length > 0 && (
              <div style={{ marginTop: 6 }} className="muted">
                Recommended styles: {researchResult.preferredStyles.join(", ")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Manual form */}
      <div className="card">
        <div className="field-row">
          <div className="field">
            <label className="label">Campaign name</label>
            <input className="input" value={form.campaignName} onChange={(e) => update("campaignName", e.target.value)} placeholder="Summer Collection Launch" />
          </div>
          <div className="field">
            <label className="label">Objective</label>
            <select className="input" value={form.objective} onChange={(e) => update("objective", e.target.value)}>
              <option>Drive Sales</option>
              <option>Brand Awareness</option>
              <option>Lead Generation</option>
              <option>App Installs</option>
            </select>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label className="label">Brand name</label>
            <input className="input" value={form.brandName} onChange={(e) => update("brandName", e.target.value)} placeholder="Napkin" />
          </div>
          <div className="field">
            <label className="label">Primary brand colour</label>
            <input className="input" type="color" value={form.primaryColor} onChange={(e) => update("primaryColor", e.target.value)} style={{ height: 40 }} />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label className="label">Secondary colour (optional)</label>
            <input className="input" type="color" value={form.secondaryColor || "#ffffff"} onChange={(e) => update("secondaryColor", e.target.value)} style={{ height: 40 }} />
          </div>
          <div className="field">
            <label className="label">Brand fonts (comma separated, optional)</label>
            <input className="input" value={form.fonts} onChange={(e) => update("fonts", e.target.value)} placeholder="Poppins, Inter" />
          </div>
        </div>

        <div className="field">
          <label className="label">Headline</label>
          <input className="input" value={form.headline} onChange={(e) => update("headline", e.target.value)} placeholder="Summer Collection — New Arrivals Are Here" />
        </div>
        <div className="field">
          <label className="label">Subhead (optional)</label>
          <input className="input" value={form.subhead} onChange={(e) => update("subhead", e.target.value)} placeholder="Lightweight styles for the season ahead" />
        </div>
        <div className="field-row">
          <div className="field">
            <label className="label">CTA</label>
            <input className="input" value={form.cta} onChange={(e) => update("cta", e.target.value)} placeholder="Shop Now" />
          </div>
          <div className="field">
            <label className="label">CTA style / tone (optional)</label>
            <input className="input" value={form.ctaStyle} onChange={(e) => update("ctaStyle", e.target.value)} placeholder="Bold, direct, exclamation-free" />
          </div>
        </div>
        <div className="field">
          <label className="label">Legal / compliance copy (optional)</label>
          <textarea className="input" rows={2} value={form.legalCopy} onChange={(e) => update("legalCopy", e.target.value)} placeholder="Terms apply. See site for details." />
        </div>
        <div className="field">
          <label className="label">Brand guideline notes</label>
          <textarea className="input" rows={3} value={form.guidelineNotes} onChange={(e) => update("guidelineNotes", e.target.value)} placeholder="Tone of voice, do's and don'ts, logo clear-space rules, etc." />
        </div>

        <button className="btn btn-primary" disabled={saving || !form.campaignName} onClick={submit}>
          {saving ? "Creating…" : "Continue to Upload Assets →"}
        </button>
      </div>
    </Shell>
  );
}
