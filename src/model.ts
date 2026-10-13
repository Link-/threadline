export type ISODate = string

export type Item = {
  id: string
  name: string
  kind: 'task' | 'group'
  parentId: string | null
  start: ISODate
  end: ISODate
  dependencies: string[]
  collapsed: boolean
  confidence: number | null
}

export type Plan = {
  id: string
  name: string
  items: Item[]
}

export type Workspace = {
  version: 1
  activePlanId: string
  plans: Plan[]
}

export type Span = { start: ISODate; end: ISODate }
export type PlanSummary = {
  taskCount: number
  groupCount: number
  start: ISODate | null
  end: ISODate | null
  calendarDays: number | null
}
export type Row = { item: Item; depth: number }
export type DragMode = 'move' | 'start' | 'end'
export type BarAxis = 'pending' | 'horizontal' | 'vertical'
export type RowPlacement = 'before' | 'after' | 'inside' | 'end'
export type RowDrop = { anchorId: string | null; placement: RowPlacement }
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unrated'

const DAY_MS = 86_400_000

export function dateNumber(date: ISODate): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date: ${date}`)
  }
  const day = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid date: ${date}`)
  }
  return day / DAY_MS
}

export function addDays(date: ISODate, amount: number): ISODate {
  return new Date((dateNumber(date) + amount) * DAY_MS).toISOString().slice(0, 10)
}

export function daysBetween(start: ISODate, end: ISODate): number {
  return dateNumber(end) - dateNumber(start)
}

export function dragDates(span: Span, mode: DragMode, delta: number): Span {
  if (mode === 'move') return { start: addDays(span.start, delta), end: addDays(span.end, delta) }
  if (mode === 'start') {
    const start = addDays(span.start, delta)
    return { start: start > span.end ? span.end : start, end: span.end }
  }
  const end = addDays(span.end, delta)
  return { start: span.start, end: end < span.start ? span.start : end }
}

export function barDragAxis(kind: Item['kind'], dx: number, dy: number): BarAxis {
  if (kind === 'group') return Math.abs(dy) >= 9 ? 'vertical' : 'pending'
  if (Math.abs(dy) >= 9 && Math.abs(dy) >= Math.abs(dx)) return 'vertical'
  if (Math.abs(dx) >= 9 && Math.abs(dx) > Math.abs(dy)) return 'horizontal'
  return 'pending'
}

export function today(): ISODate {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function formatDate(date: ISODate, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}

export function confidenceLevel(value: number | null): ConfidenceLevel {
  if (value === null) return 'unrated'
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error('Confidence must be a whole number from 0 to 100.')
  }
  return value > 90 ? 'high' : value >= 70 ? 'medium' : 'low'
}

export function flattenItems(items: Item[], respectCollapsed = true): Row[] {
  const children = new Map<string | null, Item[]>()
  for (const item of items) {
    const siblings = children.get(item.parentId) ?? []
    siblings.push(item)
    children.set(item.parentId, siblings)
  }
  const rows: Row[] = []
  function visit(parentId: string | null, depth: number): void {
    for (const item of children.get(parentId) ?? []) {
      rows.push({ item, depth })
      if (!respectCollapsed || !item.collapsed) visit(item.id, depth + 1)
    }
  }
  visit(null, 0)
  return rows
}

export function isDescendant(itemId: string, ancestorId: string, items: Item[]): boolean {
  const byId = new Map(items.map((item) => [item.id, item]))
  let parent = byId.get(itemId)?.parentId
  while (parent) {
    if (parent === ancestorId) return true
    parent = byId.get(parent)?.parentId ?? null
  }
  return false
}

export function parseNewLine(text: string): { kind: Item['kind']; name: string } | null {
  const value = text.trim()
  if (!value || value === '#') return null
  if (value.startsWith('\\#')) return { kind: 'task', name: value.slice(1) }
  return value.startsWith('#')
    ? { kind: 'group', name: value.slice(1).trim() }
    : { kind: 'task', name: value }
}

export function rowDropIntent(
  items: Item[], targetId: string, depth: number, x: number, y: number, previous: RowDrop | null = null,
): RowDrop {
  const byId = new Map(items.map((item) => [item.id, item]))
  const target = byId.get(targetId)
  if (!target) throw new Error('The drop target no longer exists.')
  const wasInside = previous?.anchorId === targetId && previous.placement === 'inside'
  if (target.kind === 'group' &&
    x >= 50 + depth * 17 + (wasInside ? -6 : 6) &&
    y > (wasInside ? .15 : .2) && y < (wasInside ? .85 : .8)) {
    return { anchorId: targetId, placement: 'inside' }
  }
  let anchor = target
  let desiredDepth = Math.max(0, Math.min(depth, Math.round((x - 33) / 17)))
  if (previous?.anchorId && previous.placement !== 'inside') {
    let ancestor: Item | undefined = target
    let previousDepth = depth
    while (ancestor && ancestor.id !== previous.anchorId) {
      ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined
      previousDepth--
    }
    if (ancestor && previousDepth !== desiredDepth) {
      const step = Math.sign(desiredDepth - previousDepth)
      const threshold = 33 + (previousDepth + step * .5) * 17
      if ((step > 0 && x < threshold + 6) || (step < 0 && x > threshold - 6)) {
        desiredDepth = previousDepth
      }
    }
  }
  while (depth > desiredDepth) {
    anchor = byId.get(anchor.parentId!)!
    depth--
  }
  const placement = previous?.anchorId === anchor.id && previous.placement === 'before' && y < .58
    ? 'before'
    : previous?.anchorId === anchor.id && previous.placement === 'after' && y > .42
      ? 'after'
      : y < .5 ? 'before' : 'after'
  return { anchorId: anchor.id, placement }
}

export function adjacentSiblingDrop(rows: Row[], item: Item, direction: -1 | 1): RowDrop | null {
  const siblings = rows.filter((row) => row.item.parentId === item.parentId)
  const index = siblings.findIndex((row) => row.item.id === item.id)
  if (index < 0) throw new Error('The row to move is not visible.')
  const neighbor = siblings[index + direction]
  return neighbor
    ? { anchorId: neighbor.item.id, placement: direction < 0 ? 'before' : 'after' }
    : null
}

export function relocateItem(items: Item[], draggedId: string, drop: RowDrop): Item[] {
  const dragged = items.find((item) => item.id === draggedId)
  const anchor = drop.anchorId ? items.find((item) => item.id === drop.anchorId) : null
  if (!dragged || (drop.placement !== 'end' && !anchor)) throw new Error('The item to move could not be found.')
  if (drop.placement === 'inside' && anchor?.kind !== 'group') throw new Error('Only groups can contain other items.')
  if (anchor && (anchor.id === draggedId || isDescendant(anchor.id, draggedId, items))) {
    throw new Error('A group cannot be moved inside itself or its children.')
  }
  const parentId = drop.placement === 'end' ? null
    : drop.placement === 'inside' ? anchor!.id : anchor!.parentId
  const remaining = items.filter((item) => item.id !== draggedId).map((item) =>
    item.id === anchor?.id && drop.placement === 'inside' ? { ...item, collapsed: false } : item,
  )
  const index = drop.placement === 'end' ? remaining.length
    : remaining.findIndex((item) => item.id === anchor!.id) + (drop.placement === 'before' ? 0 : 1)
  remaining.splice(index, 0, { ...dragged, parentId })
  return remaining
}

export function schedulePlan(plan: Plan): Record<string, Span | null> {
  const items = plan.items
  const byId = new Map(items.map((item) => [item.id, item]))
  if (byId.size !== items.length) throw new Error('This plan contains duplicate item IDs.')

  for (const item of items) {
    confidenceLevel(item.confidence)
    if (item.parentId !== null) {
      const parent = byId.get(item.parentId)
      if (!parent || parent.kind !== 'group') throw new Error(`"${item.name}" has an invalid parent group.`)
      const seen = new Set([item.id])
      let current: Item | undefined = parent
      while (current) {
        if (seen.has(current.id)) throw new Error('Groups cannot be nested inside themselves.')
        seen.add(current.id)
        current = current.parentId ? byId.get(current.parentId) : undefined
      }
    }
    if (item.kind === 'task') {
      dateNumber(item.start)
      dateNumber(item.end)
      if (item.end < item.start) throw new Error(`"${item.name}" must end on or after its start date.`)
    } else if (item.dependencies.length) {
      throw new Error('Group dates are calculated from their children; only tasks can have dependencies.')
    }
  }

  const leaves = new Map<string, Item[]>()
  function descendants(groupId: string): Item[] {
    const cached = leaves.get(groupId)
    if (cached) return cached
    const result = items.flatMap((item) =>
      item.parentId === groupId
        ? item.kind === 'task' ? [item] : descendants(item.id)
        : [],
    )
    leaves.set(groupId, result)
    return result
  }

  const spans: Record<string, Span | null> = Object.create(null)
  const visiting = new Set<string>()
  function schedule(task: Item): Span {
    const existing = spans[task.id]
    if (existing) return existing
    if (visiting.has(task.id)) throw new Error(`Dependency cycle involving "${task.name}". Remove one of the links.`)
    visiting.add(task.id)
    let start = task.start
    for (const dependencyId of task.dependencies) {
      const predecessor = byId.get(dependencyId)
      if (!predecessor) throw new Error(`"${task.name}" depends on a missing item.`)
      const predecessors = predecessor.kind === 'task' ? [predecessor] : descendants(predecessor.id)
      if (!predecessors.length) throw new Error(`"${predecessor.name}" needs a task before it can be a dependency.`)
      for (const leaf of predecessors) {
        const earliest = addDays(schedule(leaf).end, 1)
        if (earliest > start) start = earliest
      }
    }
    visiting.delete(task.id)
    const span = { start, end: addDays(start, daysBetween(task.start, task.end)) }
    spans[task.id] = span
    return span
  }

  for (const item of items) if (item.kind === 'task') schedule(item)
  for (const item of items) {
    if (item.kind !== 'group') continue
    const childSpans = descendants(item.id).map((child) => spans[child.id]).filter((span): span is Span => span !== null)
    spans[item.id] = childSpans.length
      ? {
          start: childSpans.reduce((min, span) => span.start < min ? span.start : min, childSpans[0].start),
          end: childSpans.reduce((max, span) => span.end > max ? span.end : max, childSpans[0].end),
        }
      : null
  }
  return spans
}

export function summarizePlan(plan: Plan, spans: Record<string, Span | null>): PlanSummary {
  const taskCount = plan.items.filter((item) => item.kind === 'task').length
  const datedSpans = Object.values(spans).filter((span): span is Span => span !== null)
  const start = datedSpans.length
    ? datedSpans.reduce((first, span) => span.start < first ? span.start : first, datedSpans[0].start)
    : null
  const end = datedSpans.length
    ? datedSpans.reduce((last, span) => span.end > last ? span.end : last, datedSpans[0].end)
    : null
  return {
    taskCount,
    groupCount: plan.items.length - taskCount,
    start,
    end,
    calendarDays: start && end ? daysBetween(start, end) : null,
  }
}

export function makeItem(kind: Item['kind'], parentId: string | null = null, start = today()): Item {
  return {
    id: crypto.randomUUID(),
    name: kind === 'group' ? 'New group' : 'New task',
    kind,
    parentId,
    start,
    end: addDays(start, 3),
    dependencies: [],
    collapsed: false,
    confidence: null,
  }
}

export function createWorkspace(): Workspace {
  const start = today()
  const discovery = { ...makeItem('group', null, start), name: 'Discovery', confidence: 95 }
  const delivery = { ...makeItem('group', null, start), name: 'Delivery', confidence: 80 }
  const brief = { ...makeItem('task', discovery.id, start), name: 'Project brief', end: addDays(start, 2), confidence: 95 }
  const research = { ...makeItem('task', discovery.id, start), name: 'Research & scope', dependencies: [brief.id], confidence: 75 }
  const design = { ...makeItem('task', delivery.id, start), name: 'Design direction', dependencies: [research.id], end: addDays(start, 4), confidence: 84 }
  const build = { ...makeItem('task', delivery.id, start), name: 'Build & review', dependencies: [design.id], end: addDays(start, 6), confidence: 65 }
  const launch = { ...makeItem('task', null, start), name: 'Launch', dependencies: [build.id], end: start, confidence: 95 }
  const plan = { id: crypto.randomUUID(), name: 'My first plan', items: [discovery, brief, research, delivery, design, build, launch] }
  return { version: 1, activePlanId: plan.id, plans: [plan] }
}

export const STORAGE_KEY = 'threadline-workspace-v1'
export const LEGACY_STORAGE_KEY = 'daymark-workspace-v1'
const PLAN_FILE_FORMAT = 'threadline-plan'

export function planFileStem(name: string): string {
  return name.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'threadline-plan'
}

export function parseWorkspace(raw: string): Workspace {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null) throw new Error('Saved plans have an invalid format.')
  const data = value as Partial<Workspace>
  if (data.version !== 1 || !Array.isArray(data.plans) || !data.plans.length || typeof data.activePlanId !== 'string') {
    throw new Error('Saved plans have an unsupported or invalid format.')
  }
  for (const plan of data.plans) {
    if (!plan || typeof plan.id !== 'string' || typeof plan.name !== 'string' || !Array.isArray(plan.items)) {
      throw new Error('A saved plan is invalid.')
    }
    for (const item of plan.items) {
      if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' ||
        (item.kind !== 'task' && item.kind !== 'group') ||
        (item.parentId !== null && typeof item.parentId !== 'string') ||
        typeof item.start !== 'string' || typeof item.end !== 'string' ||
        !Array.isArray(item.dependencies) || item.dependencies.some((id) => typeof id !== 'string') ||
        typeof item.collapsed !== 'boolean' ||
        (item.confidence !== undefined && item.confidence !== null &&
          (typeof item.confidence !== 'number' || !Number.isInteger(item.confidence) ||
            item.confidence < 0 || item.confidence > 100))) {
        throw new Error(`Saved items in "${plan.name}" are invalid.`)
      }
    }
    schedulePlan({ ...plan, items: plan.items.map((item) => ({ ...item, confidence: item.confidence ?? null })) })
  }
  if (!data.plans.some((plan) => plan.id === data.activePlanId)) throw new Error('The selected plan could not be found.')
  return {
    version: 1,
    activePlanId: data.activePlanId,
    plans: data.plans.map((plan) => ({
      ...plan,
      items: plan.items.map((item) => ({ ...item, confidence: item.confidence ?? null })),
    })),
  }
}

export function serializePlan(plan: Plan): string {
  schedulePlan(plan)
  return `${JSON.stringify({ format: PLAN_FILE_FORMAT, version: 1, plan }, null, 2)}\n`
}

export function parsePlanFile(raw: string): Plan {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('The plan content is not valid JSON.')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('This is not a Threadline plan.')
  }
  const file = value as { format?: unknown; version?: unknown; plan?: unknown }
  if (file.format !== PLAN_FILE_FORMAT) throw new Error('This is not a Threadline plan.')
  if (file.version !== 1) throw new Error('This Threadline plan uses an unsupported version.')
  const imported = file.plan
  if (typeof imported !== 'object' || imported === null || Array.isArray(imported) ||
    !('id' in imported) || typeof imported.id !== 'string') {
    throw new Error('This Threadline plan has no valid plan.')
  }
  return parseWorkspace(JSON.stringify({ version: 1, activePlanId: imported.id, plans: [imported] })).plans[0]
}
