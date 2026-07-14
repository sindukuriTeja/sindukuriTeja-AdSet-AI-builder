import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Napkin AdSet Builder",
  description: "AI ad creative studio — one campaign in, full digital ad pack out.",
};

// Runs before React hydrates so the correct theme is applied on first paint
// (otherwise the page would flash light before switching to a saved dark
// preference). Reads the persisted choice, falling back to the OS setting.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var saved = localStorage.getItem("adset-theme");
    var theme = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
