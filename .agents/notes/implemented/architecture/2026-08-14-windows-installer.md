# Agent Note: Windows user-scope installer for the dsh web app (windows-installer)

Status: implemented

## Problem

The web GUI is reachable only by running `dsh web` from a repository checkout with a system Node install. A Windows end user needs a normal application experience: run one installer, get a Start-menu/desktop shortcut, click it, and see the UI in the browser — without Node, pnpm, or a checkout on the machine.

## Decision

### Packaging route: pnpm deploy closure + official node.exe + Inno Setup

The installer payload is **not** a pkg/SEA single-file exe (that route documents Windows as a non-goal for the Python SDK runtime). It is a real on-disk package tree:

- `app/` — the closure of the dependency-only manifest [`apps/windows-runtime/package.json`](../../../../apps/windows-runtime/package.json) (`dsh-windows-installer-pkg`), deployed by `pnpm --filter dsh-windows-installer-pkg deploy --legacy --prod --config.node-linker=hoisted --config.auto-install-peers=false --config.link-workspace-packages=true` — the same flag set `build-exe-for-python-sdk.ts` measured. The manifest mirrors `python/sdk-runtime`'s closure (the headless composition's proven dependency list) plus `@deepseek-ai/dsh` and every `@deepseek-ai/*` peer declared anywhere in the workspace: with `--config.auto-install-peers=false`, peer-only packages (cosmokit, schemastery, dsh-timeout, dsh-scope, …) reach the tree only as direct manifest dependencies, and deploy drops them otherwise. The app entry is therefore `app/node_modules/@deepseek-ai/dsh/lib/bin.js`. A restore pass then copies any manifest dependency that legacy deploy hoisted back beside the deploy source (`apps/windows-runtime/node_modules`) into the staged tree, excluding package-local dependency trees, and a materialization pass replaces every staged link (workspace symlinks/junctions) with real bytes.
- `node/node.exe` — the official `win-x64/node.exe` of the newest dist release satisfying the repository engines range (`^22.19.0 || >=24.0.0`, resolved live from `nodejs.org/dist/index.json`; `--node-exe`/`--node-version` override). The canonical `node.exe` name is what the launcher expects; the versioned download stays beside it as a cache. No SHA pinning yet — see Deferred.
- `launcher/` — two PowerShell scripts (PowerShell ships with every Windows).

[`scripts/build-windows-installer.ts`](../../../../scripts/build-windows-installer.ts) owns the pipeline: `pnpm run build` → deploy + restore + materialize + artifact checks (`node_modules/@deepseek-ai/dsh/lib/bin.js`, the web frontend `dist/index.html`) → node.exe staging → a keyless staged-boot smoke → template fill → ISCC compile. pnpm is invoked shell-free through `npm_execpath` (the script must run via `pnpm run build:windows-installer`); ISCC.exe is spawned directly. ISCC.exe is located in the standard Inno Setup 6/7 directories (per-machine and `%LOCALAPPDATA%\Programs`, where winget's per-user install lands) or via `--iscc`. Product: `dist-windows/dsh-setup-<version>-x64.exe` (~58 MB compressed, lzma2 solid).

### Launcher semantics: fixed port, idempotent start, browser as the window

`dsh-web.ps1` probes TCP 3080 (the web bundle's own deployment fallback port). Not listening → start `node.exe app\node_modules\@deepseek-ai\dsh\lib\bin.js web --port 3080` hidden, stdout/stderr redirected to `%LOCALAPPDATA%\custom-harness\logs`, wait up to 90 s for the port; then open the browser. Already listening → just open the browser, so repeated shortcut clicks never stack servers. The trade-off: a port probe cannot tell DSH from any other listener — on a developer machine already running a source `dsh web` (same default port), the shortcut opens that instance instead. `dsh-stop.ps1` stops the server by matching `node.exe` processes whose command line runs `@deepseek-ai\dsh\lib\bin.js" web` — installation-shaped, never all node processes.

### Installer: user scope, data survives uninstall

`scripts/windows-installer/setup.iss.txt` (template; the generated copy is filled and written to `dist-windows/setup.iss`): `PrivilegesRequired=lowest`, `DefaultDirName={localappdata}\Programs\custom-harness` (the display name macro; the product was rebranded from "DeepSeek Harness" to "custom-harness" in the [user-build note](../feature/2026-09-11-user-build-idle-exit-zai-rebrand.md)), x64 only, English + Russian wizard languages (both ship inside Inno Setup). Uninstall removes only the install directory; `~/.dsh` (sessions, settings, credentials) is deliberately untouched — there is no `[UninstallDelete]` section and none may be added without reversing this note. No autostart task. The API key is entered at first run in the GUI settings, not during installation.

### Smoke: the packaging run must not ship a tree that cannot start

Before ISCC, the script boots the staged tree with the bundled node.exe (`web --port 0`, OS-assigned), reads the printed `dsh web: http://127.0.0.1:<port>` line from stdout (no trailing slash), requires an HTTP answer from the frontend, then kills the listener by port through `Get-NetTCPConnection`. The smoke uses the bundled runtime, so it also proves the node.exe pairing. `--skip-smoke` opts out; the smoke is skipped in `--dry-run`.

## Known Limitations and Deferred Work

- The exe is unsigned: Windows SmartScreen will warn on first run. Code signing needs a certificate and is deferred.
- node.exe is downloaded without a pinned digest (size floor only). A reproducible build should pin the version and its SHA256 from `SHASUMS256.txt`.
- The fixed port 3080 has no collision fallback to `--port 0` (which would break the "second click just opens a tab" idempotence, since the browser URL would differ per run) and no listener identity check (a non-DSH listener on 3080 makes the shortcut open the browser to it and never start the app).
- The closure manifest carries some packages the web composition never mounts (dsh-e2b, dsh-lsp, the SDK/hooks packages); they add installed size and can be trimmed by diffing against the web profile's rows.
- The smoke boots with the real `~/.dsh` home (profile auto-initialization), so it creates the `web` profile on the building machine if absent.

## Alternatives considered

**pkg `--sea` single exe.** Rejected for this surface: the Python SDK note documents Windows as a non-goal for that route, and the installer does not need VFS semantics — a real tree on disk is simpler and keeps normal module resolution.

**Electron/Tauri shell.** Rejected for v1: the browser is an adequate window, and a shell adds a large dependency and its own release process for no functional gain.

**MSI/WiX.** Rejected: user-scope per-machine semantics are not needed; Inno Setup is free, scriptable, and bilingual out of the box.

**Requiring a system Node.** Rejected by product decision: the target audience is end users; bundling node.exe (~80 MB) buys full autonomy.

**Deploying apps/cli directly (`--filter @deepseek-ai/dsh`).** Rejected by measurement: legacy deploy with auto-install-peers off drops every peer-only workspace package, and the CLI manifest does not (and should not) carry them; the dedicated dependency-only root mirrors the proven python/sdk-runtime pattern instead.

## Consequences

Bought: a one-file installer requiring no admin rights, Node, or repository knowledge; idempotent launch; user data survives reinstall/uninstall; the closure manifest doubles as the explicit statement of what the Windows app ships. Paid: ~450 MB installed footprint (closure + node.exe); lzma2-solid compression makes the ISCC step slow; the payload is plain source (no obfuscation — same stance as the single-exe note); a second hand-maintained closure manifest beside python/sdk-runtime.
