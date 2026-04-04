import type { AppProps } from "next/app";

export default function LegacyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
