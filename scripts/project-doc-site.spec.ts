/** Tests for the documentation website projection adapter. */

import { execFileSync } from 'node:child_process'
import { existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { docsPages, landingLink, routeLink, sectionSpec, type DocsPage } from '../website/docs.ts'
import {
  addProjectionFrontmatter, projectedPageContent, publishableImage, rewriteMarkdown,
} from './project-doc-site.ts'

const roots: string[] = []
const repositoryRoot = resolve(import.meta.dirname, '..')

function unexpectedWebsiteMarkdown(files: readonly string[]): string[] {
  return files.filter(file => file.endsWith('.md') && file !== 'website/AGENTS.md').sort()
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): { root: string; pages: DocsPage[] } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-doc-site-'))
  roots.push(root)
  mkdirSync(join(root, 'docs'), { recursive: true })
  mkdirSync(join(root, 'packages'), { recursive: true })
  writeFileSync(join(root, 'docs/a.md'), '# A\n')
  writeFileSync(join(root, 'docs/a-index.md'), '# A index\n')
  writeFileSync(join(root, 'docs/b.md'), '# B\n')
  writeFileSync(join(root, 'docs/x(y).md'), '# Parentheses\n')
  writeFileSync(join(root, 'packages/tool.ts'), 'one\ntwo\n')
  writeFileSync(join(root, 'packages/logo.svg'), '<svg/>\n')
  return {
    root,
    pages: [
      { source: 'docs/a.md', route: 'a.md', label: 'A', sidebar: 'reference', section: 'Test', order: 1 },
      { source: 'docs/b.md', route: 'reference-root/b.md', label: 'B', sidebar: 'reference', section: 'Test', order: 2 },
    ],
  }
}

function rewriteOptions(
  root: string,
  pages: DocsPage[],
  overrides: Partial<Parameters<typeof rewriteMarkdown>[1]> = {},
): Parameters<typeof rewriteMarkdown>[1] {
  return {
    sourcePath: 'docs/a.md',
    route: 'a.md',
    pages,
    repoRoot: root,
    repositoryRef: 'abc123',
    ...overrides,
  }
}

describe('website source layout', () => {
  it('rejects Markdown outside the subtree instructions', () => {
    expect(unexpectedWebsiteMarkdown([
      'website/AGENTS.md',
      'website/docs.ts',
      'website/api/harness/service.md',
    ])).toEqual(['website/api/harness/service.md'])
  })

  it('contains no tracked or unignored documentation copies', () => {
    const files = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'website'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    ).split('\n').filter(file => file !== '' && existsSync(resolve(repositoryRoot, file)))

    expect(
      unexpectedWebsiteMarkdown(files),
      'Keep canonical Markdown under docs/ and publish it through website/docs.ts.',
    ).toEqual([])
  })
})

describe('publishableImage', () => {
  it('accepts a regular file inside the repository', () => {
    const { root } = fixture()
    const real = realpathSync(join(root, 'packages/logo.svg'))
    expect(publishableImage(join(root, 'packages/logo.svg'), realpathSync(root))).toBe(real)
  })

  it('refuses a target whose real path escapes the repository', () => {
    // Publication copies the bytes onto the site, so a reference reaching a
    // build-machine file must not be treated as an image the repository owns.
    const { root } = fixture()
    const outside = mkdtempSync(join(tmpdir(), 'dsh-doc-site-outside-'))
    roots.push(outside)
    writeFileSync(join(outside, 'secret.png'), 'not really a png\n')
    symlinkSync(join(outside, 'secret.png'), join(root, 'packages/linked.png'))

    expect(publishableImage(join(root, 'packages/linked.png'), realpathSync(root))).toBeUndefined()
    expect(publishableImage(join(outside, 'secret.png'), realpathSync(root))).toBeUndefined()
  })

  it('refuses a directory', () => {
    const { root } = fixture()
    expect(publishableImage(join(root, 'packages'), realpathSync(root))).toBeUndefined()
  })
})

describe('rewriteMarkdown', () => {
  it('maps published pages and pins unpublished source links', () => {
    const { root, pages } = fixture()
    const source = '[B](b.md#part) [source](../packages/tool.ts:2) [web](https://example.com)\n'
    expect(rewriteMarkdown(source, rewriteOptions(root, pages))).toBe(
      '[B](./reference-root/b.md#part) '
      + '[source](https://github.com/deepseek-ai/deepseek-harness/blob/abc123/packages/tool.ts#L2) '
      + '[web](https://example.com)\n',
    )
  })

  it('routes a link through a declared source alias', () => {
    const { root, pages } = fixture()
    const aliased = pages.map(page => page.source === 'docs/a.md' ? { ...page, sourceAliases: ['docs/a-index.md'] } : page)
    expect(rewriteMarkdown('[A](a-index.md)\n', rewriteOptions(root, aliased, { sourcePath: 'docs/b.md', route: 'reference-root/b.md' })))
      .toBe('[A](../a.md)\n')
  })

  it('uses raw GitHub content for unpublished images when nothing places them', () => {
    const { root, pages } = fixture()
    expect(rewriteMarkdown('![logo](../packages/logo.svg)\n', rewriteOptions(root, pages))).toBe(
      '![logo](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/abc123/packages/logo.svg)\n',
    )
  })

  it('hands an image to the placer and uses the URL it returns', () => {
    // A raw GitHub URL cannot serve a private repository, so the site build
    // carries images itself; the placer is what puts them there. The stand-in
    // derives its URL the way the real one does, so a placer that stopped
    // returning the basename would fail here rather than pass on a constant.
    const { root, pages } = fixture()
    const placed: string[] = []
    expect(rewriteMarkdown('![logo](../packages/logo.svg)\n', rewriteOptions(root, pages, {
      placeImage: (absPath) => {
        const name = basename(absPath)
        placed.push(name)
        return `./${name}`
      },
    }))).toBe('![logo](./logo.svg)\n')
    expect(placed).toEqual(['logo.svg'])
  })

  it('keeps a placed image\u2019s query or fragment', () => {
    // An SVG view fragment and a Vite query both change what the reference
    // means, and the GitHub branch has always carried them.
    const { root, pages } = fixture()
    expect(rewriteMarkdown('![logo](../packages/logo.svg#view)\n', rewriteOptions(root, pages, {
      placeImage: absPath => `./${basename(absPath)}`,
    }))).toBe('![logo](./logo.svg#view)\n')
  })

  it('leaves a published page link to the route even when a placer exists', () => {
    const { root, pages } = fixture()
    expect(rewriteMarkdown('[B](b.md)\n', rewriteOptions(root, pages, {
      placeImage: () => { throw new Error('a page link must not be placed as an asset') },
    }))).toBe('[B](./reference-root/b.md)\n')
  })

  it('does not rewrite Markdown-looking text inside code fences', () => {
    const { root, pages } = fixture()
    const source = '```md\n[B](b.md)\n```\n'
    expect(rewriteMarkdown(source, rewriteOptions(root, pages))).toBe(source)
  })

  it('replaces the destination token without changing repeated titles or escapes', () => {
    const { root, pages } = fixture()
    const source = '[title](b.md "b.md") [escaped](x\\(y\\).md)\n'
    expect(rewriteMarkdown(source, rewriteOptions(root, pages))).toBe(
      '[title](./reference-root/b.md "b.md") '
      + '[escaped](https://github.com/deepseek-ai/deepseek-harness/blob/abc123/docs/x(y).md)\n',
    )
  })

  it('fails loud when a relative target is missing', () => {
    const { root, pages } = fixture()
    expect(() => rewriteMarkdown('[missing](missing.md)\n', rewriteOptions(root, pages)))
      .toThrow('links to missing path "missing.md"')
  })
})

describe('docsPages manifest', () => {
  it('redirects the site home to its quick-start page', () => {
    const homes = docsPages.filter(page => page.sidebar === null)
    expect(homes.map(page => page.route)).toEqual(['index.md'])
    for (const page of homes) {
      const source = readFileSync(resolve(repositoryRoot, page.source), 'utf8')
      const projected = projectedPageContent(source, page)
      expect(projected).toContain('layout: false')
      expect(projected).toContain('http-equiv: refresh')
      expect(projected).toContain('content: 0; url=./guide/quickstart')
      expect(projected).not.toContain('# DeepSeek Harness')
    }
  })

  it('publishes each route once from one existing English source', () => {
    const routes = new Set<string>()
    const sources = new Map<string, string>()
    for (const page of docsPages) {
      expect(routes.has(page.route), `duplicate route ${page.route}`).toBe(false)
      routes.add(page.route)
      expect(page.source).toMatch(/\.md$/)
      expect(
        existsSync(resolve(repositoryRoot, page.source)),
        `${page.route} source ${page.source} does not exist`,
      ).toBe(true)
      const holder = sources.get(page.source)
      expect(holder, `source ${page.source}: ${holder} and ${page.route} both project it`).toBeUndefined()
      sources.set(page.source, page.route)
    }
  })

  it('indexes every subsystem page in the folder README', () => {
    const pages = globSync(join(repositoryRoot, 'docs/subsystems/*.md'))
      .map(page => basename(page))
      .filter(page => page !== 'README.md')
      .sort()
    expect(pages.length).toBeGreaterThan(0)
    const rows = readFileSync(join(repositoryRoot, 'docs/subsystems/README.md'), 'utf8')
    const missing = pages.filter(page => !rows.includes(`| [${page}](${page}) |`))
    expect(missing, 'README.md must carry one table row per subsystem page').toEqual([])
  })

  it('publishes the reviewed generated catalogs from their English sources', () => {
    // module-graph, event-producer-consumer, and graph-atlas are generated but intentionally unpublished.
    const routes = [
      ['reference/capability-seams.md', 'docs/capability-seams.md'],
      ['reference/agent-lifecycle.md', 'docs/agent-lifecycle.md'],
      ['reference/tool-execution-pipeline.md', 'docs/tool-execution-pipeline.md'],
      ['reference/config-catalog.md', 'docs/config-catalog.md'],
      ['reference/tool-catalog.md', 'docs/tool-catalog.md'],
      ['reference/persistence-catalog.md', 'docs/persistence-catalog.md'],
      ['reference/cordis-api/context.md', 'docs/cordis-api/context.md'],
      ['reference/cordis-api/events.md', 'docs/cordis-api/events.md'],
      ['reference/cordis-api/fiber.md', 'docs/cordis-api/fiber.md'],
      ['reference/cordis-api/registry.md', 'docs/cordis-api/registry.md'],
      ['reference/cordis-api/service.md', 'docs/cordis-api/service.md'],
    ] as const
    for (const [route, source] of routes) {
      expect(docsPages.find(page => page.route === route)?.source, route).toBe(source)
    }
  })

  it('keeps the deep outline on the persistence catalog', () => {
    const page = docsPages.find(page => page.route === 'reference/persistence-catalog.md')
    expect(page?.outline).toBe('deep')
  })
})

describe('sidebar ordering', () => {
  it('places every section a sidebar collection owns', () => {
    for (const page of docsPages) {
      if (page.sidebar === null) continue
      expect(() => sectionSpec(page.section), page.route).not.toThrow()
    }
  })

  it('refuses a section with no declared placement', () => {
    expect(() => sectionSpec('Data structures'))
      .toThrow('Sidebar section "Data structures" has no declared placement.')
  })

  it('lands every navigation item on a page the manifest publishes', () => {
    // The navigation bar named `/guide/` while the manifest published the guide's
    // first page at `guide/quickstart.md`, so the item served a 404.
    const published = new Set(docsPages.map(page => routeLink(page.route)))
    for (const collection of ['guide', 'develop', 'reference'] as const) {
      expect(published, collection).toContain(landingLink(collection))
    }
  })

  it('collapses the subsystem groups and leaves the smaller ones open', () => {
    expect(sectionSpec('Execution and tools').collapsed).toBe(true)
    expect(sectionSpec('Concepts').collapsed).toBeUndefined()
  })

  it('gives each page its own position within a section', () => {
    // Sidebar entries sort by order alone, so a shared value leaves the two
    // pages ranked by whichever manifest block happens to be concatenated
    // first rather than by an intent the manifest states.
    const taken = new Map<string, string>()
    const collisions: string[] = []
    for (const page of docsPages) {
      const slot = `${String(page.sidebar)}/${page.section}#${page.order}`
      const holder = taken.get(slot)
      if (holder === undefined) taken.set(slot, page.label)
      else collisions.push(`${slot}: ${holder} / ${page.label}`)
    }
    expect(collisions).toEqual([])
  })
})

describe('addProjectionFrontmatter', () => {
  it('adds frontmatter to an ordinary Markdown page', () => {
    expect(addProjectionFrontmatter('# Guide\n', { source: 'docs/guide.md' })).toBe(
      '---\neditSource: "docs/guide.md"\n---\n\n# Guide\n',
    )
  })

  it('extends existing VitePress frontmatter', () => {
    expect(addProjectionFrontmatter('---\nlayout: home\n---\n', { source: 'docs/index.md' })).toBe(
      '---\neditSource: "docs/index.md"\nlayout: home\n---\n',
    )
  })

  it('adds the page-specific outline depth from the publication manifest', () => {
    expect(addProjectionFrontmatter('# Catalog\n', {
      source: 'docs/catalog.md',
      outline: [2, 4],
    })).toBe(
      '---\neditSource: "docs/catalog.md"\noutline: [2,4]\n---\n\n# Catalog\n',
    )
  })
})

describe('projectedPageContent', () => {
  const page = (sidebar: DocsPage['sidebar']): DocsPage => ({
    source: 'docs/user/index.md',
    route: 'index.md',
    label: 'Home',
    sidebar,
    section: 'Home',
    order: 0,
  })

  it('omits the source-only body from the site home page', () => {
    expect(projectedPageContent(
      '---\nlayout: false\nhead:\n  - - meta\n    - http-equiv: refresh\n      content: 0; url=./guide/quickstart\n---\n\n# DeepSeek Harness\n',
      page(null),
    )).toBe('---\nlayout: false\nhead:\n  - - meta\n    - http-equiv: refresh\n      content: 0; url=./guide/quickstart\n---\n')
  })

  it('keeps the full body for ordinary pages', () => {
    const markdown = '---\ntitle: Guide\n---\n\n# Guide\n'
    expect(projectedPageContent(markdown, page('guide'))).toBe(markdown)
  })

  it('drops the repository badge every page links from its footer', () => {
    const badge = '[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)'
    expect(projectedPageContent(`# Guide\n\nBody.\n\n${badge}\n`, page('guide')))
      .toBe('# Guide\n\nBody.\n')
  })

  it('rejects a home source without frontmatter', () => {
    expect(() => projectedPageContent('# DeepSeek Harness\n', page(null)))
      .toThrow('home page source "docs/user/index.md" must start with YAML frontmatter')
  })
})
