# @deepseek-ai/dsh-client-ui-telemetry-status

Telemetry status surface for the General settings section, browser half of a dual-face Client plugin: the mounted backend's sharing disclosure (`host.telemetryStatus`), a refresh control, and — where the deployment applies mode changes live — a mode selector that writes the `session-telemetry` settings section. The node half is an empty `apply`.

## Registration surfaces

- `dsh.client` manifest (browser roster; see the web-app bundle patch)
- `tsconfig.client.json` aggregate reference
- `packages/bundle/web-app` row + package dependency

## Behavior

- **Disclosure** — one `host.telemetryStatus` call renders the row: the live `sharing` policy, the mode the settings section resolves to (`configuredMode`), and whether the deployment can change it without a restart (`changeable`). A host without a telemetry backend renders the explanatory text only (`unavailable`); the disclosure refreshes on `settings/document-updated` for the `session-telemetry` namespace and on connection resets.
- **Mode change** — where `changeable` is true, the selector writes `settings.update({ ns: 'session-telemetry', patch: { mode } })`; the backend swaps its capture pipeline live (see `@deepseek-ai/dsh-session-telemetry-otel`). The write's refusal message (e.g. an uploading mode without a usable exporter) renders in the row; the disclosure is re-read after every write, so the row always shows the backend's own word.

## Model Experience

None, as the row renders the backend's sharing disclosure and mode field in the browser; nothing here enters the Session log, model context, or telemetry.

#### KV Cache effect

None: the surface registers no prompt, schema, or request field.

## Known Limitations and Deferred Work

- The row offers the closed mode set the backend's schema defines; a future backend with a different vocabulary needs its own surface or a widened disclosure.
