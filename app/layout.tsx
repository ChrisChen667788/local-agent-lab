import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import path from "node:path";
import "@/app/globals.css";
import { AppNav } from "@/components/layout/AppNav";
import { LocaleProvider } from "@/components/layout/LocaleProvider";

export const metadata: Metadata = {
  metadataBase: new URL("https://github.com/ChrisChen667788/local-agent-lab"),
  title: {
    default: "First LLM Studio",
    template: "%s · First LLM Studio"
  },
  description:
    "A local-first LLM studio for Apple Silicon with MLX local runtimes, remote APIs, benchmark operations, Compare Lab, replay, trace review, and runtime recovery.",
  openGraph: {
    title: "First LLM Studio",
    description:
      "A local-first LLM studio for Apple Silicon with MLX local runtimes, remote APIs, benchmark operations, Compare Lab, replay, trace review, and runtime recovery.",
    images: ["/oss-cover.png"]
  },
  twitter: {
    card: "summary_large_image",
    title: "First LLM Studio",
    description:
      "A local-first LLM studio for Apple Silicon with MLX local runtimes, remote APIs, benchmark operations, Compare Lab, replay, trace review, and runtime recovery.",
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
