import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        charcoal: "#0E0E10",
        lime: "#C6FF3D",
        magenta: "#FF3DAE",
        cyan: "#3DF0FF",
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      boxShadow: {
        brutal: "6px 6px 0 #000",
        "brutal-sm": "3px 3px 0 #000",
      },
      borderRadius: { none: "0px" },
    },
  },
  plugins: [],
} satisfies Config;
