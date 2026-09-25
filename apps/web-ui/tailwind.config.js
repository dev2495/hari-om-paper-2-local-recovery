/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./context/**/*.{js,ts,jsx,tsx}",
    "./hooks/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        signal: {"cyan": {"soft": "hsl(var(--signal-cyan-soft) / <alpha-value>)", "ink": "hsl(var(--signal-cyan-ink) / <alpha-value>)", "line": "hsl(var(--signal-cyan-line) / <alpha-value>)"}, "emerald": {"soft": "hsl(var(--signal-emerald-soft) / <alpha-value>)", "ink": "hsl(var(--signal-emerald-ink) / <alpha-value>)", "line": "hsl(var(--signal-emerald-line) / <alpha-value>)"}, "amber": {"soft": "hsl(var(--signal-amber-soft) / <alpha-value>)", "ink": "hsl(var(--signal-amber-ink) / <alpha-value>)", "line": "hsl(var(--signal-amber-line) / <alpha-value>)"}, "rose": {"soft": "hsl(var(--signal-rose-soft) / <alpha-value>)", "ink": "hsl(var(--signal-rose-ink) / <alpha-value>)", "line": "hsl(var(--signal-rose-line) / <alpha-value>)"}, "violet": {"soft": "hsl(var(--signal-violet-soft) / <alpha-value>)", "ink": "hsl(var(--signal-violet-ink) / <alpha-value>)", "line": "hsl(var(--signal-violet-line) / <alpha-value>)"}, "blue": {"soft": "hsl(var(--signal-blue-soft) / <alpha-value>)", "ink": "hsl(var(--signal-blue-ink) / <alpha-value>)", "line": "hsl(var(--signal-blue-line) / <alpha-value>)"}, "orange": {"soft": "hsl(var(--signal-orange-soft) / <alpha-value>)", "ink": "hsl(var(--signal-orange-ink) / <alpha-value>)", "line": "hsl(var(--signal-orange-line) / <alpha-value>)"}, "green": {"soft": "hsl(var(--signal-green-soft) / <alpha-value>)", "ink": "hsl(var(--signal-green-ink) / <alpha-value>)", "line": "hsl(var(--signal-green-line) / <alpha-value>)"}, "red": {"soft": "hsl(var(--signal-red-soft) / <alpha-value>)", "ink": "hsl(var(--signal-red-ink) / <alpha-value>)", "line": "hsl(var(--signal-red-line) / <alpha-value>)"}, "teal": {"soft": "hsl(var(--signal-teal-soft) / <alpha-value>)", "ink": "hsl(var(--signal-teal-ink) / <alpha-value>)", "line": "hsl(var(--signal-teal-line) / <alpha-value>)"}, "indigo": {"soft": "hsl(var(--signal-indigo-soft) / <alpha-value>)", "ink": "hsl(var(--signal-indigo-ink) / <alpha-value>)", "line": "hsl(var(--signal-indigo-line) / <alpha-value>)"}, "yellow": {"soft": "hsl(var(--signal-yellow-soft) / <alpha-value>)", "ink": "hsl(var(--signal-yellow-ink) / <alpha-value>)", "line": "hsl(var(--signal-yellow-line) / <alpha-value>)"}},
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
}
