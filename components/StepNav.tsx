import Link from "next/link";
import { IconChevronRight, IconCheck } from "./icons";

const STEPS = [
  { key: "setup", num: 1, title: "Campaign Setup", sub: "Name, product, goal" },
  { key: "upload", num: 2, title: "Upload Assets", sub: "Images, logo, brand" },
  { key: "formats", num: 3, title: "Ad Formats", sub: "Choose platforms & sizes" },
  { key: "review", num: 4, title: "Generate", sub: "AI creates your ads" },
  { key: "review", num: 5, title: "Review & Edit", sub: "Customize & export" },
];

export default function StepNav({ campaignId, active }: { campaignId: string; active: string }) {
  const hrefFor = (key: string) => (key === "setup" ? `/campaigns/new` : `/campaigns/${campaignId}/${key}`);
  const activeIdx = STEPS.findIndex((s) => s.key === active);

  return (
    <div className="steps">
      {STEPS.map((s, i) => {
        const disabled = s.key !== "setup" && !campaignId;
        const isActive = active === "review" ? s.key === "review" : i === activeIdx;
        const isDone = active === "review" ? s.key !== "review" : i < activeIdx;
        const content = (
          <>
            <span className="step-num">{isDone ? <IconCheck size={13} /> : s.num}</span>
            <span>
              <div className="step-title">{s.title}</div>
              <div className="step-sub">{s.sub}</div>
            </span>
          </>
        );

        const stepEl = disabled ? (
          <span className="step" style={{ opacity: 0.4, cursor: "not-allowed" }}>
            {content}
          </span>
        ) : (
          <Link href={hrefFor(s.key)} className={`step ${isActive ? "active" : ""} ${isDone ? "done" : ""}`}>
            {content}
          </Link>
        );

        return (
          <div key={`${s.key}-${s.num}`} className="step-wrap">
            {stepEl}
            {i < STEPS.length - 1 && (
              <span className="step-arrow">
                <IconChevronRight size={16} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
