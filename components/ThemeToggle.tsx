"use client";
import { useEffect, useState } from "react";
import { IconSun, IconMoon } from "./icons";

// Reads the theme <html data-theme> already set by the inline script in
// layout.tsx (so there's no flash on mount), then flips it on click and
// persists the choice so it sticks across reloads/tabs.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("adset-theme", next);
    } catch {
      // localStorage unavailable (e.g. private mode) — theme just won't persist
    }
  }

  return (
    <button className="theme-toggle" onClick={toggle} type="button">
      {theme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
