# Cookbook: building the Windows installer

Build the user-scope Windows installer for the dsh web app: one `dsh-setup-<version>-x64.exe` that installs the deployed app closure, a bundled `node.exe`, and launcher shortcuts into `%LOCALAPPDATA%\Programs` — no admin rights, no system Node, no checkout on the target machine. Design rationale (closure manifest, launcher port semantics, keep-`~/.dsh` uninstall) lives in [the windows-installer Agent Note](../../.agents/notes/implemented/architecture/2026-08-14-windows-installer.md).

## 1. Check the prerequisites

- A Windows x64 machine with the repository checked out and `pnpm install` run.
- [Inno Setup 6](https://jrsoftware.org/isinfo.php) installed (a per-user winget install lands in `%LOCALAPPDATA%\Programs\Inno Setup 6`, which the build finds automatically), or pass `--iscc <path to ISCC.exe>`.
- Internet access on the first build to download the official `node.exe` (later builds reuse the cached copy); or pass `--node-exe <path>` to bundle a local one.

## 2. Run the build

```powershell
pnpm run build:windows-installer
```

The script runs the whole pipeline: `pnpm run build` → deploy the closure of [`apps/windows-runtime/package.json`](../../apps/windows-runtime/package.json) into `dist-windows/staging/app` (restoring peer-only packages and replacing links with real bytes) → stage `node.exe` → boot the staged app and require an HTTP answer (the smoke) → fill `dist-windows/setup.iss` from the template → compile with ISCC.

Flags:

| Flag | Effect |
|---|---|
| `--skip-build` | reuse existing `lib/` artifacts (skips `pnpm run build`) |
| `--skip-smoke` | skip the staged-boot smoke test |
| `--node-exe <path>` | bundle this local node.exe instead of downloading |
| `--node-version <ver>` | download this Node version (default: newest satisfying the repo engines range) |
| `iscc <path>` / `--iscc <path>` | use this ISCC.exe |
| `--dry-run` | print every command without executing |

**Verify:** the run ends with `build-windows-installer: product: dist-windows\dsh-setup-<version>-x64.exe (… MB)` and the smoke line `smoke passed: http://127.0.0.1:<port>/ → HTTP 200`. On failure, the error names the failing step; the staged tree and logs under `dist-windows/` and `%LOCALAPPDATA%\DeepSeek Harness\logs` hold the detail.

## 3. Install and check

```powershell
dist-windows\dsh-setup-<version>-x64.exe            # interactive wizard (EN/RU)
dist-windows\dsh-setup-<version>-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART   # silent
```

**Verify:** `%LOCALAPPDATA%\Programs\DeepSeek Harness` contains `app\node_modules\@deepseek-ai\dsh\lib\bin.js`, `node\node.exe`, and `launcher\dsh-web.ps1`. The Start-menu shortcut "DeepSeek Harness" starts the server hidden on port 3080 and opens the UI in the browser; a second click just opens another tab. "Stop DeepSeek Harness" stops the server. The API key is entered in the GUI settings at first run. Uninstall removes the install directory only — `~/.dsh` (sessions, settings, credentials) survives.

## 4. Change what ships

The shipped plugin set is the dependency list of [`apps/windows-runtime/package.json`](../../apps/windows-runtime/package.json) — the `dsh` CLI plus the closure mirrored from `python/sdk-runtime` and every `@deepseek-ai/*` peer declared in the workspace. Add or remove a dependency there, rerun `pnpm install --no-frozen-lockfile --filter dsh-windows-installer-pkg`, and rebuild. The smoke catches a missing package before it ships.

## Troubleshooting

- **Port 3080 already listening** (for example a source-tree `dsh web` on its default port): the launcher opens the browser to whatever holds the port instead of starting its own server. Stop the other listener, or run it on a different port.
- **`ISCC.exe not found`**: install Inno Setup 6 or pass `--iscc`.
- **`spawn EPERM` under tsx**: a confined sandbox blocks the esbuild child process; run the build in an unrestricted shell.
- The generated `dist-windows/setup.iss` is a build artifact — edit the template at `scripts/windows-installer/setup.iss.txt`, never the generated copy.
