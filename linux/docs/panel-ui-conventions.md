# Panel UI conventions

How every panel in this app is built. Follow this when adding a panel or
restyling an existing one — the goal is that a reviewer cannot tell which panels
were written in which sitting.

## Non-negotiables

1. **No Tailwind utility classes in new or restyled markup.** Use the classes in
   `src/renderer/styles/global.css`. The older panels are a mix, and that mix is
   why they drifted: `text-sm text-[var(--color-text-secondary)]` on a heading and
   `text-lg font-semibold text-white` on the title rendered almost identically, so
   the hierarchy disappeared. Semantic classes make the intent explicit and
   survive a token change.
   This is also a *correctness* rule, not only a style rule. A shipped build once
   packaged a stylesheet with an empty `@layer utilities` — Tailwind's content
   scan found nothing on the packaging machine — and the setup wizard, which was
   written entirely in utilities, rendered as bare unstyled text on first launch
   while every restyled panel looked fine. `npm run check:css` fails the packaging
   if a class named in the renderer is missing from the emitted stylesheet.
2. **Never express state with colour alone.** Pair a colour with text or an icon:
   `<span className="badge badge-ok">已就绪</span>`, not a green dot by itself.
3. **Numbers that change must use `.tnum`** so percentages and byte counts do not
   jitter as they tick.
4. **Chinese user-facing text.** Code comments and identifiers stay English.
5. **Do not change behaviour while restyling.** Same IPC calls, same state, same
   handlers. If you spot a real bug, fix it and say so explicitly in your report —
   the previous styling pass silently fixed two (masked-key round-trip, `env`
   clobbering) and that had to be called out.

## Page skeleton

```tsx
<div className="page">
  <header className="page-header">
    <div>
      <h1 className="page-title">标题</h1>
      <p className="page-subtitle">一句话说明这个面板做什么</p>
    </div>
    <div className="row">{/* primary actions, right-aligned */}</div>
  </header>

  <section className="section">
    <h2 className="section-label">分组名</h2>
    <div className="card card-pad">{/* … */}</div>
  </section>
</div>
```

`.page` sets max width only — outer padding belongs to the layout wrapper in
`MainLayout`. Never add padding to a panel root.

Loading state: `<p className="muted" style={{ padding: '48px 0', textAlign: 'center' }}>加载中...</p>`

## Class reference

| Class | Use |
|---|---|
| `.page` `.page-header` `.page-title` `.page-subtitle` | page shell |
| `.section` `.section-label` | grouped block with a rule-line label |
| `.card` `.card-pad` `.card-hover` | surfaces; `card-hover` adds a hover border |
| `.empty` | centred empty state; put an `<Icon>` then a `<p>` inside `.card` |
| `.stat-grid` `.stat` `.stat-dot` `.stat-label` `.stat-value` | fact tiles; dot tone via `.is-ok` `.is-warn` `.is-bad` |
| `.card-button` | a whole card that is clickable |
| `.btn-primary` `.btn-secondary` `.btn-ghost` `.btn-danger` `.btn-sm` | buttons |
| `.form-input` `.form-select` `.form-textarea` `.field-label` `.field-hint` | form controls |
| `.field` | vertical rhythm between form fields |
| `.input-group` | input + trailing button that share a row |
| `.seg` `.seg-item` / `.is-on` | mutually exclusive choices, side by side |
| `.check-list` `.check-row` `.check-name` `.check-remove` | multi-select list; `.is-all` for the select-all row |
| `.kv` `.kv-label` `.kv-value` | read-only "label …… value" rows |
| `.preset-grid` `.preset` `.preset-name` `.preset-desc` `.is-on` | preset cards |
| `.callout` + `.callout-info` / `.callout-warn` / `.callout-danger` | inline notice, always with `.callout-title` + `.callout-body` |
| `.badge` + `-ok` `-warn` `-bad` `-muted` `-accent` | status pills |
| `.progress` `.progress-fill` `.is-indeterminate` | progress bar |
| `.code-block` `.log` | monospace surfaces |
| `.actions` | bottom action row with a top rule |
| `.stack-1` `.stack-2` `.stack-3` | vertical rhythm between siblings |
| `.row` `.row-between` | horizontal flex, with and without `space-between` |
| `.truncate` `.muted` `.secondary` `.tiny` `.tnum` `.mono` `.spin` | helpers |
| `.btn-block` `.btn-lg` | a full-width button; a larger primary action |
| `.form-note` | small centred note under a form control |
| `.dep-list` `.dep-row` `.dep-body` `.dep-name` `.dep-id` | one row per checked thing (system package, config file) |
| `.guide` `.guide-card` `.guide-close` | first-run overlay shell |
| `.guide-dots` `.guide-dot` / `.is-current` `.is-done` | position indicator |
| `.guide-mark` `.guide-title` `.guide-lede` `.guide-result` `.guide-actions` | guide content |

Layout that is genuinely one-off may use inline `style` — that is how the
existing panels handle grid templates and a few widths. Prefer a shared class
when a pattern appears twice.

## Icons

`import { Icon } from '../shared/Icon'`, then `<Icon name="trash" size={14} />`.
Available: puzzle, key, brain, bolt, robot, package, hook, plug, settings, file,
check, alert, x, download, refresh, terminal, trash, chevron-right,
chevron-left, external, info.

**No emoji in UI chrome.** They are drawn by the system font, so weight, optical
size and colour are uncontrolled and they differ between distributions. Emoji in
*user data* (a plugin's own description) may pass through.

## Copy rules

- Empty states explain what the thing **is** and what to do, not just that none
  exist. "还没有 Skill" alone is not enough; say what a skill is and how to make one.
- Error copy names the cause and the next action. Put long technical detail in a
  `.code-block` inside a `<details>`, not in the summary line.
- Prefer the concrete noun: "写入 `~/.claude/settings.json` 的 `env.ANTHROPIC_AUTH_TOKEN`"
  over "保存到配置文件".
- Say when something is optional or read-only, rather than leaving the user to
  discover it.

## Verifying a restyle

`npm run typecheck`, `npm test` and `npm run check:css` must pass. `check:css`
runs after a build and compares every class named in `src/renderer` against the
stylesheet `out/renderer/assets/index-*.css` actually contains — it is the cheap
way to catch a restyle that silently depends on a utility class the build did
not emit. Visual verification on Linux:

```bash
# build and package
npm run package:deb            # build + check:css + electron-builder

# render the wizard and each panel headlessly, one PNG per screen
bash scripts/capture-guide.sh /tmp/shots
bash scripts/capture-panels.sh
```

`capture-panels.sh` drives the panel through the persisted `activePanel` state,
so it renders each panel headlessly and writes a PNG per panel. Check the
screenshots — a restyle that compiles can still render as an unstyled wall of
text. The first-run guide is what a new user sees first and a returning user
never sees, so it has its own script; it needs `claude` off `PATH` (the guide is
skipped when a CLI is already installed) and clears the app state itself.
