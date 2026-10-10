import { describe, expect, it } from 'vitest'
import {
  addDays, adjacentSiblingDrop, barDragAxis, confidenceLevel, createWorkspace, daysBetween, dragDates, flattenItems, isDescendant,
  parseNewLine, parsePlanFile, parseWorkspace, planFileStem, relocateItem, rowDropIntent, schedulePlan,
  serializePlan, summarizePlan,
} from './model'
import type { Item, Plan, Workspace } from './model'
import { barGeometry, clampLabelWidth, createTimeline, dependencyLinks, itemDateLabel, linkPath, linkPoints, ROW_HEIGHT } from './chart'

function task(id: string, start: string, end: string, dependencies: string[] = [], parentId: string | null = null): Item {
  return { id, name: id, kind: 'task', parentId, start, end, dependencies, collapsed: false, confidence: null }
}

function group(id: string, parentId: string | null = null): Item {
  return { ...task(id, '2026-01-01', '2026-01-01', [], parentId), kind: 'group' }
}

function plan(items: Item[]): Plan {
  return { id: 'plan', name: 'Test plan', items }
}

describe('date semantics', () => {
  it('treats endpoints as inclusive and uses calendar days across DST and leap years', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2026-03-28', 3)).toBe('2026-03-31')
    expect(daysBetween('2026-03-28', '2026-03-31')).toBe(3)
    expect(() => schedulePlan(plan([task('bad', '2026-02-30', '2026-03-01')]))).toThrow('Invalid date')
  })

  it('preserves duration while shifting a chain to the day after each dependency', () => {
    const spans = schedulePlan(plan([
      task('a', '2026-01-01', '2026-01-03'),
      task('b', '2026-01-02', '2026-01-05', ['a']),
      task('c', '2026-01-04', '2026-01-04', ['b']),
    ]))
    expect(spans.a).toEqual({ start: '2026-01-01', end: '2026-01-03' })
    expect(spans.b).toEqual({ start: '2026-01-04', end: '2026-01-07' })
    expect(spans.c).toEqual({ start: '2026-01-08', end: '2026-01-08' })
  })

  it('moves or resizes inclusive bars without allowing a negative duration', () => {
    const span = { start: '2026-01-10', end: '2026-01-13' }
    expect(dragDates(span, 'move', -3)).toEqual({ start: '2026-01-07', end: '2026-01-10' })
    expect(dragDates(span, 'start', -2)).toEqual({ start: '2026-01-08', end: '2026-01-13' })
    expect(dragDates(span, 'end', 2)).toEqual({ start: '2026-01-10', end: '2026-01-15' })
    expect(dragDates(span, 'start', 10)).toEqual({ start: '2026-01-13', end: '2026-01-13' })
    expect(dragDates(span, 'end', -10)).toEqual({ start: '2026-01-10', end: '2026-01-10' })
  })

  it('locks task bar drags to their dominant axis and treats group bar drags as vertical only', () => {
    expect(barDragAxis('task', 5, 5)).toBe('pending')
    expect(barDragAxis('task', 18, 3)).toBe('horizontal')
    expect(barDragAxis('task', 5, 12)).toBe('vertical')
    expect(barDragAxis('task', 12, 12)).toBe('vertical')
    expect(barDragAxis('group', 90, 3)).toBe('pending')
    expect(barDragAxis('group', 90, 12)).toBe('vertical')
  })

  it('labels duration as the elapsed difference between start and finish', () => {
    expect(itemDateLabel({
      start: '2026-10-09', end: '2026-10-12',
    })).toBe('3d · Oct 9 – Oct 12')
    expect(itemDateLabel({
      start: '2026-10-09', end: '2026-10-09',
    })).toBe('0d · Oct 9 – Oct 9')
  })

  it('waits for the latest of several dependencies, without moving a later planned start earlier', () => {
    const items = [
      task('a', '2026-01-01', '2026-01-03'),
      task('b', '2026-01-01', '2026-01-08'),
      task('c', '2026-01-04', '2026-01-05', ['a', 'b']),
      task('d', '2026-02-01', '2026-02-02', ['c']),
    ]
    expect(schedulePlan(plan(items)).c).toEqual({ start: '2026-01-09', end: '2026-01-10' })
    expect(schedulePlan(plan(items)).d).toEqual({ start: '2026-02-01', end: '2026-02-02' })
    expect(schedulePlan(plan([{ ...items[1], end: '2026-01-02' }, ...items.filter((item) => item.id !== 'b')])).c)
      .toEqual({ start: '2026-01-04', end: '2026-01-05' })
  })
})

describe('plan summary', () => {
  it('counts every row and uses the scheduled range of nested and dependent tasks', () => {
    const items = [
      { ...group('phase'), collapsed: true },
      task('first', '2026-01-01', '2026-01-02', [], 'phase'),
      group('empty'),
      task('last', '2026-01-02', '2026-01-05', ['first']),
    ]
    const current = plan(items)
    expect(summarizePlan(current, schedulePlan(current))).toEqual({
      taskCount: 2, groupCount: 2, start: '2026-01-01', end: '2026-01-06', calendarDays: 5,
    })
  })

  it('reports zero elapsed days for a same-day task and no dates for an empty plan', () => {
    const sameDay = plan([task('one', '2026-01-01', '2026-01-01')])
    expect(summarizePlan(sameDay, schedulePlan(sameDay))).toEqual({
      taskCount: 1, groupCount: 0, start: '2026-01-01', end: '2026-01-01', calendarDays: 0,
    })
    const emptyGroup = plan([group('phase')])
    expect(summarizePlan(emptyGroup, schedulePlan(emptyGroup))).toEqual({
      taskCount: 0, groupCount: 1, start: null, end: null, calendarDays: null,
    })
  })
})

describe('groups and dependencies', () => {
  it('parses a typed line as a task or a # group', () => {
    expect(parseNewLine('  Design review  ')).toEqual({ kind: 'task', name: 'Design review' })
    expect(parseNewLine('  # Delivery  ')).toEqual({ kind: 'group', name: 'Delivery' })
    expect(parseNewLine('\\#tag')).toEqual({ kind: 'task', name: '#tag' })
    expect(parseNewLine('#')).toBeNull()
    expect(parseNewLine('  ')).toBeNull()
  })

  it('moves tasks into and out of groups by horizontal drop position', () => {
    const original = [group('g'), task('a', '2026-01-01', '2026-01-02'), task('b', '2026-01-01', '2026-01-02')]
    const inside = rowDropIntent(original, 'g', 0, 70, .5)
    expect(inside).toEqual({ anchorId: 'g', placement: 'inside' })
    const nested = relocateItem(original, 'b', inside)
    expect(flattenItems(nested).map(({ item, depth }) => [item.id, depth]))
      .toEqual([['g', 0], ['b', 1], ['a', 0]])
    const outdent = rowDropIntent(nested, 'b', 1, 15, .8)
    expect(outdent).toEqual({ anchorId: 'g', placement: 'after' })
    expect(flattenItems(relocateItem(nested, 'a', inside)).map(({ item }) => item.id))
      .toEqual(['g', 'a', 'b'])
    expect(flattenItems(relocateItem(nested, 'b', outdent)).map(({ item, depth }) => [item.id, depth]))
      .toEqual([['g', 0], ['b', 0], ['a', 0]])
  })

  it('holds the drop target steady near group-entry, depth, and row-half boundaries', () => {
    const items = [group('g'), task('nested', '2026-01-01', '2026-01-02', [], 'g')]
    expect(rowDropIntent(items, 'g', 0, 55, .5)).toEqual({ anchorId: 'g', placement: 'after' })
    expect(rowDropIntent(items, 'g', 0, 55, .5, { anchorId: 'g', placement: 'inside' }))
      .toEqual({ anchorId: 'g', placement: 'inside' })
    expect(rowDropIntent(items, 'g', 0, 70, .16, { anchorId: 'g', placement: 'inside' }))
      .toEqual({ anchorId: 'g', placement: 'inside' })
    expect(rowDropIntent(items, 'g', 0, 70, .14, { anchorId: 'g', placement: 'inside' }))
      .toEqual({ anchorId: 'g', placement: 'before' })
    expect(rowDropIntent(items, 'nested', 1, 46, .25, { anchorId: 'g', placement: 'before' }))
      .toEqual({ anchorId: 'g', placement: 'before' })
    expect(rowDropIntent(items, 'nested', 1, 48, .25, { anchorId: 'g', placement: 'before' }))
      .toEqual({ anchorId: 'nested', placement: 'before' })
    expect(rowDropIntent(items, 'nested', 1, 38, .25, { anchorId: 'nested', placement: 'before' }))
      .toEqual({ anchorId: 'nested', placement: 'before' })
    expect(rowDropIntent(items, 'nested', 1, 34, .25, { anchorId: 'nested', placement: 'before' }))
      .toEqual({ anchorId: 'g', placement: 'before' })
    expect(rowDropIntent(items, 'nested', 1, 50, .55, { anchorId: 'nested', placement: 'before' }))
      .toEqual({ anchorId: 'nested', placement: 'before' })
    expect(rowDropIntent(items, 'nested', 1, 50, .6, { anchorId: 'nested', placement: 'before' }))
      .toEqual({ anchorId: 'nested', placement: 'after' })
  })

  it('moves only among visible siblings while preserving nested group children', () => {
    const items = [
      group('g'),
      task('a', '2026-01-01', '2026-01-02', [], 'g'),
      group('inner', 'g'),
      task('inside', '2026-01-01', '2026-01-02', [], 'inner'),
      task('b', '2026-01-01', '2026-01-02', [], 'g'),
      group('other'),
    ]
    const rows = flattenItems(items)
    expect(adjacentSiblingDrop(rows, items[1], -1)).toBeNull()
    expect(adjacentSiblingDrop(rows, items[1], 1)).toEqual({ anchorId: 'inner', placement: 'after' })
    expect(adjacentSiblingDrop(rows, items[2], 1)).toEqual({ anchorId: 'b', placement: 'after' })
    expect(adjacentSiblingDrop(rows, items[4], 1)).toBeNull()
    expect(adjacentSiblingDrop(rows, items[0], 1)).toEqual({ anchorId: 'other', placement: 'after' })
    const moved = relocateItem(items, 'inner', adjacentSiblingDrop(rows, items[2], 1)!)
    expect(flattenItems(moved).map(({ item, depth }) => [item.id, depth]))
      .toEqual([['g', 0], ['a', 1], ['b', 1], ['inner', 1], ['inside', 2], ['other', 0]])
  })

  it('moves a nested group with its descendants and rejects ancestor cycles', () => {
    const original = [
      group('outer'),
      group('inner', 'outer'),
      task('child', '2026-01-01', '2026-01-02', [], 'inner'),
      group('other'),
    ]
    const moved = relocateItem(original, 'inner', { anchorId: 'other', placement: 'inside' })
    expect(flattenItems(moved).map(({ item, depth }) => [item.id, depth]))
      .toEqual([['outer', 0], ['other', 0], ['inner', 1], ['child', 2]])
    expect(() => relocateItem(original, 'outer', { anchorId: 'child', placement: 'after' }))
      .toThrow('cannot be moved')
    expect(() => relocateItem(original, 'child', { anchorId: 'other', placement: 'inside' })).not.toThrow()
    expect(flattenItems(relocateItem(moved, 'child', { anchorId: null, placement: 'end' })).at(-1)?.item.id)
      .toBe('child')
  })

  it('moves group bars with their children and accepts task bar drops at a destination group depth', () => {
    const items = [
      group('phase'),
      task('child', '2026-01-01', '2026-01-02', [], 'phase'),
      group('destination'),
      task('other', '2026-01-01', '2026-01-02', [], 'destination'),
    ]
    const inside = rowDropIntent(items, 'destination', 0, 70, .5)
    const nested = relocateItem(items, 'phase', inside)
    expect(flattenItems(nested).map(({ item, depth }) => [item.id, depth]))
      .toEqual([['destination', 0], ['phase', 1], ['child', 2], ['other', 1]])
    const beforeChild = rowDropIntent(nested, 'other', 1, 33 + 17, .25)
    expect(beforeChild).toEqual({ anchorId: 'other', placement: 'before' })
    const movedChild = relocateItem(nested, 'child', beforeChild)
    expect(flattenItems(movedChild).map(({ item, depth }) => [item.id, depth]))
      .toEqual([['destination', 0], ['phase', 1], ['child', 1], ['other', 1]])
    expect(flattenItems(relocateItem(movedChild, 'child', { anchorId: null, placement: 'end' }))
      .at(-1)?.item.parentId).toBeNull()
  })

  it('expands a collapsed drop target and detects dependency cycles introduced by nesting', () => {
    const items = [
      { ...group('g'), collapsed: true },
      task('inside', '2026-01-01', '2026-01-02', [], 'g'),
      task('dependent', '2026-01-01', '2026-01-03', ['g']),
    ]
    const moved = relocateItem(items, 'dependent', { anchorId: 'g', placement: 'inside' })
    expect(moved.find((item) => item.id === 'g')?.collapsed).toBe(false)
    expect(() => schedulePlan(plan(moved))).toThrow('Dependency cycle')
    expect(schedulePlan(plan(items)).dependent).toEqual({ start: '2026-01-03', end: '2026-01-05' })
  })

  it('rolls up nested children and waits for every leaf in a group', () => {
    const spans = schedulePlan(plan([
      group('outer'),
      group('inner', 'outer'),
      task('a', '2026-01-02', '2026-01-04', [], 'inner'),
      task('b', '2026-01-03', '2026-01-08', [], 'outer'),
      task('c', '2026-01-01', '2026-01-02', ['outer']),
    ]))
    expect(spans.inner).toEqual({ start: '2026-01-02', end: '2026-01-04' })
    expect(spans.outer).toEqual({ start: '2026-01-02', end: '2026-01-08' })
    expect(spans.c).toEqual({ start: '2026-01-09', end: '2026-01-10' })
  })

  it('keeps empty groups without dates, and disallows depending on them', () => {
    expect(schedulePlan(plan([group('empty')])).empty).toBeNull()
    expect(() => schedulePlan(plan([group('empty'), task('a', '2026-01-01', '2026-01-02', ['empty'])])))
      .toThrow('needs a task')
  })

  it('rejects dependency cycles, including a task depending on its own parent group', () => {
    expect(() => schedulePlan(plan([
      task('a', '2026-01-01', '2026-01-02', ['b']),
      task('b', '2026-01-01', '2026-01-02', ['a']),
    ]))).toThrow('Dependency cycle')
    expect(() => schedulePlan(plan([
      group('parent'),
      task('child', '2026-01-01', '2026-01-02', ['parent'], 'parent'),
    ]))).toThrow('Dependency cycle')
  })

  it('rejects invalid parent nesting, missing links, and duplicate IDs', () => {
    expect(() => schedulePlan(plan([group('a', 'b'), group('b', 'a')]))).toThrow('nested inside themselves')
    expect(() => schedulePlan(plan([task('a', '2026-01-01', '2026-01-02', ['missing'])]))).toThrow('missing item')
    expect(() => schedulePlan(plan([task('a', '2026-01-01', '2026-01-02'), group('a')]))).toThrow('duplicate')
    expect(() => schedulePlan(plan([task('a', '2026-01-03', '2026-01-02')]))).toThrow('must end')
  })

  it('flattens nested rows in order and respects collapsed groups', () => {
    const items = [
      { ...group('one'), collapsed: true },
      task('a', '2026-01-01', '2026-01-02', [], 'one'),
      group('nested', 'one'),
      task('b', '2026-01-01', '2026-01-02', [], 'nested'),
      task('c', '2026-01-01', '2026-01-02'),
    ]
    expect(flattenItems(items).map(({ item }) => item.id)).toEqual(['one', 'c'])
    expect(flattenItems(items, false).map(({ item, depth }) => [item.id, depth]))
      .toEqual([['one', 0], ['a', 1], ['nested', 1], ['b', 2], ['c', 0]])
    expect(isDescendant('b', 'one', items)).toBe(true)
  })
})

describe('storage and chart layout', () => {
  it('exports and restores a complete portable plan without losing groups or dependencies', () => {
    const original = createWorkspace().plans[0]
    const file = serializePlan(original)
    expect(JSON.parse(file)).toEqual({ format: 'threadline-plan', version: 1, plan: original })
    expect(parsePlanFile(file)).toEqual(original)
    expect(planFileStem('  My plan / launch!  ')).toBe('My-plan-launch')
    expect(planFileStem('???')).toBe('threadline-plan')

    const legacy = JSON.parse(file) as { format: string; version: number; plan: Plan }
    delete (legacy.plan.items[0] as Partial<Item>).confidence
    expect(parsePlanFile(JSON.stringify(legacy)).items[0].confidence).toBeNull()
  })

  it('rejects wrong formats, unsupported versions, and invalid imported schedules', () => {
    const original = createWorkspace().plans[0]
    const file = JSON.parse(serializePlan(original)) as { format: string; version: number; plan: Plan }
    expect(() => parsePlanFile('{bad')).toThrow('not valid JSON')
    expect(() => parsePlanFile(JSON.stringify({ ...file, format: 'other' }))).toThrow('not a Threadline plan')
    expect(() => parsePlanFile(JSON.stringify({ ...file, version: 2 }))).toThrow('unsupported version')
    expect(() => parsePlanFile(JSON.stringify({ ...file, plan: {} }))).toThrow('no valid plan')
    expect(() => parsePlanFile(JSON.stringify({ ...file, plan: { ...original, items: 'bad' } })))
      .toThrow('saved plan is invalid')
    expect(() => parsePlanFile(JSON.stringify({
      ...file,
      plan: { ...original, items: original.items.map((item) => item.kind === 'task'
        ? { ...item, dependencies: ['missing'] } : item) },
    }))).toThrow('missing item')
  })

  it('restores plans whose item IDs match inherited object property names', () => {
    const unusual = plan([
      task('__proto__', '2026-01-01', '2026-01-02'),
      task('toString', '2026-01-01', '2026-01-02', ['__proto__']),
    ])
    const restored = parsePlanFile(serializePlan(unusual))
    expect(schedulePlan(restored).toString).toEqual({ start: '2026-01-03', end: '2026-01-04' })
    expect(summarizePlan(restored, schedulePlan(restored)).calendarDays).toBe(3)
  })

  it('assigns confidence colors at the requested boundaries and rejects invalid percentages', () => {
    expect(confidenceLevel(null)).toBe('unrated')
    expect(confidenceLevel(0)).toBe('low')
    expect(confidenceLevel(69)).toBe('low')
    expect(confidenceLevel(70)).toBe('medium')
    expect(confidenceLevel(90)).toBe('medium')
    expect(confidenceLevel(91)).toBe('high')
    expect(confidenceLevel(100)).toBe('high')
    expect(() => confidenceLevel(-1)).toThrow('Confidence')
    expect(() => confidenceLevel(101)).toThrow('Confidence')
    expect(() => confidenceLevel(89.5)).toThrow('Confidence')
    expect(() => schedulePlan(plan([{ ...task('a', '2026-01-01', '2026-01-02'), confidence: 101 }]))).toThrow('Confidence')
  })

  it('round-trips a workspace and rejects corrupt saved data', () => {
    const workspace = createWorkspace()
    expect(parseWorkspace(JSON.stringify(workspace))).toEqual(workspace)
    const legacy = JSON.parse(JSON.stringify(workspace)) as Workspace
    for (const item of legacy.plans[0].items) delete (item as Partial<Item>).confidence
    expect(parseWorkspace(JSON.stringify(legacy)).plans[0].items.every((item) => item.confidence === null)).toBe(true)
    expect(() => parseWorkspace('{"version":2}')).toThrow('unsupported')
    expect(() => parseWorkspace(JSON.stringify({ ...workspace, activePlanId: 'missing' }))).toThrow('selected plan')
    expect(() => parseWorkspace(JSON.stringify({
      ...workspace,
      plans: [{ ...workspace.plans[0], items: [{ ...workspace.plans[0].items[0], dependencies: 'bad' }] }],
    }))).toThrow('Saved items')
    expect(() => parseWorkspace(JSON.stringify({
      ...workspace,
      plans: [{ ...workspace.plans[0], items: [{ ...workspace.plans[0].items[0], confidence: 101 }] }],
    }))).toThrow('Saved items')
  })

  it('keeps the resizable name column within the available chart width', () => {
    expect(clampLabelWidth(450, 600)).toBe(450)
    expect(clampLabelWidth(700, 500)).toBe(380)
    expect(clampLabelWidth(100, 280)).toBe(180)
    expect(clampLabelWidth(900, 1500)).toBe(900)
    expect(clampLabelWidth(1200, 1600)).toBe(1000)
  })

  it('positions all rows and dependency arrows on the full timeline', () => {
    const p = plan([
      group('g'),
      task('a', '2026-01-01', '2026-01-03', [], 'g'),
      task('b', '2026-01-01', '2026-01-02', ['g']),
    ])
    const spans = schedulePlan(p)
    const rows = flattenItems(p.items, false)
    const timeline = createTimeline(spans, 38)
    expect(timeline.days.length).toBeGreaterThan(20)
    expect(barGeometry(spans.b!, timeline).left).toBeGreaterThan(barGeometry(spans.a!, timeline).left)
    expect(dependencyLinks(rows, spans, timeline)).toHaveLength(1)
    expect(dependencyLinks(rows, spans, timeline)[0].y1).toBe(27)
  })

  it('routes multiple dependencies around every intervening task and group bar in either row direction', () => {
    const items = [
      group('g'),
      task('source', '2026-01-01', '2026-01-04', [], 'g'),
      task('blocker', '2026-01-03', '2026-01-09', [], 'g'),
      task('long', '2026-01-02', '2026-01-14'),
      task('late', '2026-01-13', '2026-01-16'),
      task('target', '2026-01-02', '2026-01-05', ['source', 'late', 'g']),
    ]
    for (const arranged of [items, [items[5], ...items.slice(0, 5)]]) {
      const p = plan(arranged)
      const spans = schedulePlan(p)
      const rows = flattenItems(p.items)
      const timeline = createTimeline(spans, 38)
      const links = dependencyLinks(rows, spans, timeline)
      expect(links).toHaveLength(3)
      expect(new Set(links.map((link) => link.y2)).size).toBe(3)
      for (const link of links) {
        expect(linkPath(link)).toContain(' Q ')
        expect(link.exitX - link.x1).toBe(18)
        expect(link.x2 - link.enterX).toBe(18)
        const points = linkPoints(link)
        expect(points[0]).toEqual({ x: link.x1, y: link.y1 })
        expect(points.at(-1)).toEqual({ x: link.x2, y: link.y2 })
        for (let index = 1; index < points.length; index++) {
          const from = points[index - 1]
          const to = points[index]
          expect(from.x === to.x || from.y === to.y).toBe(true)
          for (const [rowIndex, row] of rows.entries()) {
            const span = spans[row.item.id]
            if (!span) continue
            const bar = barGeometry(span, timeline)
            const top = (rowIndex + .5) * ROW_HEIGHT - (row.item.kind === 'group' ? 7 : 12)
            const bottom = (rowIndex + .5) * ROW_HEIGHT + (row.item.kind === 'group' ? 7 : 12)
            const overlap = from.x === to.x
              ? from.x >= bar.left && from.x <= bar.left + bar.width &&
                Math.max(Math.min(from.y, to.y), top) < Math.min(Math.max(from.y, to.y), bottom)
              : from.y >= top && from.y <= bottom &&
                Math.max(Math.min(from.x, to.x), bar.left) < Math.min(Math.max(from.x, to.x), bar.left + bar.width)
            expect(overlap, `${link.key} crosses ${row.item.id}`).toBe(false)
          }
        }
      }
    }
  })
})
