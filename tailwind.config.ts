import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      screens: { xs: "420px" },
      colors: {
        background: token("background"),
        foreground: token("foreground"),
        surface: { DEFAULT: token("surface"), 2: token("surface-2") },
        border: token("border"),
        muted: token("muted"),
        primary: { DEFAULT: token("primary"), foreground: token("primary-foreground") },
        accent: token("accent"),
        bluff: token("bluff"),
        trust: token("trust"),
        gold: token("gold"),
        felt: { DEFAULT: token("felt"), deep: token("felt-deep") },
        ring: token("ring"),
        // playing-card palette
        ivory: token("card-face"),
        ink: token("card-ink"),
        crimson: token("card-red"),
      },
      fontFamily: {
        sans: ['"Inter Variable"', "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ['"Unbounded Variable"', '"Inter Variable"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: { "4xl": "2rem" },
      boxShadow: {
        "glow-primary": "0 0 0 1px hsl(var(--primary) / .5), 0 8px 30px -6px hsl(var(--primary) / .65)",
        "glow-bluff": "0 0 0 1px hsl(var(--bluff) / .6), 0 8px 34px -4px hsl(var(--bluff) / .7)",
        "glow-trust": "0 0 0 1px hsl(var(--trust) / .5), 0 8px 30px -6px hsl(var(--trust) / .5)",
        "glow-gold": "0 0 0 1px hsl(var(--gold) / .6), 0 8px 34px -4px hsl(var(--gold) / .6)",
        card: "0 1px 0 hsl(0 0% 100% / .6) inset, 0 8px 18px -6px rgb(0 0 0 / .7), 0 2px 4px rgb(0 0 0 / .4)",
      },
      keyframes: {
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
        "pulse-glow": {
          "0%,100%": { boxShadow: "0 0 0 1px hsl(var(--bluff) / .6), 0 8px 30px -6px hsl(var(--bluff) / .55)" },
          "50%": { boxShadow: "0 0 0 2px hsl(var(--bluff) / .9), 0 8px 46px -2px hsl(var(--bluff) / .95)" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        shake: {
          "0%,100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-6px) rotate(-1deg)" },
          "40%": { transform: "translateX(6px) rotate(1deg)" },
          "60%": { transform: "translateX(-4px)" },
          "80%": { transform: "translateX(4px)" },
        },
        "pop-in": { "0%": { opacity: "0", transform: "scale(.85)" }, "100%": { opacity: "1", transform: "scale(1)" } },
        "spin-slow": { to: { transform: "rotate(360deg)" } },
        "ring-pulse": {
          "0%": { boxShadow: "0 0 0 0 hsl(var(--gold) / .55)" },
          "100%": { boxShadow: "0 0 0 14px hsl(var(--gold) / 0)" },
        },
        /* game feel */
        tremble: {
          "0%,100%": { transform: "translateX(0)" },
          "25%": { transform: "translateX(-1.2px)" },
          "75%": { transform: "translateX(1.2px)" },
        },
        bob: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-2.5px)" } },
        "danger-pulse": {
          "0%": { boxShadow: "0 0 0 0 hsl(var(--bluff) / .65)" },
          "100%": { boxShadow: "0 0 0 10px hsl(var(--bluff) / 0)" },
        },
        sweat: {
          "0%": { transform: "translateY(-2px) scale(.6)", opacity: "0" },
          "25%": { opacity: "1" },
          "100%": { transform: "translateY(15px) scale(1)", opacity: "0" },
        },
        "ping-once": {
          "0%": { transform: "scale(.7)", opacity: ".85" },
          "100%": { transform: "scale(2.1)", opacity: "0" },
        },
        arrive: {
          "0%": { transform: "translate(var(--ax, 0px), var(--ay, 0px)) rotate(var(--ar, 0deg)) scale(.55)", opacity: "0" },
          "55%": { opacity: "1" },
          "100%": { transform: "translate(0, 0) rotate(0deg) scale(1)", opacity: "1" },
        },
        "ready-wave": {
          "0%,100%": { transform: "translateY(0)" },
          "40%": { transform: "translateY(-9px)" },
        },
        shine: { "0%": { transform: "translateX(-130%) skewX(-18deg)" }, "100%": { transform: "translateX(230%) skewX(-18deg)" } },
        "float-up": {
          "0%": { transform: "translateY(4px) scale(.8)", opacity: "0" },
          "18%": { opacity: "1", transform: "translateY(-2px) scale(1.12)" },
          "100%": { transform: "translateY(-20px) scale(1)", opacity: "0" },
        },
      },
      animation: {
        float: "float 5s ease-in-out infinite",
        "pulse-glow": "pulse-glow 1.1s ease-in-out infinite",
        shimmer: "shimmer 1.8s infinite",
        shake: "shake .5s ease-in-out",
        "pop-in": "pop-in .28s cubic-bezier(.2,1.3,.4,1) both",
        "spin-slow": "spin-slow 24s linear infinite",
        "ring-pulse": "ring-pulse 1.4s ease-out infinite",
        tremble: "tremble .09s linear infinite",
        bob: "bob 1.5s ease-in-out infinite",
        "danger-pulse": "danger-pulse 1.1s ease-out infinite",
        sweat: "sweat 1.15s ease-in infinite",
        "ping-once": "ping-once .7s ease-out both",
        arrive: "arrive .5s cubic-bezier(.2,.9,.3,1.12) both",
        "ready-wave": "ready-wave .42s ease-out both",
        shine: "shine 2.4s ease-in-out infinite",
        "float-up": "float-up 1s ease-out both",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
