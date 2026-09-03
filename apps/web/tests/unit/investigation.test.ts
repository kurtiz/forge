import { describe, expect, it } from 'vitest'
import {
  affectedFilesFrom,
  buildSearchQueries,
  detectFramework,
  detectPackageManager,
  isIgnorablePath,
  MAX_QUERIES,
  parseGrepOutput,
  rankMatches,
  truncateExcerpt,
} from '@/server/investigation/analysis'
import type { InvestigationRequest, SourceMatch } from '@/server/investigation/types'

function request(over: Partial<InvestigationRequest> = {}): InvestigationRequest {
  return {
    repoUrl: 'https://github.com/acme/app',
    journeyName: 'Invite teammate',
    entryPath: '/team',
    consoleErrors: [],
    networkErrors: [],
    ...over,
  }
}

describe('buildSearchQueries', () => {
  it('puts a route path from a network error ahead of generic tokens', () => {
    const queries = buildSearchQueries(
      request({
        networkErrors: ['POST https://app.example.com/api/invite 500'],
        consoleErrors: ["TypeError: Cannot read properties of undefined (reading 'teamId')"],
      }),
    )
    expect(queries[0]).toBe('/api/invite')
    expect(queries).toContain('teamId')
  })

  it('strips the scheme and host so the origin is never searched for', () => {
    const queries = buildSearchQueries(
      request({ networkErrors: ['GET https://app.example.com/checkout 404'] }),
    )
    expect(queries).toContain('/checkout')
    expect(queries.some((query) => query.includes('example.com'))).toBe(false)
  })

  it('drops stopwords that would match the whole repository', () => {
    const queries = buildSearchQueries(
      request({ consoleErrors: ['Uncaught TypeError: undefined is not a function'] }),
    )
    for (const noise of ['undefined', 'function', 'TypeError']) {
      expect(queries).not.toContain(noise)
    }
  })

  it('falls back to distinctive words from the journey name', () => {
    const queries = buildSearchQueries(request({ entryPath: '/' }))
    expect(queries).toContain('Invite')
    expect(queries).toContain('teammate')
  })

  it('deduplicates case-insensitively and caps the list', () => {
    const noisy = Array.from({ length: 40 }, (_, i) => `identifier${i} failure`)
    const queries = buildSearchQueries(request({ consoleErrors: noisy }))
    expect(queries.length).toBeLessThanOrEqual(MAX_QUERIES)
    expect(new Set(queries.map((q) => q.toLowerCase())).size).toBe(queries.length)
  })

  it('returns nothing to search when there is no evidence and no name', () => {
    expect(
      buildSearchQueries(request({ journeyName: '', entryPath: '/' })),
    ).toEqual([])
  })
})

describe('detectPackageManager', () => {
  it.each([
    ['pnpm-lock.yaml', 'pnpm'],
    ['package-lock.json', 'npm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
  ])('detects %s', (lockfile, expected) => {
    expect(detectPackageManager(['package.json', lockfile])).toBe(expected)
  })

  it('does not assume npm when no lockfile is present', () => {
    expect(detectPackageManager(['package.json', 'src/index.ts'])).toBeNull()
  })

  it('prefers pnpm when a repository carries more than one lockfile', () => {
    expect(detectPackageManager(['package-lock.json', 'pnpm-lock.yaml'])).toBe('pnpm')
  })
})

describe('detectFramework', () => {
  it('reads declared dependencies before file markers', () => {
    const framework = detectFramework(
      ['vite.config.ts', 'package.json'],
      JSON.stringify({ dependencies: { next: '15.0.0' } }),
    )
    expect(framework).toBe('Next.js')
  })

  it('falls back to a config marker when there is no package.json', () => {
    expect(detectFramework(['astro.config.mjs'], null)).toBe('Astro')
  })

  it('survives a malformed package.json', () => {
    expect(detectFramework(['vite.config.ts'], '{ not json')).toBe('Vite')
  })

  it('recognises repositories that are not node projects', () => {
    expect(detectFramework(['go.mod', 'main.go'], null)).toBe('Go')
    expect(detectFramework(['pyproject.toml'], null)).toBe('Python')
  })

  it('returns null when nothing identifies the project', () => {
    expect(detectFramework(['README.md'], null)).toBeNull()
  })
})

describe('isIgnorablePath', () => {
  it.each([
    'node_modules/react/index.js',
    'dist/bundle.js',
    '.next/server/app.js',
    'assets/app.min.js',
    'pnpm-lock.yaml',
    'src/routeTree.gen.ts',
    'src/types/env.d.ts',
  ])('ignores %s', (path) => {
    expect(isIgnorablePath(path)).toBe(true)
  })

  it.each(['src/routes/invite.tsx', 'app/api/invite/route.ts'])(
    'keeps %s',
    (path) => {
      expect(isIgnorablePath(path)).toBe(false)
    },
  )
})

describe('rankMatches', () => {
  const match = (path: string, line = 1): SourceMatch => ({
    path,
    line,
    excerpt: 'x',
    query: 'invite',
  })

  it('ranks application source above tests and docs', () => {
    const ranked = rankMatches([
      match('docs/invite.md'),
      match('src/routes/invite.test.tsx'),
      match('src/routes/invite.tsx'),
    ])
    expect(ranked[0].path).toBe('src/routes/invite.tsx')
    expect(ranked[ranked.length - 1].path).toBe('docs/invite.md')
  })

  it('drops generated and vendored paths entirely', () => {
    const ranked = rankMatches([
      match('node_modules/lib/invite.js'),
      match('src/invite.ts'),
    ])
    expect(ranked.map((m) => m.path)).toEqual(['src/invite.ts'])
  })

  it('deduplicates the same path and line', () => {
    expect(rankMatches([match('src/a.ts', 4), match('src/a.ts', 4)])).toHaveLength(1)
  })

  it('preserves query order between equally scored paths', () => {
    const ranked = rankMatches([match('src/first.ts'), match('src/second.ts')])
    expect(ranked.map((m) => m.path)).toEqual(['src/first.ts', 'src/second.ts'])
  })
})

describe('affectedFilesFrom', () => {
  it('returns unique paths in ranked order, capped', () => {
    const matches: SourceMatch[] = [
      { path: 'src/a.ts', line: 1, excerpt: '', query: 'q' },
      { path: 'src/a.ts', line: 9, excerpt: '', query: 'q' },
      { path: 'src/b.ts', line: 2, excerpt: '', query: 'q' },
    ]
    expect(affectedFilesFrom(matches)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(affectedFilesFrom(matches, 1)).toEqual(['src/a.ts'])
  })
})

describe('parseGrepOutput', () => {
  it('parses path, line, and text', () => {
    const matches = parseGrepOutput('./src/invite.ts:42:  post("/api/invite")', 'invite')
    expect(matches).toEqual([
      {
        path: 'src/invite.ts',
        line: 42,
        excerpt: 'post("/api/invite")',
        query: 'invite',
      },
    ])
  })

  it('keeps a windows-style path containing a colon out of the line number', () => {
    const [match] = parseGrepOutput('src/a:b.ts:7:code', 'x')
    expect(match.path).toBe('src/a:b.ts')
    expect(match.line).toBe(7)
  })

  it('ignores context lines and blank output', () => {
    expect(parseGrepOutput('src/a.ts-41-  context\n\n', 'x')).toEqual([])
  })
})

describe('truncateExcerpt', () => {
  it('preserves newlines so a code excerpt stays readable', () => {
    expect(truncateExcerpt('const a = 1\nconst b = 2')).toBe('const a = 1\nconst b = 2')
  })

  it('truncates past the limit', () => {
    expect(truncateExcerpt('x'.repeat(50), 10)).toBe(`${'x'.repeat(10)}…`)
  })
})
