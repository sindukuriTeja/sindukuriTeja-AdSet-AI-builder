"use client";
import { useState } from "react";
import Link from "next/link";
import {
  IconDashboard,
  IconCampaigns,
  IconBrandKit,
  IconTemplates,
  IconCopyWriter,
  IconHistory,
  IconAnalytics,
  IconSettings,
  IconHelp,
  IconInvite,
  IconEdit,
  IconMenu,
  IconX,
} from "./icons";
import ThemeToggle from "./ThemeToggle";

interface ShellProps {
  children: React.ReactNode;
  active?: "dashboard" | "campaigns" | "new";
  title?: string;
  status?: string;
  onEditTitle?: () => void;
}

export default function Shell({ children, active = "dashboard", title, status }: ShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="shell">
      <div className="mobile-topbar">
        <button className="hamburger-btn" onClick={() => setMobileOpen(true)} aria-label="Open menu">
          <IconMenu />
        </button>
        <div className="brand" style={{ padding: 0 }}>
          <span>AdSet</span>
          <span className="brand-badge">AI</span>
        </div>
      </div>

      {mobileOpen && <div className="sidebar-overlay" onClick={closeMobile} />}

      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div>
          <div className="brand">
            <span>AdSet</span>
            <span className="brand-badge">AI</span>
            <button className="sidebar-close-btn" onClick={closeMobile} aria-label="Close menu">
              <IconX size={16} />
            </button>
          </div>
          <div className="brand-sub">AI Ad Creative Studio</div>
        </div>

        <Link href="/campaigns/new" className="new-campaign-btn" onClick={closeMobile}>+ New Campaign</Link>

        <nav className="nav" onClick={closeMobile}>
          <Link href="/" className={active === "dashboard" ? "active" : ""}><IconDashboard /> Dashboard</Link>
          <Link href="/" className={active === "campaigns" || active === "new" ? "active" : ""}><IconCampaigns /> Campaigns</Link>
          <Link href="/"><IconBrandKit /> Brand Kits</Link>
          <Link href="/"><IconTemplates /> Templates</Link>
          <Link href="/"><IconCopyWriter /> AI Copy Writer</Link>
          <Link href="/"><IconHistory /> History</Link>
          <span className="soon"><IconAnalytics /> Analytics<span className="nav-soon-badge">Soon</span></span>
          <Link href="/"><IconSettings /> Settings</Link>
        </nav>

        <ThemeToggle />

        <div className="sidebar-spacer" />

        <div className="side-card">
          <div className="title">Need help?</div>
          <div className="sub">Visit our Help Center</div>
          <div className="link">Learn more →</div>
        </div>
        <div className="side-card">
          <div className="title">Pro Plan</div>
          <div className="sub">23 / 100 campaigns used</div>
          <div className="plan-bar"><div className="plan-bar-fill" style={{ width: "23%" }} /></div>
          <button className="upgrade-btn">Upgrade Plan</button>
        </div>
      </aside>

      <main className="main">
        {title && (
          <div className="topbar">
            <div>
              <div className="topbar-title">
                {title}
                <IconEdit size={14} />
              </div>
              {status && (
                <div className="topbar-status">
                  <span className="status-dot" /> {status}
                </div>
              )}
            </div>
            <div className="topbar-actions">
              <button className="btn btn-sm"><IconInvite /> <span>Invite</span></button>
              <button className="icon-btn"><IconHelp size={17} /></button>
              <div className="avatar">EL</div>
            </div>
          </div>
        )}
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
