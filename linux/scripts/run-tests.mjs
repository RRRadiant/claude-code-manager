/**
 * Bundle test entry points with esbuild, then run them with `node --test`.
 *
 * Why this exists: the engine's internal imports are extensionless (`./pure`),
 * matching the convention used throughout this codebase. That is exactly what
 * `electron-vite` resolves at build time, but Node's native ESM resolver requires
 * an explicit extension and will not load those modules directly.
 *
 * Rather than change the import style of the whole `src/main` tree to satisfy a
 * test runner — or worse, reimplement the logic in the test and let it drift —
 * this bundles the tests through the same resolver the app uses, then runs the
 * result. `electron` is marked external, so a module that picked up an
 * `electron` import would fail at run time: the "engine must not depend on
 * Electron" property is enforced, not merely hoped for.
 *
 * Usage: node scripts/run-tests.mjs [entry ...]
 *   Defaults to every `tests/*.test.mjs` when no entries are given.
 */

import { build } from 'esbuild'
import { readdirSync, rmSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const outDir = join(root, 'node_modules', '.cache', 'ccm-tests')

const entries =
  process.argv.length > 2
    ? process.argv.slice(2).map((p) => resolve(root, p))
    : readdirSync(join(root, 'tests'))
        .filter((name) => name.endsWith('.test.mjs'))
        .sort()
        .map((name) => join(root, 'tests', name))

if (entries.length === 0) {
  console.error('No test entries found.')
  process.exit(1)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const bundled = []

for (const entry of entries) {
  const outfile = join(outDir, entry.split(/[\\/]/).pop().replace(/\.mjs$/, '.bundle.mjs'))

  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    // `electron` and every bare package stay external: the tests must not pull a
    // native module into the bundle, and an Electron import must fail loudly.
    packages: 'external',
    logLevel: 'warning',
  })

  bundled.push(outfile)
}

const result = spawnSync(process.execPath, ['--test', ...bundled], {
  cwd: root,
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
