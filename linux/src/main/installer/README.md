# Environment Install Pipeline

How this app installs Node.js, Git and Claude Code. Ported from the
Windows/Tauri build (`claude-code-manager`), with the Linux equivalents
substituted where the platform differs.

## The eight stages

Every component runs the same pipeline. The Rust original states it as a header
comment; it is the contract this implementation follows:

| # | Stage | Module | Notes |
|---|-------|--------|-------|
| 1 | Already installed? | `installers/*.ts` | Probes with the **refreshed PATH** and **runs the binary**. `which` alone is not enough: a tree whose mode bits were lost is on disk and cannot execute. |
| 2 | Select source | `source.ts` | Concurrent `HEAD` probes, 2.5 s budget each, fastest wins. |
| 3 | Cache decision | `cache.ts` | Marker match → skip download *and* hash. Otherwise re-hash; a failure drops the archive. |
| 4 | Download | `download.ts` | `.part` file + `Range` resume, 3 attempts, cancellable mid-transfer. |
| 5 | Verify | `verify.ts` | Pinned SHA256, cross-checked against the mirror's own `SHASUMS256.txt`. |
| 6 | Extract | `extract.ts` | `tar -xJf --strip-components=1`. |
| 7 | Verify the binary | `installers/node.ts` | First run of the just-extracted binary gets a 120 s budget. |
| 8 | PATH | `env.ts` | Process PATH immediately, shell rc files for future terminals. |

## Where Linux differs from Windows, and why

The Rust build has one dominant problem that does not exist here: a Windows
process inherits its environment block at creation, while installers write the
**registry** copy, so a freshly installed tool is invisible until a restart.
That is why the Windows pipeline:

- reads PATH out of `HKCU\Environment` and `HKLM\...\Session Manager\Environment`,
- broadcasts `WM_SETTINGCHANGE` so `explorer.exe` picks it up,
- **stops after Node.js + Git** and demands a restart before Claude Code,
- and relaunches itself with an explicit merged PATH.

Linux has no registry. This implementation replaces each piece:

| Windows mechanism | Linux equivalent here |
|---|---|
| Read PATH from registry | Directly prepend the managed dirs to the PATH passed to each child process (`mergedEnv()`). |
| `WM_SETTINGCHANGE` broadcast | Append an idempotent export block to `.bashrc` / `.zshrc` / `.profile`. |
| Hard restart boundary before Claude Code | **No boundary.** Writing `process.env.PATH` is enough for our own children, so npm installed moments ago is the npm Claude Code's install uses, in the same run. |
| Relaunch with merged PATH | Not needed. |
| `restart-required` event | `needsNewShell` in the summary: nothing is broken, but a terminal opened *before* the run will not find `claude` until a new one is started. |

The consequence worth stating plainly: **this pipeline installs the whole
environment in one pass**, where the Windows one needs a restart in the middle.

## Portable Node.js rather than apt

Same reasoning the Windows build gives for shipping a portable Node instead of
using winget:

- the exact version can be pinned (`v22.14.0`),
- a digest can be verified against a value compiled into the app,
- the result lands somewhere the app owns and can remove.

A distribution package does none of those, and on a filtered network the distro
mirror is frequently the slowest path available.

**Git is the exception.** It comes from `apt` when available, because there is no
upstream tarball worth racing mirrors for: building Git from source to avoid
`apt` would trade a signed-package trust chain for a digest we would have to pin
and maintain ourselves. Git is also optional for Claude Code, so a failure there
is recorded as a warning and the pipeline continues.

## Layout

Everything the app installs lives under `~/.local/share/claude-code-manager`:

```
~/.local/share/claude-code-manager/
├── cache/installers/            # verified archives + .verified.json sidecars
│   └── node-v22.14.0-linux-x64.tar.xz
├── runtime/
│   ├── node/v22.14.0/node-v22.14.0-linux-x64/bin/   # node, npm
│   └── npm-global/bin/claude                        # the shim
```

Both `bin` directories go on PATH, npm's first so the `claude` shim wins.

## Sources and pinned digests

Node.js mirrors, raced concurrently on every download:

| id | base URL |
|---|---|
| `official` | `https://nodejs.org/dist/` |
| `npmmirror` | `https://npmmirror.com/mirrors/node/` |
| `huawei` | `https://mirrors.huaweicloud.com/nodejs/` |

All three were verified to serve byte-identical `v22.14.0` archives. The digest
is pinned in `components.ts`:

```
node-v22.14.0-linux-x64.tar.xz   69b09dba5c8dcb05c4e4273a4340db1005abeafe3927efda2bc5b249e80437ec
node-v22.14.0-linux-arm64.tar.xz 08bfbf538bad0e8cbb0269f0173cca28d705874a67a22f60b57d99dc99e30050
```

Why pinned rather than fetched, in the Rust build's words: *a checksum fetched at
install time travels the same channel as the payload, so anything able to swap
the installer could swap the digest too.* The mirror's published list is still
consulted, but only as an independent cross-check — and a mirror that publishes a
**different** digest for the pinned filename is refused before the download
starts.

To bump the version: update `NODE_VERSION`, `NODE_SHA256`, and re-verify the
mirrors serve identical bytes.

## npm registry handling

The Windows build switched the global npm registry and restored it afterwards,
including on error and cancellation. This implementation does something strictly
better: the registry is passed to the npm child process as
`npm_config_registry`, never written to global config. There is no window in
which a crash leaves the user's `~/.npmrc` pointing at a mirror, and no restore
call a cancelled operation can skip.

If the user has already pointed npm at a mirror, that mirror is used.

## Progress reporting

Two channels, matching the Rust build's split:

| Event | Payload | Cadence |
|---|---|---|
| `installer:progress` | `DownloadProgress` | Throttled to 150 ms; the final chunk is always let through so the bar reaches 100%. |
| `installer:task` | `TaskState` | One per state change. |

Every progress event carries a `component` tag. Node.js and Git can download
concurrently, and without an owner tag two streams would overwrite each other and
the bar would jump backwards. The `primary` flag is computed in the backend so
the frontend does not hardcode which component gates completion — Node.js does,
because Claude Code's install blocks on npm.

Nothing polls. There is no `setInterval` in this feature.

## Testing

```
npm run typecheck   # tsc --noEmit
npm test            # node scripts/run-tests.mjs
```

`scripts/run-tests.mjs` bundles the tests with esbuild before running them,
because the engine's internal imports are extensionless (`./pure`) — which is
what `electron-vite` resolves at build time, but which Node's native ESM resolver
refuses. Bundling runs the tests through the same resolver the app uses, instead
of changing the import style of `src/main` to satisfy a test runner or
reimplementing the logic in tests and letting it drift.

`electron` is marked external in the bundle, so a module that picked up an
`electron` import fails at run time. The "engine must not depend on Electron"
property is enforced rather than assumed.

Coverage is deliberately split:

- `installer-pure.test.mjs` — decision logic only. Timing a real HTTP race in a
  unit test is inherently flaky (CI runners have been observed to time out on a
  mirror that answers instantly elsewhere), which is exactly why the network
  layer and the decision layer are separate modules.
- `installer-runtime.test.mjs` — the cache, digest verification, task manager,
  progress tagging and source-selection fallback, against the real filesystem in
  a temp directory.

## Module map

```
src/main/installer/
├── index.ts         orchestrator (InstallPipeline) + plan()
├── components.ts    pinned versions, URLs, digests, filesystem layout
├── types.ts         step results, progress payload, task state
├── errors.ts        structured AppError with codes and suggestions
├── logging.ts       secret redaction
├── pure.ts          decision logic, no IO — the testable core
├── source.ts        concurrent mirror benchmarking
├── download.ts      .part, Range resume, retries, cancellation
├── verify.ts        SHA256, SHASUMS parsing, pinned cross-check
├── cache.ts         sidecar markers, atomic promote, cache decisions
├── extract.ts       tar.xz extraction
├── progress.ts      throttled, owner-tagged event emission
├── task.ts          task lifecycle and cancellation
├── env.ts           detection, refreshed PATH, shell rc management
└── installers/
    ├── context.ts   what a component installer receives
    ├── node.ts      portable Node.js
    ├── git.ts       apt, optional, never fatal
    └── claude.ts    npm, with the self-repair path
```
