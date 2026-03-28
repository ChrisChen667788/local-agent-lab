import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import path from "node:path";
import "@/app/globals.css";
import { AppNav } from "@/components/layout/AppNav";
import { LocaleProvider } from "@/components/layout/LocaleProvider";

export const metadata: Metadata = {
  title: "Local Agent Lab",
  description: "A local-first coding agent shell with switchable Qwen profiles and pluggable APIs."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  let appVersion = "dev";
  try {
    appVersion = readFileSync(path.join(process.cwd(), "VERSION"), "utf8").trim() || "dev";
  } catch {
    appVersion = "dev";
  }

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <LocaleProvider>
          <AppNav version={appVersion} />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
