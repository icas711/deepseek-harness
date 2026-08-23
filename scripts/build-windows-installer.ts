/**
 * Build the Windows user-scope installer for the dsh web app: deploy the
 * apps/windows-runtime closure (the `dsh` CLI plus the vendored framework
 * packages it resolves through) into a staging tree, materialize package
 * links, fetch a matching official node.exe, run a keyless boot smoke against
 * the staged tree, fill the Inno Setup template, and compile it with ISCC.
 * The payload layout (app/ + node/ + launcher/) and the keep-~/.dsh uninstall
 * semantics are owned by scripts/windows-installer/setup.iss.txt.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { cp, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join, dirname, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '..')

/** The deploy root: a dependency-only manifest owning the installer closure (apps/windows-runtime). */
const DEPLOY_ROOT_PACKAGE = 'dsh-windows-installer-pkg'
/** Legacy deploy may hoist workspace packages back beside the deploy source. */
const DEPLOY_SOURCE_NODE_MODULES = 'apps/windows-runtime/node_modules'
/** The app's built entry inside the deployed closure. */
const APP_ENTRY = ['node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'] as const
/** The web frontend's served document inside the staged closure. */
const FRONTEND_INDEX = ['node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html'] as const
/** Source directory of the launcher scripts and the Inno Setup template. */
const INSTALLER_SRC = join('scripts', 'windows-installer')
const OUT_DIR = 'dist-windows'
/** The repo's engines range; the bundled Node major must satisfy it. */
const ENGINES = '^22.19.0 || >=24.0.0'
/** Windows node.exe download root. */
const NODE_DIST = 'https://nodejs.org/dist'

/**
 * Validated CLI configuration; construction owns help and parse-error exits.
 */
class BuildCli {
  private constructor(
    /** Skip `pnpm run build`; lib/ artifacts must already exist. */
    readonly skipBuild: boolean,
    /** Skip the staged-boot smoke test before packaging. */
    readonly skipSmoke: boolean,
    /** Explicit node.exe to bundle (a local file) instead of downloading one. */
    readonly nodeExe: string | undefined,
    /** Explicit Node version to download (e.g. `24.10.0`); default: latest satisfying engines. */
    readonly nodeVersion: string | undefined,
    /** Explicit path to ISCC.exe; default: standard install locations. */
    readonly iscc: string | undefined,
    /** Print every command and filesystem change instead of executing. */
    readonly dryRun: boolean,
  ) {}

  /**
   * Parse argv. Help exits 0; malformed flags exit 1.
   * @param argv - the raw arguments (`process.argv.slice(2)`).
   * @returns the parsed, validated configuration.
   */
  static parse(argv: string[]): BuildCli {
    let values: ReturnType<typeof BuildCli.parseRaw>
    try {
      values = BuildCli.parseRaw(argv)
    } catch (error) {
      console.error(`build-windows-installer: ${error instanceof Error ? error.message : String(error)}\n`)
      console.error(BuildCli.usage())
      process.exit(1)
    }
    if (values.help) {
      console.log(BuildCli.usage())
      process.exit(0)
    }
    return new BuildCli(
      values['skip-build'], values['skip-smoke'], values['node-exe'], values['node-version'], values.iscc, values['dry-run'],
    )
  }

  private static parseRaw(argv: string[]) {
    return parseArgs({
      args: argv,
      options: {
        'skip-build': { type: 'boolean', default: false },
        'skip-smoke': { type: 'boolean', default: false },
        'node-exe': { type: 'string' },
        'node-version': { type: 'string' },
        'iscc': { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'help': { type: 'boolean', default: false },
      },
    }).values
  }

  private static usage(): string {
    return [
      'Usage: pnpm run build:windows-installer [flags]  (Windows only)',
      '',
      '  --skip-build           skip `pnpm run build` (lib/ artifacts must already exist).',
      '  --skip-smoke           skip the staged-boot smoke test.',
      '  --node-exe <path>      bundle this local node.exe instead of downloading one.',
      '  --node-version <ver>   download this Node version (e.g. 24.10.0);',
      '                         default: newest release satisfying the repo engines range.',
      '  --iscc <path>          path to Inno Setup ISCC.exe; default: standard install locations.',
      '  --dry-run              print every command and filesystem change without executing.',
      '  --help                 print this help.',
      '',
      `Products land in ${OUT_DIR}/; the installer is user-scope (no UAC) and keeps ~/.dsh on uninstall.`,
    ].join('\n')
  }
}

/** The repository version, read from the root manifest. */
function readVersion(): string {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

/**
 * Render a four-part numeric version for Inno's `VersionInfoVersion` from a
 * possibly-prerelease semver string (`0.1.0-rc.5` → `0.1.0.5`).
 * @param version - the raw manifest version.
 * @returns the dotted-numeric spelling.
 */
function numericVersion(version: string): string {
  const groups = version.match(/\d+/g)
  const parts = groups === null ? [] : groups.slice(0, 4).map(part => Number.parseInt(part, 10))
  while (parts.length < 4) parts.push(0)
  return parts.join('.')
}

/**
 * Resolve the default Node version: the newest dist release whose clean
 * `major.minor.patch` satisfies the repository engines range.
 * @returns the version string without the leading `v`.
 */
async function resolveDefaultNodeVersion(): Promise<string> {
  const response = await fetch(`${NODE_DIST}/index.json`)
  if (!response.ok) throw new Error(`build-windows-installer: nodejs.org index fetch failed: HTTP ${response.status}`)
  const releases = await response.json() as Array<{ version: string }>
  for (const release of releases) {
    const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(release.version)
    if (match === null) continue
    const majorText = match.at(1)
    const minorText = match.at(2)
    if (majorText === undefined || minorText === undefined) continue
    const major = Number.parseInt(majorText, 10)
    const minor = Number.parseInt(minorText, 10)
    if ((major === 22 && minor >= 19) || major >= 24) return release.version.slice(1)
  }
  throw new Error(`build-windows-installer: no Node release on ${NODE_DIST} satisfies ${ENGINES}.`)
}

/**
 * Sequential build pipeline. Subprocesses inherit stdio and errors include
 * the command; dry runs print commands and filesystem changes.
 */
class InstallerBuild {
  private readonly outDir = resolve(root, OUT_DIR)
  /** The cleared deploy target and installer payload root for the app tree. */
  readonly appStaging = resolve(root, OUT_DIR, 'staging', 'app')
  /** The bundled Node runtime destination. */
  readonly nodeStaging = resolve(root, OUT_DIR, 'staging', 'node')
  private readonly isssPath = resolve(root, OUT_DIR, 'setup.iss')

  constructor(private readonly cli: BuildCli) {
    if (process.platform !== 'win32') {
      throw new Error('build-windows-installer: this pipeline is Windows-only; run it on Windows.')
    }
  }

  /** Build all package artifacts unless `--skip-build` was passed. */
  async build(): Promise<void> {
    if (this.cli.skipBuild) {
      console.log('build-windows-installer: skipping pnpm run build (--skip-build)')
      return
    }
    await this.run('build', ['run', 'build'])
  }

  /** Clear and deploy the installer closure into the staging tree. */
  async deployStaging(): Promise<void> {
    if (this.cli.dryRun) console.log(`build-windows-installer: [dry-run] rm -rf ${this.appStaging}`)
    else await rm(this.appStaging, { recursive: true, force: true })
    await this.run('deploy', [
      '--filter', DEPLOY_ROOT_PACKAGE, 'deploy', '--legacy', '--prod',
      '--config.node-linker=hoisted', '--config.auto-install-peers=false', '--config.link-workspace-packages=true',
      this.appStaging,
    ])
    await this.restoreLegacyHoists()
    await this.materializeStagedLinks()
    if (!this.cli.dryRun) {
      this.requireFile(join(this.appStaging, ...APP_ENTRY), 'the deployed app entry')
      this.requireFile(join(this.appStaging, ...FRONTEND_INDEX), 'the web frontend dist')
    }
  }

  /**
   * Restore direct packages that pnpm's legacy hoister places beside the
   * deploy source instead of in the target: the overrides-linked vendored
   * framework packages (cosmokit, schemastery) never reach the staged tree
   * on their own. Copies exclude each source's package-local dependency
   * tree to preserve one flat Cordis instance.
   */
  private async restoreLegacyHoists(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-windows-installer: [dry-run] restore direct dependencies omitted by legacy deploy')
      return
    }
    const manifestPath = join(this.appStaging, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const sourceNodeModules = resolve(root, ...DEPLOY_SOURCE_NODE_MODULES.split('/'))
    const restored: string[] = []
    for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
      const destination = join(this.appStaging, 'node_modules', dependency)
      if (existsSync(destination)) continue
      const source = join(sourceNodeModules, dependency)
      if (!existsSync(source)) {
        throw new Error(
          `build-windows-installer: deployed dependency ${dependency} is absent from both ${destination} and ${source}.`,
        )
      }
      await mkdir(dirname(destination), { recursive: true })
      const nestedNodeModules = join(source, 'node_modules')
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
      restored.push(dependency)
    }
    const stillMissing = Object.keys(manifest.dependencies ?? {})
      .filter(dependency => !existsSync(join(this.appStaging, 'node_modules', dependency)))
    if (stillMissing.length > 0) {
      throw new Error(`build-windows-installer: staged dependencies remain missing: ${stillMissing.join(', ')}.`)
    }
    if (restored.length > 0) {
      console.log(`build-windows-installer: restored legacy deploy hoists: ${restored.join(', ')}`)
    }
  }

  /** Replace deploy-time package links with real bytes and reject any remaining link. */
  private async materializeStagedLinks(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-windows-installer: [dry-run] materialize staged package links')
      return
    }
    const nodeModules = join(this.appStaging, 'node_modules')
    let remaining = await this.findLink(nodeModules)
    while (remaining !== undefined) {
      const source = await resolveLink(remaining)
      await rm(remaining, { recursive: true, force: true })
      await cp(source, remaining, { recursive: true, dereference: true })
      remaining = await this.findLink(nodeModules)
    }
  }

  /** Return the first symlink or junction below a directory, if one exists. */
  private async findLink(directory: string): Promise<string | undefined> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) return path
      if (metadata.isDirectory()) {
        const nested = await this.findLink(path)
        if (nested !== undefined) return nested
      }
    }
    return undefined
  }

  /**
   * Put the Node runtime in place: an explicit `--node-exe`, or the official
   * win-x64 node.exe for the resolved version.
   */
  async stageNode(): Promise<string> {
    if (this.cli.nodeExe !== undefined) {
      const source = resolve(this.cli.nodeExe)
      this.requireFile(source, 'the --node-exe runtime')
      return source
    }
    const version = this.cli.nodeVersion ?? await resolveDefaultNodeVersion()
    const cachePath = join(this.nodeStaging, `node-v${version}-win-x64.exe`)
    /** Canonical name the launcher expects beside the app tree. */
    const nodeExe = join(this.nodeStaging, 'node.exe')
    if (!this.cli.dryRun && existsSync(cachePath)) {
      console.log(`build-windows-installer: reusing ${cachePath}`)
      await cp(cachePath, nodeExe)
      return nodeExe
    }
    const url = `${NODE_DIST}/v${version}/win-x64/node.exe`
    if (this.cli.dryRun) {
      console.log(`build-windows-installer: [dry-run] curl -o ${cachePath} ${url}`)
      return nodeExe
    }
    console.log(`build-windows-installer: downloading ${url}`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`build-windows-installer: node.exe download failed: HTTP ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength < 40 * 1024 * 1024) {
      throw new Error(`build-windows-installer: downloaded node.exe is only ${bytes.byteLength} bytes; refusing to bundle it.`)
    }
    await mkdir(this.nodeStaging, { recursive: true })
    await writeFile(cachePath, bytes)
    await cp(cachePath, nodeExe)
    return nodeExe
  }

  /**
   * Boot the staged app on an OS-assigned port and require the frontend to
   * answer, then stop it: a packaging run must not ship a tree that cannot
   * start. Uses the bundled node.exe so the smoke also proves the runtime.
   * @param nodeExe - the staged Node executable.
   */
  async smoke(nodeExe: string): Promise<void> {
    if (this.cli.skipSmoke) {
      console.log('build-windows-installer: skipping staged-boot smoke (--skip-smoke)')
      return
    }
    if (this.cli.dryRun) {
      console.log(`build-windows-installer: [dry-run] ${nodeExe} ${join(this.appStaging, ...APP_ENTRY)} web --port 0 (smoke)`)
      return
    }
    const url = await new Promise<string>((resolvePromise, reject) => {
      const child = spawn(nodeExe, [join(this.appStaging, ...APP_ENTRY), 'web', '--port', '0'], {
        cwd: this.appStaging,
        stdio: ['ignore', 'pipe', 'inherit'],
      })
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('build-windows-installer: staged app did not announce its URL within 90 s.'))
      }, 90_000)
      let settled = false
      let seen = ''
      child.stdout.on('data', (chunk: Buffer) => {
        seen += chunk.toString('utf8')
        const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(seen)
        if (match === null || settled) return
        settled = true
        clearTimeout(timer)
        resolvePromise(`http://127.0.0.1:${match[1]}/`)
      })
      child.once('exit', code => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error(`build-windows-installer: staged app exited with code ${code} before serving.`))
      })
      child.once('error', error => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error(`build-windows-installer: staged app failed to spawn: ${error.message}`))
      })
    })
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`build-windows-installer: staged frontend answered HTTP ${response.status} on ${url}.`)
      console.log(`build-windows-installer: smoke passed: ${url} → HTTP ${response.status}`)
    } finally {
      await stopServerOn(url)
    }
  }

  /** Fill the Inno Setup template and compile it; returns the installer path. */
  async compile(nodeExe: string): Promise<string> {
    const version = readVersion()
    const product = join(this.outDir, `dsh-setup-${version}-x64.exe`)
    if (!this.cli.dryRun) {
      await mkdir(this.outDir, { recursive: true })
      const template = await readFile(resolve(root, INSTALLER_SRC, 'setup.iss.txt'), 'utf8')
      const filled = template
        .replaceAll('{{VERSION}}', version)
        .replaceAll('{{NUMERIC_VERSION}}', numericVersion(version))
        .replaceAll('{{OUTPUT_DIR}}', this.outDir)
        .replaceAll('{{APP_STAGING}}', this.appStaging)
        .replaceAll('{{NODE_EXE}}', nodeExe)
        .replaceAll('{{LAUNCHER_DIR}}', resolve(root, INSTALLER_SRC))
      if (/\{\{[A-Z_]+\}\}/.test(filled)) throw new Error('build-windows-installer: unfilled placeholder remains in the generated setup.iss.')
      await writeFile(this.isssPath, filled)
      console.log(`build-windows-installer: wrote ${this.isssPath}`)
    } else {
      console.log(`build-windows-installer: [dry-run] would write ${this.isssPath} from the template`)
    }
    await this.runExe('iscc', await this.resolveIscc(), [this.isssPath])
    if (!this.cli.dryRun && !existsSync(product)) {
      throw new Error(`build-windows-installer: product ${product} is missing after the ISCC run; inspect ${this.outDir}.`)
    }
    return product
  }

  /** Resolve ISCC.exe: `--iscc`, then the standard Inno Setup 6/7 locations. */
  private async resolveIscc(): Promise<string> {
    if (this.cli.iscc !== undefined) return resolve(this.cli.iscc)
    const candidates = [
      process.env['ProgramFiles(x86)'],
      process.env.ProgramFiles,
      process.env.LOCALAPPDATA === undefined ? undefined : join(process.env.LOCALAPPDATA, 'Programs'),
    ].filter((base): base is string => base !== undefined)
      .flatMap(base => [join(base, 'Inno Setup 6', 'ISCC.exe'), join(base, 'Inno Setup 7', 'ISCC.exe')])
    const found = candidates.find(candidate => existsSync(candidate))
    if (found !== undefined) return found
    throw new Error(
      'build-windows-installer: ISCC.exe not found in standard Inno Setup locations; install Inno Setup or pass --iscc <path>.',
    )
  }

  /** Fail loudly when a required staging artifact is absent. */
  private requireFile(path: string, what: string): void {
    if (existsSync(path)) return
    throw new Error(`build-windows-installer: ${what} is missing at ${path}; run without --skip-build so lib/ artifacts exist.`)
  }

  /**
   * Print the product path and, outside dry-run mode, its size.
   * @param product - the installer path returned by {@link compile}.
   */
  printProduct(product: string): void {
    if (this.cli.dryRun) {
      console.log(`build-windows-installer: [dry-run] would produce: ${product}`)
      return
    }
    const megabytes = statSync(product).size / (1024 * 1024)
    console.log(`build-windows-installer: product: ${product}  (${megabytes.toFixed(1)} MB)`)
  }

  /**
   * Run one pnpm subprocess with inherited stdio. pnpm is addressed through
   * `npm_execpath` (this script runs via `pnpm run`) so no shell is involved.
   * @param label - the step name used in logs and error messages.
   * @param args - the pnpm arguments.
   */
  private async run(label: string, args: string[]): Promise<void> {
    const command = this.pnpmInvocation()
    const printable = `[node ${command.node} ${command.pnpmScript}] ${args.join(' ')}`
    if (this.cli.dryRun) {
      console.log(`build-windows-installer: [dry-run] pnpm ${args.join(' ')}`)
      return
    }
    console.log(`build-windows-installer: ${label}: pnpm ${args.join(' ')}`)
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(command.node, [command.pnpmScript, ...args], {
        cwd: root,
        stdio: 'inherit',
        // Artifact builds must not mutate or validate a developer's Git hooks.
        env: { ...process.env, CI: 'true' },
      })
      child.once('error', (error) => {
        reject(new Error(`build-windows-installer: ${label} failed to spawn: ${error.message} (${printable})`))
      })
      child.once('exit', (code, signal) => {
        if (code === 0) {
          resolvePromise()
          return
        }
        const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
        reject(new Error(`build-windows-installer: ${label} failed (${cause}): ${printable}`))
      })
    })
  }

  /**
   * Run one non-pnpm subprocess with inherited stdio.
   * @param label - the step name used in logs and error messages.
   * @param command - the executable.
   * @param args - its arguments.
   */
  private async runExe(label: string, command: string, args: string[]): Promise<void> {
    const printable = [command, ...args].join(' ')
    if (this.cli.dryRun) {
      console.log(`build-windows-installer: [dry-run] ${printable}`)
      return
    }
    console.log(`build-windows-installer: ${label}: ${printable}`)
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(command, args, { cwd: root, stdio: 'inherit' })
      child.once('error', (error) => {
        reject(new Error(`build-windows-installer: ${label} failed to spawn: ${error.message}`))
      })
      child.once('exit', (code, signal) => {
        if (code === 0) {
          resolvePromise()
          return
        }
        const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
        reject(new Error(`build-windows-installer: ${label} failed (${cause}): ${printable}`))
      })
    })
  }

  /**
   * The shell-free pnpm invocation: the running pnpm's own script through
   * Node, from `npm_execpath`.
   * @returns the Node executable and the pnpm script path.
   */
  private pnpmInvocation(): { node: string; pnpmScript: string } {
    const execPath = process.env.npm_execpath
    if (execPath === undefined || !/\.(cjs|mjs|js)$/.test(execPath)) {
      throw new Error('build-windows-installer: run this script through pnpm (pnpm run build:windows-installer) so npm_execpath is set.')
    }
    return { node: process.execPath, pnpmScript: execPath }
  }
}

/**
 * Resolve a staged link target's real path.
 * @param link - the symlink or junction path.
 * @returns the resolved target.
 */
async function resolveLink(link: string): Promise<string> {
  return realpath(link)
}

/**
 * Stop the staged smoke server by killing the node process listening on its
 * port. `child.kill()` alone is not enough once the promise handed the child
 * away, so match by port through the platform's process list.
 * @param url - the served URL the smoke server announced.
 */
async function stopServerOn(url: string): Promise<void> {
  const port = new URL(url).port
  const killer = spawn('powershell.exe', [
    '-NoProfile', '-Command',
    `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`
    + ` | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`,
  ], { stdio: 'ignore' })
  await new Promise<void>(resolvePromise => {
    killer.once('exit', () => resolvePromise())
    killer.once('error', () => resolvePromise())
  })
}

async function main(): Promise<void> {
  const cli = BuildCli.parse(process.argv.slice(2))
  const pipeline = new InstallerBuild(cli)
  console.log(`build-windows-installer: staging: ${pipeline.appStaging}`)
  await pipeline.build()
  await pipeline.deployStaging()
  const nodeExe = await pipeline.stageNode()
  await pipeline.smoke(nodeExe)
  const product = await pipeline.compile(nodeExe)
  pipeline.printProduct(product)
}

await main()
