"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import StepNav from "@/components/StepNav";
import { AD_FORMATS, groupedFormats } from "@/lib/formats";
import { Campaign } from "@/lib/types";
import { PLATFORM_ICON, IconCheck } from "@/components/icons";

export default function FormatSelector() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"platforms" | "custom">("platforms");
  const groups = useMemo(() => groupedFormats(), []);

  useEffect(() => {
    fetch(`/api/campaigns/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setCampaign(d.campaign);
        setSelected(new Set(d.campaign.selectedFormatIds));
      });
  }, [id]);

  function toggle(fid: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(fid)) next.delete(fid);
      else next.add(fid);
      return next;
    });
  }

  function toggleGroup(groupName: string, allSelected: boolean) {
    const ids = groups[groupName].map((f) => f.id);
    setSelected((s) => {
      const next = new Set(s);
      ids.forEach((fid) => (allSelected ? next.delete(fid) : next.add(fid)));
      return next;
    });
  }

  function selectAll(on: boolean) {
    setSelected(on ? new Set(AD_FORMATS.map((f) => f.id)) : new Set());
  }

  async function save(andContinue: boolean) {
    setSaving(true);
    try {
      await fetch(`/api/campaigns/${id}/formats`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formatIds: Array.from(selected) }),
      });
      if (andContinue) router.push(`/campaigns/${id}/review`);
    } finally {
      setSaving(false);
    }
  }

  if (!campaign) {
    return (
      <Shell active="campaigns">
        <div className="empty">Loading…</div>
      </Shell>
    );
  }

  const groupEntries = Object.entries(groups);

  return (
    <Shell active="campaigns" title={campaign.campaignName} status="All changes saved">
      <StepNav campaignId={id} active="formats" />

      <div className="page-header">
        <div>
          <h1>Choose Platforms &amp; Formats</h1>
          <div className="muted">Select the platforms and ad formats you want to generate</div>
        </div>
        <div className="tab-row">
          <button className={`tab ${tab === "platforms" ? "active" : ""}`} onClick={() => setTab("platforms")}>Platforms</button>
          <button className={`tab ${tab === "custom" ? "active" : ""}`} onClick={() => setTab("custom")}>Custom Sizes</button>
        </div>
      </div>

      {tab === "custom" ? (
        <div className="card empty">
          Custom pixel-size entry is on the roadmap — for now, pick from the full catalog under Platforms.
        </div>
      ) : (
        <>
          <div className="platform-row">
            {groupEntries.map(([groupName, formats]) => {
              const allSelected = formats.every((f) => selected.has(f.id));
              const someSelected = formats.some((f) => selected.has(f.id));
              const Icon = PLATFORM_ICON[formats[0].platform] || PLATFORM_ICON.display;
              return (
                <div
                  key={groupName}
                  className={`platform-tile ${allSelected ? "selected" : ""}`}
                  onClick={() => toggleGroup(groupName, allSelected)}
                >
                  {allSelected && (
                    <span className="fmt-check">
                      <IconCheck size={11} />
                    </span>
                  )}
                  <div className="fmt-icon">
                    <Icon size={30} />
                  </div>
                  <div className="fmt-name">{groupName}</div>
                  <div className="fmt-count">{formats.length} formats</div>
                  <div className="fmt-state">{allSelected ? "Selected" : someSelected ? "Partially selected" : "Not selected"}</div>
                </div>
              );
            })}
          </div>

          <div className="toolbar">
            <label className="toggle-row">
              <span className="toggle">
                <input type="checkbox" checked={selected.size === AD_FORMATS.length} onChange={(e) => selectAll(e.target.checked)} />
                <span className="toggle-track" />
              </span>
              Select All
            </label>
            <div className="muted">Total formats selected: <strong style={{ color: "var(--ink)" }}>{selected.size}</strong></div>
          </div>

          {groupEntries.map(([groupName, formats]) => {
            const allSelected = formats.every((f) => selected.has(f.id));
            return (
              <div className="card" key={groupName}>
                <div className="toolbar">
                  <strong>{groupName}</strong>
                  <button className="btn btn-sm" onClick={() => toggleGroup(groupName, allSelected)}>
                    {allSelected ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div className="grid grid-cols-3">
                  {formats.map((f) => {
                    const isSel = selected.has(f.id);
                    return (
                      <div key={f.id} className={`format-tile ${isSel ? "selected" : ""}`} onClick={() => toggle(f.id)}>
                        {isSel && <span className="fmt-check"><IconCheck size={11} /></span>}
                        <div style={{ fontWeight: 600 }}>{f.name}</div>
                        <div className="fmt-count">{f.width} × {f.height}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="card" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button className="btn" disabled={saving} onClick={() => save(false)}>Save selection</button>
            <button className="btn btn-primary" disabled={saving || selected.size === 0} onClick={() => save(true)}>
              Generate {selected.size} Ads →
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}
