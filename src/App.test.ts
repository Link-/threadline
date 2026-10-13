import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import App from './App'
import { LEGACY_STORAGE_KEY, STORAGE_KEY } from './model'
import type { Item, Workspace } from './model'

afterEach(() => vi.unstubAllGlobals())

function renderWorkspace(workspace: Workspace, storageKey = STORAGE_KEY): string {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => key === storageKey ? JSON.stringify(workspace) : null,
  })
  return renderToStaticMarkup(createElement(App))
}

function renderPlan(items: Item[], storageKey = STORAGE_KEY): string {
  return renderWorkspace({
    version: 1,
    activePlanId: 'plan',
    plans: [{ id: 'plan', name: 'Example', items }],
  }, storageKey)
}

describe('plan summary', () => {
  it('exposes full long plan names on hover in the breadcrumb and title', () => {
    const name = '[Initiative] Migrate Results production tracking across all teams and milestones'
    const html = renderWorkspace({
      version: 1,
      activePlanId: 'long',
      plans: [{ id: 'long', name, items: [] }],
    })
    expect(html.split(`title="${name}"`)).toHaveLength(3)
    expect(html).toContain(`<strong title="${name}">${name}</strong>`)
  })

  it('shows the active plan width and defaults older plans to 320px', () => {
    const plans = [
      { id: 'first', name: 'First', items: [], labelWidth: 440 },
      { id: 'second', name: 'Second', items: [], labelWidth: 560 },
    ]
    const workspace: Workspace = { version: 1, activePlanId: 'first', plans }
    expect(renderWorkspace(workspace)).toContain('aria-valuenow="440"')
    expect(renderWorkspace({ ...workspace, activePlanId: 'second' })).toContain('aria-valuenow="560"')
    expect(renderWorkspace({
      ...workspace, plans: [{ id: 'first', name: 'First', items: [] }, plans[1]],
    })).toContain('aria-valuenow="320"')
  })

  it('shows elapsed calendar days across all scheduled tasks, including nested and dependent tasks', () => {
    const items: Item[] = [
      { id: 'group', name: 'Group', kind: 'group', parentId: null,
        start: '2026-01-01', end: '2026-01-01', dependencies: [], collapsed: true, confidence: null, importance: null, completed: false },
      { id: 'first', name: 'First', kind: 'task', parentId: 'group',
        start: '2026-01-01', end: '2026-01-02', dependencies: [], collapsed: false, confidence: null, importance: null, completed: false },
      { id: 'last', name: 'Last', kind: 'task', parentId: null,
        start: '2026-01-02', end: '2026-01-05', dependencies: ['first'], collapsed: false, confidence: null, importance: null, completed: false },
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

  it('renders importance pills only on items with a defined importance', () => {
    const html = renderPlan([
      { id: 'group', name: 'Group', kind: 'group', parentId: null,
        start: '2026-01-01', end: '2026-01-01', dependencies: [], collapsed: false, confidence: 85, importance: 'critical', completed: false },
      { id: 'task', name: 'Task', kind: 'task', parentId: 'group',
        start: '2026-01-01', end: '2026-01-02', dependencies: [], collapsed: false, confidence: 75, importance: 'stretch goal', completed: false },
      { id: 'unset', name: 'Unset', kind: 'task', parentId: null,
        start: '2026-01-01', end: '2026-01-01', dependencies: [], collapsed: false, confidence: null, importance: null, completed: false },
    ])
    expect(html).toContain('importance-pill row-importance row-property importance-critical')
    expect(html).toContain('importance-pill row-importance row-property importance-stretch-goal')
    expect(html.match(/importance-pill row-importance/g)).toHaveLength(2)
    expect(html).toContain('Edit importance of Group: Critical')
    expect(html).toContain('Edit confidence of Task: 75%')
    expect(html).toContain('Edit duration of Task')
    expect(html).toContain('<span class="child-count">1</span>')
  })

  it('marks completed tasks in the row and timeline but leaves groups and other tasks unmarked', () => {
    const html = renderPlan([
      { id: 'group', name: 'Phase', kind: 'group', parentId: null,
        start: '2026-01-01', end: '2026-01-01', dependencies: [], collapsed: false, confidence: null, importance: null, completed: false },
      { id: 'done', name: 'Finished', kind: 'task', parentId: 'group',
        start: '2026-01-01', end: '2026-01-02', dependencies: [], collapsed: false, confidence: null, importance: null, completed: true },
      { id: 'open', name: 'Open', kind: 'task', parentId: null,
        start: '2026-01-02', end: '2026-01-03', dependencies: [], collapsed: false, confidence: null, importance: null, completed: false },
    ])
    expect(html).toContain('completed-row')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('Mark Finished as not done')
    expect(html).toContain('task-bar completed')
    expect(html.match(/task-bar completed/g)).toHaveLength(1)
  })

  it('loads saved Daymark plans when the Threadline storage key has not been written yet', () => {
    const item: Item = {
      id: 'saved', name: 'Saved task', kind: 'task', parentId: null,
      start: '2026-01-01', end: '2026-01-03', dependencies: [], collapsed: false, confidence: null, importance: null, completed: false,
    }
    const html = renderPlan([item], LEGACY_STORAGE_KEY)
    expect(html).toContain('Saved task')
    expect(html).toContain('2 calendar days')
  })
})
