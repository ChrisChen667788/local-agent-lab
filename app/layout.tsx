import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import path from "node:path";
import "@/app/globals.css";
import { AppNav } from "@/components/layout/AppNav";
import { LocaleProvider } from "@/components/layout/LocaleProvider";

export const metadata: Metadata = {
  metadataBase: new URL("https://github.com/ChrisChen667788/local-agent-lab"),
  title: {
    default: "Local Agent Lab",
    template: "%s · Local Agent Lab"
  },
  description:
    "A local-first coding agent workbench for Apple Silicon with local MLX runtimes, remote APIs, benchmark ops, trace review, and replay tooling.",
  openGraph: {
    title: "Local Agent Lab",
    description:
      "A local-first coding agent workbench for Apple Silicon with local MLX runtimes, remote APIs, benchmark ops, trace review, and replay tooling.",
    images: ["/oss-cover.png"]
  },
  twitter: {
    card: "summary_large_image",
    title: "Local Agent Lab",
    description:
      "A local-first coding agent workbench for Apple Silicon with local MLX runtimes, remote APIs, benchmark ops, trace review, and replay tooling.",
    images: ["/oss-cover.png"]
  }
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
