import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "ink-900": "#F7F8FA",
        "ink-800": "#FFFFFF",
        "ink-700": "#FFFFFF",
        "ink-600": "#E4E7EC",
        "ink-500": "#F2F4F7",
        "fg-1": "#0E1014",
        "fg-2": "#4B5162",
        "fg-3": "#6E7484",
        tint: "#5A6E65",
        "tint-hot": "#46574F",
        "tint-deep": "#6F857B",
        "tint-soft": "#EDF2EF",
        spark: "#12805C",
        plasma: "#0E7490",
        "signal-good": "#12805C",
        "signal-warn": "#B54708",
        "signal-bad": "#D0342C",
      },
      fontFamily: {
        // `display` stays as its own token so heading weight/tracking can diverge
        // from body later without touching every call site.
        display: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)",
        lift: "0 4px 8px -2px rgba(16, 24, 40, 0.08), 0 2px 4px -2px rgba(16, 24, 40, 0.05)",
        pop: "0 12px 24px -6px rgba(16, 24, 40, 0.12), 0 4px 8px -4px rgba(16, 24, 40, 0.06)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 240ms ease-out both",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
export default config;
