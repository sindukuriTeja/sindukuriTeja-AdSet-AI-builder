"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Campaign, CreativeVariant } from "@/lib/types";
import { IconCampaigns, IconTemplates, IconCopyWriter, IconCheck, IconImage, IconFacebook, IconInstagram, IconYouTube } from "@/components/icons";

const HOW_IT_WORKS = [
  {
    icon: IconCampaigns,
    title: "1. Upload once",
    body: "Drop in your hero/product image, logo, brand colours and copy — a single source of truth for the whole campaign.",
  },
  {
    icon: IconTemplates,
    title: "2. Pick your formats",
    body: "Choose from 39 platform-native sizes across Web & Display, Facebook, Instagram, Stories, TikTok and YouTube.",
  },
  {
    icon: IconCopyWriter,
    title: "3. AI lays out every ad",
    body: "Each format gets a real layout — cropped, composed and typeset for its own aspect ratio, not just a resized square.",
  },
  {
    icon: IconCheck,
    title: "4. Brand check & export",
    body: "Every creative is scored against your brand kit, then packaged into a ready-to-traffic zip with a manifest.",
  },
];

interface CampaignRecord {
  campaign: Campaign;
  variants: CreativeVariant[];
}

function campaignHref(c: Campaign): string {
  // Send returning users straight to generate/review if they've already uploaded assets
  if (c.selectedFormatIds?.length > 0) return `/campaigns/${c.id}/review`;
  if (c.heroImagePath) return `/campaigns/${c.id}/formats`;
  return `/campaigns/${c.id}/upload`;
}

function campaignStatus(c: Campaign, variants: CreativeVariant[]): { label: string; cls: string } {
  const ready = variants.filter((v) => v.status === "ready").length;
  if (ready > 0) return { label: `${ready} ads ready`, cls: "pill-good" };
  if (c.selectedFormatIds?.length > 0) return { label: "Ready to generate", cls: "pill-warn" };
  if (c.heroImagePath) return { label: "Formats needed", cls: "pill-warn" };
  return { label: "Assets needed", cls: "pill-bad" };
}

export default function Dashboard() {
  const [records, setRecords] = useState<CampaignRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch full records (campaign + variants) so we can show ready count and thumbnails
    fetch("/api/campaigns")
      .then((r) => r.json())
      .then(async (d: { campaigns: Campaign[] }) => {
        const campaigns = d.campaigns || [];
        // Load records in parallel — we need variant info for status + thumbnail
        const recs = await Promise.all(
          campaigns.map((c) =>
            fetch(`/api/campaigns/${c.id}`)
              .then((r) => r.json())
              .then((rec) => rec as CampaignRecord)
              .catch(() => ({ campaign: c, variants: [] }) as CampaignRecord)
          )
        );
        setRecords(recs);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <Shell active="dashboard">
      <div className="hero-banner">
        <div className="hero-copy">
          <h2>One photo. Every platform. Zero resizing headaches.</h2>
          <p className="muted">
            Upload a single product photo plus your brand kit, and AdSet AI composes a real, properly laid-out ad —
            headline, subhead, CTA and logo — for every size you need across Web, Facebook, Instagram, TikTok and
            YouTube. Every creative gets checked against your brand before you export.
          </p>
          <Link href="/campaigns/new" className="btn btn-primary">+ Start a new campaign</Link>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="hero-source">
            <IconImage size={26} />
            <span>Your photo</span>
          </div>
          <div className="hero-arrow">
            <svg width="34" height="14" viewBox="0 0 34 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="0" y1="7" x2="28" y2="7" /><polyline points="21 1 28 7 21 13" />
            </svg>
          </div>
          <div className="hero-fan">
            <div className="hero-card card-a">
              <span className="hero-badge"><IconYouTube size={13} /></span>
              <div className="hero-lines" />
            </div>
            <div className="hero-card card-b">
              <span className="hero-badge"><IconInstagram size={13} /></span>
              <div className="hero-lines" />
            </div>
            <div className="hero-card card-c">
              <span className="hero-badge"><IconFacebook size={13} /></span>
              <div className="hero-lines" />
            </div>
            <div className="hero-check"><IconCheck size={13} /></div>
          </div>
        </div>
      </div>

      <div className="page-header">
        <div>
          <h1>Campaigns</h1>
          <div className="muted">One campaign in, full digital ad pack out.</div>
        </div>
        <Link href="/campaigns/new" className="btn btn-primary">+ New Campaign</Link>
      </div>

      {loading ? (
        <div className="empty">Loading…</div>
      ) : records.length === 0 ? (
        <div className="card empty">No campaigns yet. Create your first one to get started.</div>
      ) : (
        <div className="grid grid-cols-3">
          {records.map(({ campaign: c, variants }) => {
            const href = campaignHref(c);
            const status = campaignStatus(c, variants);
            const thumbnail = variants.find((v) => v.status === "ready" && v.imagePath)?.imagePath;
            const avgScore = variants.length
              ? Math.round(variants.reduce((a, v) => a + (v.brandCheck?.score ?? 0), 0) / variants.length)
              : null;
            return (
              <Link key={c.id} href={href} className="card campaign-card">
                <div className="campaign-thumb">
                  {thumbnail ? (
                    <img src={thumbnail} alt={c.campaignName} />
                  ) : (
                    <div className="campaign-thumb-empty">
                      <IconImage size={28} />
                    </div>
                  )}
                </div>
                <div className="campaign-card-body">
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>{c.campaignName}</div>
                    {avgScore !== null && variants.length > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: avgScore >= 85 ? "var(--good)" : "var(--warn)", flexShrink: 0 }}>
                        {avgScore}/100
                      </span>
                    )}
                  </div>
                  <div className="muted" style={{ marginTop: 2, fontSize: 12 }}>{c.brand.brandName}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                    <span className={`pill ${status.cls}`}>{status.label}</span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {new Date(c.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <div className="card how-it-works">
        <div style={{ fontWeight: 700, fontSize: 16 }}>What AdSet AI does</div>
        <div className="muted" style={{ marginTop: 4, marginBottom: 20 }}>
          One upload becomes a full, on-brand digital ad pack — sized and laid out for every platform, automatically.
        </div>
        <div className="how-it-works-grid">
          {HOW_IT_WORKS.map((step) => (
            <div key={step.title} className="how-it-works-step">
              <div className="how-it-works-icon"><step.icon size={20} /></div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{step.title}</div>
              <div className="muted">{step.body}</div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
