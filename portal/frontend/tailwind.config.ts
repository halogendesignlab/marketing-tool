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
        "ink-900": "#07080B",
        "ink-800": "#0E1014",
        "ink-700": "#161922",
        "ink-600": "#1E2230",
        "ink-500": "#2A2F40",
        "fg-1": "#F4F5F7",
        "fg-2": "#A8AEBD",
        "fg-3": "#5C6275",
        tint: "#A8BDB0",
        "tint-hot": "#C4D4C8",
        "tint-deep": "#6F857B",
        spark: "#7AC468",
        plasma: "#7DF9FF",
        "signal-good": "#7AC468",
        "signal-warn": "#F2C04B",
        "signal-bad": "#FF5D6C",
      },
      fontFamily: {
        display: ['"New Science"', "sans-serif"],
        sans: ['"Space Grotesk"', "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
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
