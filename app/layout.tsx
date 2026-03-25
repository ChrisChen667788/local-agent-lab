import type { Metadata } from "next";
import "@/app/globals.css";
import { AppNav } from "@/components/layout/AppNav";
import { LocaleProvider } from "@/components/layout/LocaleProvider";

export const metadata: Metadata = {
  title: "Local Agent Lab",
  description: "A local-first coding agent shell with switchable Qwen profiles and pluggable APIs."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <LocaleProvider>
          <AppNav />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
