import { describe, expect, it } from 'vitest'
import {
  anchorJourneys,
  currentPath,
  offeredPaths,
} from '#/server/agent/explorer'
import type { DiscoveredJourney } from '#/server/contracts'
import type { PageElement, PageObservation } from '#/server/execution/types'

const link = (name: string, href: string): PageElement => ({
  ref: `r-${href}`,
  role: 'link',
  name,
  href,
})

const dashboard: PageObservation = {
  url: 'https://mdrif.com/eightbrothers/dashboard',
  title: 'Dashboard',
  status: 200,
  headings: [],
  elements: [
    link('Referrals', '/eightbrothers/referrals'),
    link('Settings', 'https://mdrif.com/eightbrothers/settings/'),
    link('Broken', 'javascript:void(0)'),
  ],
  text: '',
  consoleErrors: [],
  networkErrors: [],
}

const journey = (entryPath: string): DiscoveredJourney => ({
  name: 'Refer a patient',
  goal: 'Refer a patient to the diagnostic centre',
  priority: 0.9,
  entryPath,
})

describe('currentPath', () => {
  it('is the path of the page being explored', () => {
    expect(currentPath(dashboard)).toBe('/eightbrothers/dashboard')
  })

  it('keeps the root as a single slash', () => {
    expect(currentPath({ ...dashboard, url: 'https://mdrif.com/' })).toBe('/')
  })
})

describe('offeredPaths', () => {
  it('collects the paths the page links to', () => {
    expect(offeredPaths(dashboard)).toEqual([
      '/eightbrothers/referrals',
      '/eightbrothers/settings',
    ])
  })

  it('ignores links that do not go anywhere', () => {
    // `javascript:void(0)` parses, and its "pathname" is void(0). Offering that
    // to the model as a destination is how a journey gets sent nowhere.
    expect(
      offeredPaths({
        ...dashboard,
        elements: [
          link('Menu', 'javascript:void(0)'),
          link('Email us', 'mailto:hello@example.com'),
        ],
      }),
    ).toEqual([])
  })
})

describe('anchorJourneys', () => {
  it('keeps a path the page actually links to', () => {
    const [anchored] = anchorJourneys(
      [journey('/eightbrothers/referrals')],
      dashboard,
    )
    expect(anchored.entryPath).toBe('/eightbrothers/referrals')
  })

  it('pins a guessed path back to the page the journey came from', () => {
    // The failure this guards against: a model exploring a tenant-scoped
    // application proposes `/dashboard`, which answers 200 with an unrelated
    // page, no control matches, and every journey is skipped.
    const [anchored] = anchorJourneys([journey('/dashboard')], dashboard)
    expect(anchored.entryPath).toBe('/eightbrothers/dashboard')
  })

  it('pins the site root too, when nothing links there', () => {
    const [anchored] = anchorJourneys([journey('/')], dashboard)
    expect(anchored.entryPath).toBe('/eightbrothers/dashboard')
  })

  it('normalises a path given without a leading slash', () => {
    const [anchored] = anchorJourneys(
      [journey('eightbrothers/referrals')],
      dashboard,
    )
    expect(anchored.entryPath).toBe('/eightbrothers/referrals')
  })

  it('ignores a trailing slash when matching', () => {
    const [anchored] = anchorJourneys(
      [journey('/eightbrothers/settings/')],
      dashboard,
    )
    expect(anchored.entryPath).toBe('/eightbrothers/settings')
  })

  it('leaves the rest of the journey alone', () => {
    const [anchored] = anchorJourneys([journey('/nowhere')], dashboard)
    expect(anchored.name).toBe('Refer a patient')
    expect(anchored.priority).toBe(0.9)
  })
})
