/**
 * Build guard: every class the renderer uses must exist in the built stylesheet.
 *
 * Why this exists
 * ---------------
 * The Linux builds shipped a stylesheet that contained the hand-written design
 * system but *no* Tailwind utility layer: `@tailwindcss/oxide` resolves its
 * automatic content scan against the git root, and the tree we built from on
 * the packaging machine had no `.git`, so the scanner fell back to the styles
 * directory, found no components, and emitted `@layer theme` and `@layer base`
 * with an empty `@layer utilities`. The build succeeded, the app started, and
 * every component written with utility classes — which was the whole setup
 * wizard, the first screen a new user sees — rendered as bare text.
 *
 * A silently-empty utility layer is invisible in a build log, so it is checked
 * here instead: collect the class tokens the renderer actually names and prove
 * each one is defined in the emitted CSS. If a future edit reintroduces a
 * utility class and the scan breaks again, packaging fails loudly rather than
 * shipping a screen that looks broken.
 *
 * Run after `electron-vite build`; wired into the `package:*` scripts.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')
const RENDERER = join(ROOT, 'src', 'renderer')
const ASSETS = join(ROOT, 'out', 'renderer', 'assets')

/** Selectors the app cannot render without, whatever else happens. */
const REQUIRED = [
  '--color-bg',
  '--color-accent',
  '.page',
  '.card',
  '.btn-primary',
  '.btn-block',
  '.nav-item',
  '.form-input',
  '.dep-row',
  '.guide',
  '.guide-card',
  '.guide-dot',
]

function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(full, out)
    else if (/\.(tsx|ts|html)$/.test(entry.name)) out.push(full)
  }
  return out
}

/**
 * Class tokens named literally in the source.
 *
 * The renderer builds class names three ways — a plain attribute, a ternary
 * inside braces, and a template literal — so each is unwrapped:
 *
 *   className="card card-pad"          -> the whole string
 *   className={on ? 'is-on' : ''}      -> the quoted literals
 *   className={`dot ${on ? 'is-ok' : 'is-warn'}`}
 *                                      -> the static chunk `dot` plus the
 *                                         literals, with each `${…}` flattened
 *                                         to a placeholder so a fragment like
 *                                         `is-` in `is-${tone}` is discarded
 *                                         rather than reported as a class
 *
 * Quoted values that are only compared against (`tone === 'ok'`) are not class
 * names and are skipped. Values that reach the DOM through a variable are not
 * visible here and are simply not checked.
 */

/** True when the literal at `at` is the right-hand side of a comparison. */
function isCompared(src, at) {
  let i = at - 1
  while (i >= 0 && /\s/.test(src[i])) i--
  return /(===|!==|==|!=|\(|,)$/.test(src.slice(Math.max(0, i - 2), i + 1))
}

/** Collect class strings from the JSX expression starting at the `{`. */
function readExpression(src, start, out) {
  let depth = 0
  let i = start
  while (i < src.length) {
    const ch = src[i]
    if (ch === '{') {
      depth++
      i++
    } else if (ch === '}') {
      depth--
      i++
      if (depth === 0) break
    } else if (ch === '"' || ch === "'") {
      const end = src.indexOf(ch, i + 1)
      if (end === -1) break
      if (!isCompared(src, i)) out.push(src.slice(i + 1, end))
      i = end + 1
    } else if (ch === '`') {
      i = readTemplate(src, i, out)
    } else {
      i++
    }
  }
  return i
}

const PLACEHOLDER = '\u0000'

/** Collect class strings from the template literal starting at the backtick. */
function readTemplate(src, start, out) {
  let flat = ''
  let i = start + 1
  while (i < src.length) {
    const ch = src[i]
    if (ch === '`') {
      i++
      break
    }
    if (ch === '\\') {
      flat += src[i + 1] ?? ''
      i += 2
      continue
    }
    if (ch === '$' && src[i + 1] === '{') {
      flat += PLACEHOLDER
      i = readExpression(src, i + 1, out)
      continue
    }
    flat += ch
    i++
  }
  out.push(flat)
  return i
}

function collectTokens(source) {
  const strings = []
  const re = /\bclassName\s*=\s*|\bclass\s*=\s*/g
  for (const match of source.matchAll(re)) {
    const at = match.index + match[0].length
    const quote = source[at]
    if (quote === '"' || quote === "'") {
      const end = source.indexOf(quote, at + 1)
      if (end !== -1) strings.push(source.slice(at + 1, end))
    } else if (quote === '{') {
      readExpression(source, at, strings)
    }
  }

  const tokens = new Set()
  for (const value of strings) {
    for (const token of value.split(/\s+/)) {
      if (!token || token.includes(PLACEHOLDER)) continue
      if (/["'`${}?.=,;|&]/.test(token)) continue
      tokens.add(token)
    }
  }
  return tokens
}

function findStylesheet() {
  let entries
  try {
    entries = readdirSync(ASSETS)
  } catch {
    fail(`no build output at ${relative(ROOT, ASSETS)} — run \`npm run build\` first`)
  }
  const sheets = entries.filter((f) => /^index-.*\.css$/.test(f))
  if (sheets.length === 0) fail(`no index-*.css in ${relative(ROOT, ASSETS)}`)
  // Vite keeps one hashed entry stylesheet; take the largest if several remain.
  return sheets
    .map((f) => ({ f, size: statSync(join(ASSETS, f)).size }))
    .sort((a, b) => b.size - a.size)[0]
}

function fail(message) {
  console.error(`check-css: ${message}`)
  process.exit(1)
}

const sheet = findStylesheet()
const cssPath = join(ASSETS, sheet.f)
// Unescape the CSS so `top-1\/2` matches the token `top-1/2`.
const css = readFileSync(cssPath, 'utf8').replaceAll('\\', '')

const missingRequired = REQUIRED.filter((sel) => !css.includes(sel))
if (missingRequired.length > 0) {
  fail(
    `${sheet.f} is missing required selectors: ${missingRequired.join(', ')}\n` +
      '  The stylesheet the renderer loads is incomplete or stale.',
  )
}

const tokens = new Map()
for (const file of collectFiles(RENDERER)) {
  const source = readFileSync(file, 'utf8')
  for (const token of collectTokens(source)) {
    if (!tokens.has(token)) tokens.set(token, relative(ROOT, file))
  }
}

const missing = [...tokens].filter(([token]) => !css.includes(token))

console.log(
  `check-css: ${sheet.f} (${(sheet.size / 1024).toFixed(0)} kB) defines all ` +
    `${REQUIRED.length} required selectors and ${tokens.size - missing.length}/${tokens.size} ` +
    'class tokens used by the renderer',
)

if (missing.length > 0) {
  console.error('\ncheck-css: classes used by the renderer but absent from the stylesheet:')
  for (const [token, file] of missing) console.error(`  ${token}  (${file})`)
  console.error(
    '\n  A Tailwind utility listed here usually means the content scan produced\n' +
      '  nothing. Prefer a class from src/renderer/styles/global.css over a utility:\n' +
      '  the design system is plain CSS and cannot go missing at build time.',
  )
  process.exit(1)
}
