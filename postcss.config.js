export default {
  plugins: {
    // Tailwind 4 moved its PostCSS plugin into its own package; listing
    // `tailwindcss` here now errors with "It looks like you're trying to use
    // `tailwindcss` directly as a PostCSS plugin".
    '@tailwindcss/postcss': {},
    // No autoprefixer: Tailwind 4 handles vendor prefixing itself (Lightning CSS).
  },
}
