/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        // Brand yellow — the notification-dot accent on the favicon and
        // the routine "consume" arrow in the app. Used sparingly for
        // hero highlights and key accents on the marketing site.
        brand: '#FCD34D',
        // Royal-blue scale anchored on `--c-shared` (#4A56A1) — the same
        // hue used in the app for shared resources, the inventory group
        // rail, and routine-entry borders. Replaces the previous indigo
        // ramp so the marketing site reads as the same brand as the app.
        nudge: {
          50: '#f1f2f8',
          100: '#dde0ec',
          300: '#8d96bf',
          500: '#4A56A1',
          600: '#3d4787',
          700: '#34396a',
          800: '#2a2e54',
          900: '#1f2340',
          950: '#14162a',
        },
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Liberation Mono"',
          '"Courier New"',
          'monospace',
        ],
      },
    },
  },
}
