import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        surface: "#f8fafc",
        card: "#ffffff",
        ink: "#0f172a",
        muted: "#475569",
        border: "#e2e8f0",
        accent: "#0f766e"
      }
    }
  },
  plugins: []
};

export default config;
