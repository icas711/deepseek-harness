/**
 * @module @deepseek-ai/dsh-client-ui-telemetry-status
 *
 * Telemetry status surface for the General settings section, node half. The
 * empty apply exists so the plugin appears in the host cordis.yml / Loader;
 * the browser half ships the status row and mode control through
 * exports["./client"], discovered from the package.json dsh.client
 * declaration.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
