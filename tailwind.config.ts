import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      colors: {
        cyber: {
          pink: "#ff2bd6",
          purple: "#8a2be2",
          blue: "#00e5ff",
          cyan: "#00ffea",
          gold: "#ffd400",
          red: "#ff2e4d",
        },
      },
      keyframes: {
        scanline: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
        glitch: {
          "0%,100%": { transform: "translate(0,0)" },
          "20%": { transform: "translate(-2px,2px)" },
          "40%": { transform: "translate(2px,-2px)" },
          "60%": { transform: "translate(-1px,-1px)" },
          "80%": { transform: "translate(1px,1px)" },
        },
        pulseGlow: {
          "0%,100%": { filter: "drop-shadow(0 0 12px currentColor)" },
          "50%": { filter: "drop-shadow(0 0 32px currentColor)" },
        },
        floatY: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        gradientShift: {
          "0%,100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
      },
      animation: {
        scanline: "scanline 4s linear infinite",
        glitch: "glitch 320ms steps(2) infinite",
        pulseGlow: "pulseGlow 1.6s ease-in-out infinite",
        floatY: "floatY 3s ease-in-out infinite",
        gradientShift: "gradientShift 8s ease infinite",
      },
    },
  },
  plugins: [],
};
export default config;
