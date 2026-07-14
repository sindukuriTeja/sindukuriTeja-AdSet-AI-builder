"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import StepNav from "@/components/StepNav";
import { Campaign } from "@/lib/types";

function DropZone({
  label,
  accept,
  file,
  existingUrl,
  onFile,
}: {
  label: string;
  accept: string;
  file: File | null;
  existingUrl?: string;
  onFile: (f: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = file ? URL.createObjectURL(file) : existingUrl;

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }

  return (
    <div className="field">
      <label className="label">{label}</label>
      <div
        className={`dropzone ${dragging ? "dragging" : ""} ${preview ? "has-preview" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        {preview ? (
          <img src={preview} alt={label} className="dropzone-preview" />
        ) : (
          <div className="dropzone-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <circle cx="9" cy="10" r="1.8" />
              <path d="M3 17l5.5-5.5a1.5 1.5 0 012.1 0L15 16" />
              <path d="M13.5 14.5l2-2a1.5 1.5 0 012.1 0L21 16" />
            </svg>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>
              {dragging ? "Drop to upload" : "Click or drag to upload"}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>PNG, JPG, WEBP up to 20MB</div>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
        />
      </div>
      {file && (
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          {file.name} — {(file.size / 1024).toFixed(0)} KB
        </div>
      )}
    </div>
  );
}

export default function UploadAssets() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [hero, setHero] = useState<File | null>(null);
  const [logo, setLogo] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/campaigns/${id}`).then((r) => r.json()).then((d) => setCampaign(d.campaign));
  }, [id]);

  async function upload() {
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      if (hero) fd.append("hero", hero);
      if (logo) fd.append("logo", logo);
      const res = await fetch(`/api/campaigns/${id}/upload`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Upload failed. Check server logs.");
        return;
      }
      setCampaign(data.campaign);
      setHero(null);
      setLogo(null);
    } finally {
      setUploading(false);
    }
  }

  if (!campaign) {
    return (
      <Shell active="campaigns">
        <div className="empty">Loading…</div>
      </Shell>
    );
  }

  return (
    <Shell active="campaigns" title={campaign.campaignName} status="All changes saved">
      <StepNav campaignId={id} active="upload" />
      <div className="page-header">
        <div>
          <h1>Upload Assets</h1>
          <div className="muted">Step 2 — upload your hero/product image and brand logo.</div>
        </div>
      </div>

      <div className="card">
        <div className="field-row">
          <DropZone
            label="Hero / product image"
            accept="image/*"
            file={hero}
            existingUrl={campaign.heroImagePath}
            onFile={setHero}
          />
          <DropZone
            label="Brand logo"
            accept="image/*"
            file={logo}
            existingUrl={campaign.brand.logoPath}
            onFile={setLogo}
          />
        </div>

        {error && (
          <div style={{ color: "var(--bad)", fontSize: 13, marginBottom: 12 }}>⚠ {error}</div>
        )}

        <button
          className="btn btn-primary"
          disabled={uploading || (!hero && !logo)}
          onClick={upload}
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>

        {!hero && !logo && (campaign.heroImagePath || campaign.brand.logoPath) && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Assets already uploaded. Select new files to replace them.
          </div>
        )}
      </div>

      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="muted" style={{ fontSize: 13 }}>
          {campaign.heroImagePath ? "✓ Hero image uploaded" : "A hero image is required before you can pick formats."}
        </div>
        <button
          className="btn btn-primary"
          disabled={!campaign.heroImagePath}
          onClick={() => router.push(`/campaigns/${id}/formats`)}
        >
          Continue to Ad Formats →
        </button>
      </div>
    </Shell>
  );
}
