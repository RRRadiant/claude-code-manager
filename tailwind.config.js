/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{ts,tsx}',
    './index.html',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
  // Disable Preflight to avoid conflicts with existing CSS reset
  corePlugins: {
    preflight: false,
  },
}
