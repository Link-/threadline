import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import App from './App'
import { LEGACY_STORAGE_KEY, STORAGE_KEY } from './model'
import type { Item, Workspace } from './model'

afterEach(() => vi.unstubAllGlobals())

function renderPlan(items: Item[], storageKey = STORAGE_KEY): string {
  const workspace: Workspace = {
    version: 1,
    activePlanId: 'plan',
    plans: [{ id: 'plan', name: 'Example', items }],
  }
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => key === storageKey ? JSON.stringify(workspace) : null,
  })
  return renderToStaticMarkup(createElement(App))
}

describe('plan summary', () => {
  it('shows elapsed calendar days across all scheduled tasks, including nested and dependent tasks', () => {
    const items: Item[] = [
      { id: 'group', name: 'Group', kind: 'group', parentId: null,
        start: '2026-01-01', end: '2026-01-01', dependencies: [], collapsed: true, confidence: null },
      { id: 'first', name: 'First', kind: 'task', parentId: 'group',
        start: '2026-01-01', end: '2026-01-02', dependencies: [], collapsed: false, confidence: null },
      { id: 'last', name: 'Last', kind: 'task', parentId: null,
        start: '2026-01-02', end: '2026-01-05', dependencies: ['first'], collapsed: false, confidence: null },
    ]
    const html = renderPlan(items)
    expect(html).toContain('Jan 1 – Jan 6, 2026')
    expect(html).toContain('5 calendar days')
  })

  it('omits duration when a plan has no dated tasks', () => {
    const html = renderPlan([])
    expect(html).toContain('No dates yet')
    expect(html).not.toContain('calendar days')
    expect(html).toContain('Save locally')
    expect(html).toContain('Import plan')
    expect(html).toContain('aria-labelledby="import-dialog-title"')
    expect(html).toContain('aria-label="Import method"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('Paste JSON')
    expect(html).not.toContain('aria-label="Threadline plan JSON"')
    expect(html).toContain('Choose file')
    expect(html).toContain('Copy instructions')
    expect(html).toContain('Download instructions')
    expect(html).toContain('accept=".threadline.json,.json,application/json"')
  })

  it('loads saved Daymark plans when the Threadline storage key has not been written yet', () => {
    const item: Item = {
      id: 'saved', name: 'Saved task', kind: 'task', parentId: null,
      start: '2026-01-01', end: '2026-01-03', dependencies: [], collapsed: false, confidence: null,
    }
    const html = renderPlan([item], LEGACY_STORAGE_KEY)
    expect(html).toContain('Saved task')
    expect(html).toContain('2 calendar days')
  })
})
