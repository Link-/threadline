import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  addDays, adjacentSiblingDrop, barDragAxis, confidenceLevel, createWorkspace, dateNumber, daysBetween, displayItemName, dragDates, flattenItems, formatDate,
  IMPORTANCE_LABELS, IMPORTANCE_OPTIONS, isDescendant, makeItem, parseImportance, parseNewLine, parsePlanFile,
  parseItemLink, parseWorkspace, planFileStem, relocateItem, rowDropIntent, LEGACY_STORAGE_KEY, schedulePlan, serializePlan,
  STORAGE_KEY, summarizePlan, today,
} from './model'
import type { BarAxis, DragMode, Importance, Item, Plan, Row, RowDrop, Span, Workspace } from './model'
import {
  barGeometry, clampLabelWidth, createTimeline, dependencyLinks, downloadFile, exportPng, HEADER_HEIGHT,
  itemDateLabel, LABEL_WIDTH, linkPath, MIN_LABEL_WIDTH, MAX_LABEL_WIDTH, ROW_HEIGHT,
} from './chart'
import { AGENT_IMPORT_PROMPT } from './agentPrompt'
import { Icon } from './Icons'

type Drag = {
  itemId: string
  kind: Item['kind']
  pointerId: number
  x: number
  y: number
  delta: number
  mode: DragMode
  axis: BarAxis
  span: Span
}
type RowDrag = {
  itemId: string
  source: 'label' | 'bar'
  planId: string
  pointerId: number
  x: number
  y: number
  lastX: number
  lastY: number
  active: boolean
  targetId: string | null
  items: Item[]
  rows: Row[]
  forbidden: Set<string>
}
type LabelResize = { planId: string; pointerId: number; x: number; width: number }
const LINK_CLICK_DELAY_MS = 500

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function confidenceText(item: Item): string {
  return item.confidence === null ? 'Confidence not set' : `Confidence ${item.confidence}%`
}

function importanceClass(value: Importance): string {
  return `importance-${value.replace(' ', '-')}`
}

function importanceText(item: Item): string {
  return item.importance === null ? '' : `, importance ${IMPORTANCE_LABELS[item.importance]}`
}

function sameDrop(a: RowDrop | null, b: RowDrop | null): boolean {
  return a?.anchorId === b?.anchorId && a?.placement === b?.placement
}

function loadInitial(): { workspace: Workspace; loadError: string | null } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    return { workspace: saved === null ? createWorkspace() : parseWorkspace(saved), loadError: null }
  } catch (error) {
    return { workspace: createWorkspace(), loadError: message(error) }
  }
}

function monthSegments(days: string[], dayWidth: number) {
  const segments: { label: string; width: number }[] = []
  for (const day of days) {
    const label = formatDate(day, { month: 'long', year: 'numeric' })
    const last = segments[segments.length - 1]
    if (last?.label === label) last.width += dayWidth
    else segments.push({ label, width: dayWidth })
  }
  return segments
}

export default function App() {
  const [initial] = useState(loadInitial)
  const [workspace, setWorkspace] = useState(initial.workspace)
  const [loadError, setLoadError] = useState(initial.loadError)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [planMenu, setPlanMenu] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importMethod, setImportMethod] = useState<'file' | 'paste'>('file')
  const [pastedPlan, setPastedPlan] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [promptCopied, setPromptCopied] = useState(false)
  const [dayWidth, setDayWidth] = useState(38)
  const [labelWidth, setLabelWidth] = useState(() =>
    initial.workspace.plans.find((entry) => entry.id === initial.workspace.activePlanId)?.labelWidth ?? LABEL_WIDTH)
  const [exporting, setExporting] = useState(false)
  const [draft, setDraft] = useState('')
  const [durationDraft, setDurationDraft] = useState<{ itemId: string; value: string } | null>(null)
  const [draggingBarId, setDraggingBarId] = useState<string | null>(null)
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<RowDrop | null>(null)
  const [contextMenu, setContextMenu] = useState<{ itemId: string; x: number; y: number } | null>(null)
  const [hovered, setHovered] = useState<{ itemId: string; left: number; top: number; above: boolean } | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const boardBodyRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const importButtonRef = useRef<HTMLButtonElement>(null)
  const importChooseRef = useRef<HTMLButtonElement>(null)
  const importDialogRef = useRef<HTMLDialogElement>(null)
  const detailPanelRef = useRef<HTMLElement>(null)
  const linkClickRef = useRef<number | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const suppressBarClickRef = useRef<string | null>(null)
  const rowDragRef = useRef<RowDrag | null>(null)
  const rowPreviewRef = useRef<HTMLDivElement>(null)
  const rowFrameRef = useRef<number | null>(null)
  const labelResizeRef = useRef<LabelResize | null>(null)
  const dropRef = useRef<RowDrop | null>(null)
  const workspaceRef = useRef(workspace)

  const plan = workspace.plans.find((entry) => entry.id === workspace.activePlanId)!
  const spans = useMemo(() => schedulePlan(plan), [plan])
  const rows = useMemo(() => flattenItems(plan.items), [plan.items])
  const allRows = useMemo(() => flattenItems(plan.items, false), [plan.items])
  const timeline = useMemo(() => createTimeline(spans, dayWidth), [spans, dayWidth])
  const months = useMemo(() => monthSegments(timeline.days, dayWidth), [timeline.days, dayWidth])
  const links = useMemo(() => dependencyLinks(rows, spans, timeline), [rows, spans, timeline])
  const selected = plan.items.find((item) => item.id === selectedId) ?? null
  const hoveredItem = plan.items.find((item) => item.id === hovered?.itemId)
  const hoveredSpan = hoveredItem ? spans[hoveredItem.id] : null
  const summary = useMemo(() => summarizePlan(plan, spans), [plan, spans])
  const chartStyle = { '--label-width': `${labelWidth}px`, '--row-height': `${ROW_HEIGHT}px` } as CSSProperties
  const plansVisible = sidebarOpen || mobileNav

  useEffect(() => {
    if (loadError) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace))
    } catch (storageError) {
      setError(`Could not save to browser storage: ${message(storageError)}`)
    }
  }, [workspace, loadError])

  useEffect(() => {
    const dialog = importDialogRef.current
    if (!dialog) return
    if (importOpen && !dialog.open) {
      dialog.showModal()
      importChooseRef.current?.focus()
    } else if (!importOpen && dialog.open) dialog.close()
  }, [importOpen])

  useEffect(() => {
    if (importError) importDialogRef.current?.scrollTo({ top: 0 })
  }, [importError])

  useEffect(() => {
    function onFullscreenChange() {
      if (!document.fullscreenElement) setExpanded(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setExpanded(false)
        setMobileNav(false)
        setContextMenu(null)
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    function dismiss(event: PointerEvent) {
      if (!(event.target instanceof Element && event.target.closest('.row-context-menu'))) setContextMenu(null)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [contextMenu])

  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const scheduled = Object.values(spans).filter((span): span is Span => span !== null)
    if (!scheduled.length) {
      board.scrollLeft = 0
      return
    }
    const first = scheduled.reduce((min, span) => span.start < min ? span.start : min, scheduled[0].start)
    const trackViewport = Math.max(0, board.clientWidth - labelWidth)
    board.scrollLeft = Math.max(0, daysBetween(timeline.start, first) * dayWidth - trackViewport * .22)
    // Reposition only when switching plans, not when a dragged task changes the timeline.
  }, [plan.id])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const observer = new ResizeObserver(() => {
      if (labelResizeRef.current === null) {
        setLabelWidth(clampLabelWidth(plan.labelWidth ?? LABEL_WIDTH, chart.clientWidth))
      }
    })
    observer.observe(chart)
    return () => observer.disconnect()
  }, [loadError, plan.id, plan.labelWidth])

  useEffect(() => () => {
    if (rowFrameRef.current !== null) window.cancelAnimationFrame(rowFrameRef.current)
    if (linkClickRef.current !== null) window.clearTimeout(linkClickRef.current)
  }, [])

  useLayoutEffect(() => {
    const drag = rowDragRef.current
    if (drag?.active && draggingRowId) positionRowPreview(drag)
  }, [draggingRowId])

  function applyWorkspace(next: Workspace) {
    if (next.activePlanId !== workspaceRef.current.activePlanId) {
      labelResizeRef.current = null
      const active = next.plans.find((entry) => entry.id === next.activePlanId)!
      setLabelWidth(clampLabelWidth(active.labelWidth ?? LABEL_WIDTH, chartRef.current?.clientWidth ?? window.innerWidth))
    }
    workspaceRef.current = next
    setWorkspace(next)
    setError(null)
  }

  function saveLabelWidth(width: number) {
    if (plan.labelWidth !== width) updatePlan((current) => ({ ...current, labelWidth: width }))
  }

  function updatePlan(change: (current: Plan) => Plan): boolean {
    const current = workspaceRef.current
    const active = current.plans.find((entry) => entry.id === current.activePlanId)!
    try {
      const nextPlan = change(active)
      schedulePlan(nextPlan)
      applyWorkspace({
        ...current,
        plans: current.plans.map((entry) => entry.id === active.id ? nextPlan : entry),
      })
      return true
    } catch (updateError) {
      setError(message(updateError))
      return false
    }
  }

  function updateItem(id: string, changes: Partial<Item>): boolean {
    return updatePlan((current) => ({
      ...current,
      items: current.items.map((item) => item.id === id ? { ...item, ...changes } : item),
    }))
  }

  function cancelPendingLink() {
    if (linkClickRef.current !== null) window.clearTimeout(linkClickRef.current)
    linkClickRef.current = null
  }

  async function editRowName(item: Item) {
    cancelPendingLink()
    if (expanded) await toggleExpanded()
    setHovered(null)
    setSelectedId(item.id)
    setEditingId(item.id)
    window.requestAnimationFrame(() => {
      const input = boardBodyRef.current?.querySelector<HTMLInputElement>(`[data-row-id="${item.id}"] .row-title-input`)
      input?.focus({ preventScroll: true })
      input?.select()
    })
  }

  function clickLinkedName(event: ReactMouseEvent<HTMLAnchorElement>, href: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.detail === 0) return
    event.preventDefault()
    cancelPendingLink()
    if (event.detail > 1) return
    linkClickRef.current = window.setTimeout(() => {
      linkClickRef.current = null
      const opened = window.open('about:blank', '_blank')
      if (!opened) {
        setError('Your browser blocked the new window. Allow pop-ups for Threadline or use ⌘/Ctrl-click.')
        return
      }
      try {
        opened.opener = null
        opened.location.replace(href)
      } catch (openError) {
        opened.close()
        setError(`Could not open link: ${message(openError)}`)
      }
    }, LINK_CLICK_DELAY_MS)
  }

  async function editRowProperty(item: Item, field: 'importance' | 'confidence' | 'duration') {
    if (expanded) await toggleExpanded()
    setHovered(null)
    setSelectedId(item.id)
    window.requestAnimationFrame(() => {
      const panel = detailPanelRef.current
      if (panel?.dataset.itemId === item.id) panel.querySelector<HTMLElement>(`#item-${field}`)?.focus()
    })
  }

  function commitDraft() {
    const parsed = parseNewLine(draft)
    if (!parsed) {
      if (draft.trim()) setError('Write a group name after #.')
      return
    }
    const firstDate = plan.items.length
      ? Object.values(spans).find((span) => span !== null)?.start ?? today()
      : today()
    const item = { ...makeItem(parsed.kind, null, firstDate), name: parsed.name }
    if (updatePlan((current) => ({ ...current, items: [...current.items, item] }))) {
      setDraft('')
      window.requestAnimationFrame(() => {
        composerRef.current?.focus()
        if (boardRef.current) boardRef.current.scrollTop = boardRef.current.scrollHeight
      })
    }
  }

  function addTaskBelow(item: Item) {
    const next = makeItem('task', item.kind === 'group' ? item.id : item.parentId, spans[item.id]?.start ?? item.start)
    if (!updatePlan((current) => {
      const index = current.items.findIndex((entry) => entry.id === item.id)
      if (index < 0) throw new Error('The task to add after could not be found.')
      return {
        ...current,
        items: [
          ...current.items.slice(0, index),
          item.kind === 'group' ? { ...current.items[index], collapsed: false } : current.items[index],
          next,
          ...current.items.slice(index + 1),
        ],
      }
    })) return
    setEditingId(next.id)
    window.requestAnimationFrame(() => {
      const input = boardBodyRef.current?.querySelector<HTMLInputElement>(`[data-row-id="${next.id}"] .row-title-input`)
      input?.focus({ preventScroll: true })
      input?.select()
      input?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  }

  function changePlan(id: string) {
    applyWorkspace({ ...workspaceRef.current, activePlanId: id })
    setSelectedId(null)
    setEditingId(null)
    setMobileNav(false)
    setPlanMenu(false)
    setDraft('')
    setContextMenu(null)
    setHovered(null)
  }

  function addPlan() {
    const current = workspaceRef.current
    const newPlan: Plan = { id: crypto.randomUUID(), name: `Untitled plan ${current.plans.length + 1}`, items: [] }
    applyWorkspace({ ...current, activePlanId: newPlan.id, plans: [...current.plans, newPlan] })
    setSelectedId(null)
    setEditingId(null)
    setMobileNav(false)
    setDraft('')
  }

  function deletePlan() {
    if (!window.confirm(`Delete "${plan.name}" and all its tasks? This cannot be undone.`)) return
    const current = workspaceRef.current
    const remaining = current.plans.filter((entry) => entry.id !== plan.id)
    if (!remaining.length) {
      const fresh: Plan = { id: crypto.randomUUID(), name: 'Untitled plan', items: [] }
      remaining.push(fresh)
    }
    applyWorkspace({ ...current, plans: remaining, activePlanId: remaining[0].id })
    setSelectedId(null)
    setEditingId(null)
    setPlanMenu(false)
    setDraft('')
  }

  function deleteItem(item: Item) {
    const keepChildren = item.kind === 'group'
    const prompt = keepChildren
      ? `Delete "${item.name || 'this group'}"? Its children will stay in the plan.`
      : `Delete "${item.name || 'this task'}"? Dependencies on it will be removed.`
    if (!window.confirm(prompt)) return
    const removed = updatePlan((current) => {
      const descendants = current.items
        .filter((entry) => entry.kind === 'task' && isDescendant(entry.id, item.id, current.items))
        .map((entry) => entry.id)
      return {
        ...current,
        items: current.items
          .filter((entry) => entry.id !== item.id)
          .map((entry) => ({
            ...entry,
            parentId: entry.parentId === item.id ? item.parentId : entry.parentId,
            dependencies: [...new Set(entry.dependencies.flatMap((id) =>
              id === item.id ? (keepChildren ? descendants : []) : [id],
            ))],
          })),
      }
    })
    if (removed) {
      setSelectedId(null)
      if (editingId === item.id) setEditingId(null)
    }
    setContextMenu(null)
  }

  function placeRow(itemId: string, drop: RowDrop): boolean {
    return updatePlan((current) => ({
      ...current,
      items: relocateItem(current.items, itemId, drop),
    }))
  }

  function moveRowInList(item: Item, direction: -1 | 1, input?: HTMLInputElement) {
    const drop = adjacentSiblingDrop(rows, item, direction)
    if (!drop) return
    const start = input?.selectionStart
    const end = input?.selectionEnd
    if (placeRow(item.id, drop) && input) {
      window.requestAnimationFrame(() => {
        if (!input.isConnected) return
        input.focus({ preventScroll: true })
        if (start !== undefined && end !== undefined && start !== null && end !== null) {
          input.setSelectionRange(start, end)
        }
        const board = boardRef.current
        const row = input.closest('.board-row')
        if (!board || !row) return
        const visible = board.getBoundingClientRect()
        const position = row.getBoundingClientRect()
        if (position.top < visible.top + HEADER_HEIGHT) board.scrollTop -= visible.top + HEADER_HEIGHT - position.top
        else if (position.bottom > visible.bottom) board.scrollTop += position.bottom - visible.bottom
      })
    }
  }

  function prepareRowDrag(event: ReactPointerEvent<HTMLElement>, item: Item, source: RowDrag['source']) {
    const byId = new Map(plan.items.map((entry) => [entry.id, entry]))
    const forbidden = new Set([item.id])
    for (const entry of plan.items) {
      let ancestor = entry.parentId
      while (ancestor) {
        if (ancestor === item.id) {
          forbidden.add(entry.id)
          break
        }
        ancestor = byId.get(ancestor)?.parentId ?? null
      }
    }
    rowDragRef.current = {
      itemId: item.id, source, planId: plan.id, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY,
      active: false, targetId: null, items: plan.items, rows, forbidden,
    }
    setHovered(null)
    setContextMenu(null)
  }

  function startRowDrag(event: ReactPointerEvent<HTMLSpanElement>, item: Item) {
    if (event.button !== 0 || rowDragRef.current || dragRef.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    prepareRowDrag(event, item, 'label')
  }

  function updateRowDrop(x: number, y: number) {
    const drag = rowDragRef.current
    const board = boardRef.current
    const body = boardBodyRef.current
    if (!drag || !board || !body) return
    const bounds = board.getBoundingClientRect()
    let drop: RowDrop | null = null
    let targetId: string | null = null
    if (x >= bounds.left && x <= (drag.source === 'bar' ? bounds.right : bounds.left + labelWidth) &&
      y >= bounds.top + HEADER_HEIGHT && y <= bounds.bottom) {
      const offset = y - body.getBoundingClientRect().top
      const index = Math.floor(offset / ROW_HEIGHT)
      if (index >= 0 && index < drag.rows.length) {
        const target = drag.rows[index]
        targetId = target.item.id
        const intentX = drag.source === 'bar'
          ? (target.item.kind === 'group' ? 70 : 33) + target.depth * 17
          : x - bounds.left
        const candidate = rowDropIntent(
          drag.items, targetId, target.depth, intentX, offset / ROW_HEIGHT - index,
          drag.targetId === targetId ? dropRef.current : null,
        )
        if (!candidate.anchorId || !drag.forbidden.has(candidate.anchorId)) drop = candidate
      } else if (index === drag.rows.length) {
        drop = { anchorId: null, placement: 'end' }
      }
    }
    drag.targetId = targetId
    if (!sameDrop(dropRef.current, drop)) {
      dropRef.current = drop
      setDropTarget(drop)
    }
  }

  function scheduleRowDragFrame() {
    if (rowFrameRef.current !== null) return
    rowFrameRef.current = window.requestAnimationFrame(() => {
      rowFrameRef.current = null
      const drag = rowDragRef.current
      if (!drag?.active) return
      positionRowPreview(drag)
      const board = boardRef.current
      let scrolling = false
      if (board) {
        const bounds = board.getBoundingClientRect()
        const top = bounds.top + HEADER_HEIGHT + 32
        const bottom = bounds.bottom - 32
        const speed = drag.lastY < top && drag.lastY >= bounds.top
          ? -Math.min(12, Math.ceil((top - drag.lastY) / 3))
          : drag.lastY > bottom && drag.lastY <= bounds.bottom
            ? Math.min(12, Math.ceil((drag.lastY - bottom) / 3))
            : 0
        if (speed) {
          const before = board.scrollTop
          board.scrollTop += speed
          scrolling = board.scrollTop !== before
        }
      }
      updateRowDrop(drag.lastX, drag.lastY)
      if (scrolling) scheduleRowDragFrame()
    })
  }

  function positionRowPreview(drag: RowDrag) {
    const preview = rowPreviewRef.current
    if (!preview) return
    const x = Math.max(8, Math.min(drag.lastX + 15, window.innerWidth - preview.offsetWidth - 8))
    const y = Math.max(8, Math.min(drag.lastY - 18, window.innerHeight - preview.offsetHeight - 8))
    preview.style.transform = `translate3d(${x}px, ${y}px, 0)`
    preview.style.visibility = 'visible'
  }

  function moveRowDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    const drag = rowDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return
    event.preventDefault()
    drag.lastX = event.clientX
    drag.lastY = event.clientY
    if (!drag.active) {
      drag.active = true
      setDraggingRowId(drag.itemId)
    }
    scheduleRowDragFrame()
  }

  function clearRowDrag() {
    if (rowFrameRef.current !== null) window.cancelAnimationFrame(rowFrameRef.current)
    rowFrameRef.current = null
    rowDragRef.current = null
    dropRef.current = null
    setDraggingRowId(null)
    setDropTarget(null)
  }

  function endRowDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = rowDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.active && drag.planId === workspaceRef.current.activePlanId) {
      updateRowDrop(event.clientX, event.clientY)
      if (dropRef.current) placeRow(drag.itemId, dropRef.current)
    }
    clearRowDrag()
  }

  function cancelRowDrag(event: ReactPointerEvent<HTMLElement>) {
    if (rowDragRef.current?.pointerId !== event.pointerId) return
    clearRowDrag()
  }

  function rowGripKeyDown(event: ReactKeyboardEvent<HTMLSpanElement>, item: Item) {
    let drop: RowDrop | null = null
    if (event.key === 'ArrowLeft' && item.parentId) {
      drop = { anchorId: item.parentId, placement: 'after' }
    } else if (event.key === 'ArrowRight') {
      const index = rows.findIndex((row) => row.item.id === item.id)
      const precedingGroup = rows.slice(0, index).reverse().find((row) =>
        row.item.kind === 'group' && !isDescendant(row.item.id, item.id, plan.items),
      )
      if (precedingGroup) drop = { anchorId: precedingGroup.item.id, placement: 'inside' }
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      drop = adjacentSiblingDrop(rows, item, event.key === 'ArrowUp' ? -1 : 1)
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      deleteItem(item)
      return
    }
    if (!drop) return
    event.preventDefault()
    placeRow(item.id, drop)
  }

  function toggleDependency(item: Item, id: string) {
    const dependencies = item.dependencies.includes(id)
      ? item.dependencies.filter((entry) => entry !== id)
      : [...item.dependencies, id]
    updateItem(item.id, { dependencies })
  }

  function canDependOn(item: Item, candidateId: string): boolean {
    if (item.dependencies.includes(candidateId)) return true
    try {
      schedulePlan({
        ...plan,
        items: plan.items.map((entry) => entry.id === item.id
          ? { ...entry, dependencies: [...entry.dependencies, candidateId] }
          : entry),
      })
      return true
    } catch {
      return false
    }
  }

  function changeDate(item: Item, field: 'start' | 'end', value: string) {
    if (!value) return
    try {
      dateNumber(value)
    } catch (dateError) {
      setError(message(dateError))
      return
    }
    if (field === 'start') {
      updateItem(item.id, { start: value, end: item.end < value ? value : item.end })
    } else {
      updateItem(item.id, { end: value, start: item.start > value ? value : item.start })
    }
  }

  function changeDuration(item: Item, value: string) {
    setDurationDraft({ itemId: item.id, value })
    if (!value) return
    const days = Number(value)
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(days)) {
      setError('Duration must be a non-negative whole number of days.')
      return
    }
    try {
      const end = addDays(item.start, days)
      dateNumber(end)
      updateItem(item.id, { end })
    } catch (durationError) {
      setError(message(durationError))
    }
  }

  function applyDrag(drag: Drag, delta: number) {
    updateItem(drag.itemId, dragDates(drag.span, drag.mode, delta))
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>, item: Item, mode: DragMode) {
    if (event.button !== 0 || dragRef.current || rowDragRef.current) return
    const span = spans[item.id]
    if (!span) return
    event.stopPropagation()
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    suppressBarClickRef.current = null
    dragRef.current = {
      itemId: item.id, kind: item.kind, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, delta: 0, mode,
      axis: mode === 'move' ? 'pending' : 'horizontal', span,
    }
    setDraggingBarId(item.id)
    if (mode === 'move') prepareRowDrag(event, item, 'bar')
    setHovered(null)
  }

  function showHover(event: ReactPointerEvent<HTMLElement>, item: Item) {
    if (event.pointerType === 'touch' || rowDragRef.current?.active) return
    const box = event.currentTarget.getBoundingClientRect()
    const width = Math.min(320, window.innerWidth - 16)
    const above = box.top > 160
    setHovered({
      itemId: item.id,
      left: Math.max(8, Math.min(event.clientX - width / 2, window.innerWidth - width - 8)),
      top: above ? box.top - 9 : box.bottom + 9,
      above,
    })
  }

  function startLabelResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    labelResizeRef.current = { planId: plan.id, pointerId: event.pointerId, x: event.clientX, width: labelWidth }
    setHovered(null)
  }

  function moveLabelResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = labelResizeRef.current
    if (resize?.pointerId !== event.pointerId || resize.planId !== plan.id) return
    setLabelWidth(clampLabelWidth(resize.width + event.clientX - resize.x, chartRef.current?.clientWidth ?? window.innerWidth))
  }

  function endLabelResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = labelResizeRef.current
    if (resize?.pointerId !== event.pointerId || resize.planId !== plan.id) return
    labelResizeRef.current = null
    if (event.type === 'pointercancel') {
      setLabelWidth(clampLabelWidth(plan.labelWidth ?? LABEL_WIDTH, chartRef.current?.clientWidth ?? window.innerWidth))
      return
    }
    const width = clampLabelWidth(resize.width + event.clientX - resize.x, chartRef.current?.clientWidth ?? window.innerWidth)
    setLabelWidth(width)
    saveLabelWidth(width)
  }

  function labelResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const width = clampLabelWidth(
      labelWidth + (event.key === 'ArrowRight' ? 24 : -24),
      chartRef.current?.clientWidth ?? window.innerWidth,
    )
    setLabelWidth(width)
    saveLabelWidth(width)
  }

  function dragMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.axis === 'pending') {
      drag.axis = barDragAxis(drag.kind, event.clientX - drag.x, event.clientY - drag.y)
      if (drag.axis === 'horizontal') rowDragRef.current = null
    }
    if (drag.axis === 'vertical') {
      const rowDrag = rowDragRef.current
      if (!rowDrag) return
      event.preventDefault()
      rowDrag.lastX = event.clientX
      rowDrag.lastY = event.clientY
      if (!rowDrag.active) {
        rowDrag.active = true
        setDraggingRowId(drag.itemId)
      }
      scheduleRowDragFrame()
      return
    }
    if (drag.axis !== 'horizontal') return
    const delta = Math.round((event.clientX - drag.x) / dayWidth)
    if (delta === drag.delta) return
    drag.delta = delta
    applyDrag(drag, delta)
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.axis === 'vertical') endRowDrag(event)
    else {
      if (rowDragRef.current?.pointerId === event.pointerId) clearRowDrag()
      setHovered(null)
      setSelectedId(drag.itemId)
    }
    if (drag.axis !== 'pending') suppressBarClickRef.current = drag.itemId
    dragRef.current = null
    setDraggingBarId(null)
  }

  function cancelBarDrag(event: ReactPointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setDraggingBarId(null)
    if (rowDragRef.current?.pointerId === event.pointerId) clearRowDrag()
  }

  function selectBar(event: ReactMouseEvent<HTMLElement>, item: Item) {
    if (suppressBarClickRef.current === item.id && event.detail > 0) {
      event.preventDefault()
      suppressBarClickRef.current = null
      return
    }
    setHovered(null)
    setSelectedId(item.id)
  }

  function barKeyDown(event: ReactKeyboardEvent<HTMLElement>, item: Item) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      moveRowInList(item, event.key === 'ArrowUp' ? -1 : 1)
      return
    }
    if (item.kind !== 'task') return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setSelectedId(item.id)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const span = spans[item.id]
    if (!span) return
    applyDrag({
      itemId: item.id, kind: item.kind, pointerId: -1, x: 0, y: 0, delta: 0,
      mode: event.shiftKey ? 'end' : 'move', axis: 'horizontal', span,
    }, event.key === 'ArrowRight' ? 1 : -1)
  }

  async function toggleExpanded() {
    if (expanded) {
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen()
        } catch (fullscreenError) {
          setError(`Could not exit browser full screen: ${message(fullscreenError)}`)
        }
      }
      setExpanded(false)
      return
    }
    setExpanded(true)
    try {
      await chartRef.current?.requestFullscreen()
    } catch {
      // The fixed-position expanded view still works when browser full screen is unavailable.
    }
  }

  async function downloadChart() {
    setExporting(true)
    try {
      await exportPng(plan, allRows, spans, timeline, labelWidth)
      setError(null)
    } catch (exportError) {
      setError(message(exportError))
    } finally {
      setExporting(false)
    }
  }

  function savePlanFile() {
    try {
      const contents = serializePlan(plan)
      downloadFile(new Blob([contents], { type: 'application/json' }), `${planFileStem(plan.name)}.threadline.json`)
      setError(null)
    } catch (saveError) {
      setError(`Could not save plan file: ${message(saveError)}`)
    }
  }

  function closeImport() {
    setImportOpen(false)
    setImportMethod('file')
    setPastedPlan('')
    setImportError(null)
    setPromptCopied(false)
    window.requestAnimationFrame(() => importButtonRef.current?.focus())
  }

  async function copyAgentPrompt() {
    if (!navigator.clipboard?.writeText) {
      setPromptCopied(false)
      setImportError('Clipboard access is unavailable. Select the instructions below to copy them manually.')
      return
    }
    try {
      await navigator.clipboard.writeText(AGENT_IMPORT_PROMPT)
      setPromptCopied(true)
      setImportError(null)
    } catch (copyError) {
      setPromptCopied(false)
      setImportError(`Could not copy instructions: ${message(copyError)}. Select the text below to copy manually.`)
    }
  }

  function downloadAgentPrompt() {
    try {
      downloadFile(new Blob([AGENT_IMPORT_PROMPT], { type: 'text/markdown;charset=utf-8' }), 'threadline-agent-prompt.md')
      setImportError(null)
    } catch (downloadError) {
      setImportError(`Could not download instructions: ${message(downloadError)}`)
    }
  }

  function importPlanContents(contents: string) {
    const imported = parsePlanFile(contents)
    const id = crypto.randomUUID()
    const current = workspaceRef.current
    applyWorkspace({
      ...current,
      activePlanId: id,
      plans: [...current.plans, { ...imported, id }],
    })
    setSelectedId(null)
    setEditingId(null)
    setMobileNav(false)
    setPlanMenu(false)
    setContextMenu(null)
    setHovered(null)
    setDraft('')
    closeImport()
  }

  async function importPlanFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    try {
      importPlanContents(await file.text())
    } catch (importError) {
      setImportError(`Could not import plan: ${message(importError)}`)
    }
  }

  function importPastedPlan() {
    if (!pastedPlan.trim()) {
      setImportError('Paste a Threadline plan JSON object before importing.')
      return
    }
    try {
      importPlanContents(pastedPlan)
    } catch (importError) {
      setImportError(`Could not import plan: ${message(importError)}`)
    }
  }

  if (loadError) {
    return (
      <main className="recovery">
        <div className="recovery-card">
          <span className="brand-mark">T</span>
          <h1>Couldn't open your saved plans</h1>
          <p>{loadError}</p>
          <p>Your existing browser data has not been changed.</p>
          <button className="primary-button" onClick={() => {
            if (!window.confirm('Replace the unreadable saved data with a new workspace? This cannot be undone.')) return
            setLoadError(null)
          }}>Start a fresh workspace</button>
        </div>
      </main>
    )
  }

  return (
    <div className={`app-shell ${sidebarOpen ? 'plans-open' : ''} ${selected && !expanded ? 'details-open' : ''}`} onPointerDown={cancelPendingLink}>
      {mobileNav && <button className="nav-scrim" aria-label="Close plans" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-expanded' : ''} ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">T</span>
          {plansVisible && <span>threadline<span className="brand-period">.</span></span>}
          <button
            className="icon-button sidebar-toggle"
            aria-label={plansVisible ? 'Hide plans' : 'Show plans'}
            aria-expanded={plansVisible}
            title={plansVisible ? 'Hide plans' : 'Show plans'}
            onClick={() => {
              if (mobileNav) setMobileNav(false)
              else setSidebarOpen((open) => !open)
            }}
          ><Icon name={plansVisible ? 'sidebarClose' : 'sidebarOpen'} size={19} /></button>
        </div>
        {plansVisible && <div className="sidebar-content">
          <div className="sidebar-section-heading"><span>YOUR PLANS</span><span className="plan-total">{workspace.plans.length}</span></div>
          <nav className="plan-list" aria-label="Plans">
            {workspace.plans.map((entry) => (
              <button
                key={entry.id}
                className={`plan-entry ${entry.id === plan.id ? 'active' : ''}`}
                onClick={() => changePlan(entry.id)}
                aria-current={entry.id === plan.id ? 'page' : undefined}
                title={entry.name || 'Untitled plan'}
              >
                <Icon name="folder" size={17} />
                <span>{entry.name || 'Untitled plan'}</span>
                {entry.id === plan.id && <span className="active-pip" />}
              </button>
            ))}
          </nav>
          <button className="add-plan" onClick={addPlan}><Icon name="plus" size={17} /> New plan</button>
          <div className="sidebar-bottom">
            <div className="storage-icon"><Icon name="check" size={15} /></div>
            <div><strong>Private by default</strong><span>Saved in this browser</span></div>
          </div>
        </div>}
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open plans" onClick={() => setMobileNav(true)}>
            <Icon name="menu" />
          </button>
          <div className="breadcrumbs"><span>Workspace</span><Icon name="chevron" size={13} /><strong title={plan.name || 'Untitled plan'}>{plan.name || 'Untitled plan'}</strong></div>
          <div className="topbar-right"><span className="local-badge"><span /> LOCAL WORKSPACE</span></div>
        </header>

        <div className="content-heading">
          <div className="heading-title">
            <div className="plan-title-wrap">
              <input
                className="plan-title"
                aria-label="Plan name"
                title={plan.name || 'Untitled plan'}
                value={plan.name}
                onChange={(event) => updatePlan((current) => ({ ...current, name: event.target.value }))}
                onBlur={() => { if (!plan.name.trim()) updatePlan((current) => ({ ...current, name: 'Untitled plan' })) }}
                maxLength={80}
              />
              <div className="plan-menu-wrap">
                <button className="icon-button menu-dots" aria-label="Plan options" aria-expanded={planMenu} onClick={() => setPlanMenu(!planMenu)}>···</button>
                {planMenu && (
                  <div className="popover">
                    <button onClick={deletePlan}><Icon name="trash" size={16} /> Delete plan</button>
                  </div>
                )}
              </div>
            </div>
            <p>A clear view of what comes next. Changes are saved automatically.</p>
          </div>
          <div className="heading-actions">
            <button className="primary-button" onClick={savePlanFile} title="Download this plan as a reusable JSON file"><Icon name="download" size={17} /> Save locally</button>
            <button ref={importButtonRef} className="outline-button" onClick={() => {
              setImportError(null)
              setPromptCopied(false)
              setImportOpen(true)
            }}><Icon name="upload" size={17} /> Import plan</button>
            <button className="outline-button" onClick={downloadChart} disabled={exporting}><Icon name="download" size={17} /> {exporting ? 'Exporting…' : 'Export PNG'}</button>
          </div>
        </div>

        <div className="summary-row">
          <div className="summary-item"><span className="summary-icon task-icon"><Icon name="tasks" size={18} /></span><strong>{summary.taskCount}</strong><span>{summary.taskCount === 1 ? 'task' : 'tasks'}</span></div>
          <span className="summary-divider" />
          <div className="summary-item"><span className="summary-icon group-icon"><Icon name="folder" size={17} /></span><strong>{summary.groupCount}</strong><span>{summary.groupCount === 1 ? 'group' : 'groups'}</span></div>
          <span className="summary-divider" />
          <div className="summary-item summary-dates">
            <span className="summary-icon date-icon"><Icon name="calendar" size={17} /></span>
            <span>{summary.start && summary.end
              ? `${formatDate(summary.start, { month: 'short', day: 'numeric' })} – ${formatDate(summary.end, { month: 'short', day: 'numeric', year: 'numeric' })}`
              : 'No dates yet'}</span>
            {summary.calendarDays !== null && <strong className="summary-duration">{summary.calendarDays} calendar days</strong>}
          </div>
        </div>

        {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError(null)}><Icon name="close" size={16} /></button></div>}

        <section className={`chart-card ${expanded ? 'chart-expanded' : ''} ${labelWidth < 275 ? 'compact-labels' : ''}`} ref={chartRef} style={chartStyle} aria-label="Gantt chart">
          <div className="chart-toolbar">
            <div className="chart-toolbar-left">
              <div className="view-icon"><Icon name="calendar" size={17} /></div>
              <span className="chart-name">Timeline</span>
              <span className="toolbar-separator" />
              <span className="timeline-instruction">Type in the last row to add</span>
            </div>
            <div className="chart-toolbar-right">
              <span className="drag-hint">Drag bars sideways for dates · vertically for order</span>
              <div className="zoom-control" aria-label="Timeline zoom">
                <button aria-label="Zoom out" disabled={dayWidth <= 28} onClick={() => setDayWidth(Math.max(28, dayWidth - 10))}>−</button>
                <span>{dayWidth === 28 ? 'Compact' : dayWidth === 48 ? 'Wide' : 'Day'}</span>
                <button aria-label="Zoom in" disabled={dayWidth >= 48} onClick={() => setDayWidth(Math.min(48, dayWidth + 10))}>+</button>
              </div>
              <button className="icon-button expand-button" aria-label={expanded ? 'Exit full screen' : 'Full screen chart'} title={expanded ? 'Exit full screen' : 'Full screen chart'} onClick={toggleExpanded}><Icon name={expanded ? 'shrink' : 'expand'} size={17} /></button>
            </div>
          </div>
          <div className="board-scroll" ref={boardRef} onScroll={() => setHovered(null)}>
            <div className="board-inner" style={{ width: labelWidth + timeline.width }}>
              <div className="board-header" style={{ height: HEADER_HEIGHT }}>
                <div className="board-corner">
                  <span>TASK NAME</span><span>DURATION</span>
                  <div
                    className="name-resizer"
                    role="separator"
                    tabIndex={0}
                    aria-label="Resize task name column"
                    aria-orientation="vertical"
                    aria-valuemin={MIN_LABEL_WIDTH}
                    aria-valuemax={MAX_LABEL_WIDTH}
                    aria-valuenow={labelWidth}
                    title="Drag to resize task names · Double-click to reset"
                    onPointerDown={startLabelResize}
                    onPointerMove={moveLabelResize}
                    onPointerUp={endLabelResize}
                    onPointerCancel={endLabelResize}
                    onKeyDown={labelResizeKeyDown}
                    onDoubleClick={() => {
                      setLabelWidth(clampLabelWidth(LABEL_WIDTH, chartRef.current?.clientWidth ?? window.innerWidth))
                      saveLabelWidth(LABEL_WIDTH)
                    }}
                  />
                </div>
                <div className="date-header" style={{ width: timeline.width }}>
                  <div className="month-strip">{months.map((month, i) => <div className="month-cell" style={{ width: month.width }} key={`${month.label}-${i}`}><span>{month.label}</span></div>)}</div>
                  <div className="day-strip">
                    {timeline.days.map((date) => {
                      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
                      return <div className={`day-cell ${weekday === 0 || weekday === 6 ? 'weekend' : ''} ${date === today() ? 'is-today' : ''}`} style={{ width: dayWidth }} key={date}>
                        <span>{formatDate(date, { weekday: 'narrow' })}</span><strong>{Number(date.slice(-2))}</strong>
                      </div>
                    })}
                  </div>
                </div>
              </div>

              <div className="board-body" ref={boardBodyRef} style={{ minHeight: (rows.length + 1) * ROW_HEIGHT }}>
                <svg className="dependency-layer" style={{ left: labelWidth, width: timeline.width, height: rows.length * ROW_HEIGHT }} aria-hidden="true">
                  <defs><marker id="arrowhead" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="#919b95" /></marker></defs>
                  {links.map((link) => <path key={link.key} d={linkPath(link)} fill="none" stroke="#919b95" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" markerEnd="url(#arrowhead)" />)}
                </svg>
                {timeline.days.includes(today()) && <div className="today-line" style={{ left: labelWidth + daysBetween(timeline.start, today()) * dayWidth + dayWidth / 2, height: rows.length * ROW_HEIGHT }} />}
                {rows.map(({ item, depth }) => {
                  const span = spans[item.id]
                  const geometry = span ? barGeometry(span, timeline) : null
                  const childCount = plan.items.filter((entry) => entry.parentId === item.id).length
                  const link = parseItemLink(item.name)
                  const name = displayItemName(item.name)
                  return (
                    <div
                      className={`board-row confidence-${confidenceLevel(item.confidence)} ${item.kind === 'group' ? 'group-row' : ''} ${item.completed ? 'completed-row' : ''} ${selectedId === item.id ? 'selected-row' : ''} ${draggingRowId === item.id ? 'row-dragging' : ''} ${dropTarget?.anchorId === item.id ? `drop-${dropTarget.placement}` : ''}`}
                      style={{ height: ROW_HEIGHT }}
                      key={item.id}
                      data-row-id={item.id}
                      data-depth={depth}
                    >
                      <div
                        className="row-label"
                        style={{ width: labelWidth }}
                        onPointerEnter={(event) => showHover(event, item)}
                        onPointerLeave={() => setHovered(null)}
                        onPointerDown={() => setHovered(null)}
                        onContextMenu={(event) => {
                          if (event.target instanceof Element && event.target.closest('a[href]')) return
                          event.preventDefault()
                          setContextMenu({ itemId: item.id, x: Math.min(event.clientX, window.innerWidth - 175), y: Math.min(event.clientY, window.innerHeight - 55) })
                        }}
                      >
                        <div className="row-label-inner" style={{ paddingLeft: 7 + depth * 17 }}>
                          <span
                            className="row-grip"
                            role="button"
                            tabIndex={0}
                            aria-label={`Drag ${name} to reorder or move into or out of a group`}
                            title="Drag to reorder or nest · Arrow keys also work"
                            onPointerDown={(event) => startRowDrag(event, item)}
                            onPointerMove={moveRowDrag}
                            onPointerUp={endRowDrag}
                            onPointerCancel={cancelRowDrag}
                            onLostPointerCapture={cancelRowDrag}
                            onKeyDown={(event) => rowGripKeyDown(event, item)}
                          ><Icon name="grip" size={15} /></span>
                          {item.kind === 'group'
                            ? <button className={`collapse-button ${item.collapsed ? 'collapsed' : ''}`} aria-label={`${item.collapsed ? 'Expand' : 'Collapse'} ${name}`} onClick={() => updateItem(item.id, { collapsed: !item.collapsed })}><Icon name="chevron" size={15} /></button>
                            : <button
                                type="button"
                                role="checkbox"
                                aria-checked={item.completed}
                                aria-label={`Mark ${name || 'Untitled task'} as ${item.completed ? 'not done' : 'done'}`}
                                title={item.completed ? 'Mark as not done' : 'Mark as done'}
                                className={`task-completion ${item.completed ? 'is-complete' : ''}`}
                                onClick={() => updateItem(item.id, { completed: !item.completed })}
                              ><Icon name="check" size={13} /></button>}
                          {editingId === item.id
                            ? <input
                                className="row-title-input"
                                aria-label={`${item.kind === 'group' ? 'Group' : 'Task'} name`}
                                value={item.name}
                                maxLength={2048}
                                onFocus={() => setSelectedId(item.id)}
                                onChange={(event) => updateItem(item.id, { name: event.target.value })}
                                onBlur={() => {
                                  if (!item.name.trim()) updateItem(item.id, { name: item.kind === 'group' ? 'Untitled group' : 'Untitled task' })
                                  setEditingId((current) => current === item.id ? null : current)
                                }}
                                onKeyDown={(event) => {
                                  if ((event.metaKey || event.ctrlKey) && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                                    event.preventDefault()
                                    moveRowInList(item, event.key === 'ArrowUp' ? -1 : 1, event.currentTarget)
                                  } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                                    event.preventDefault()
                                    if (event.repeat) return
                                    if (event.metaKey || event.ctrlKey) addTaskBelow(item)
                                    else event.currentTarget.blur()
                                  } else if (event.key === 'Escape') {
                                    event.currentTarget.blur()
                                  } else if (event.key === 'Backspace' && (event.metaKey || event.ctrlKey)) {
                                    event.preventDefault()
                                    deleteItem(item)
                                  }
                                }}
                              />
                            : link
                              ? <a
                                  className="row-title-display row-title-link"
                                  href={link.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={`${link.href} · Double-click or press F2 to edit`}
                                  onClick={(event) => clickLinkedName(event, link.href)}
                                  onDoubleClick={(event) => { event.preventDefault(); void editRowName(item) }}
                                  onKeyDown={(event) => { if (event.key === 'F2') { event.preventDefault(); void editRowName(item) } }}
                                >{link.label}</a>
                              : <button
                                  type="button"
                                  className="row-title-display"
                                  title="Double-click or press F2 to edit"
                                  onClick={() => { cancelPendingLink(); setSelectedId(item.id) }}
                                  onDoubleClick={() => { void editRowName(item) }}
                                  onKeyDown={(event) => { if (event.key === 'F2') { event.preventDefault(); void editRowName(item) } }}
                                >{name}</button>}
                          {item.importance !== null && <button
                            type="button"
                            className={`importance-pill row-importance row-property ${importanceClass(item.importance)}`}
                            aria-label={`Edit importance of ${name}: ${IMPORTANCE_LABELS[item.importance]}`}
                            title="Edit importance"
                            onClick={() => { void editRowProperty(item, 'importance') }}
                          >{IMPORTANCE_LABELS[item.importance]}</button>}
                          {item.kind === 'group' && <span className="child-count">{childCount}</span>}
                          {item.confidence !== null && <button
                            type="button"
                            className="row-confidence row-property"
                            aria-label={`Edit confidence of ${name}: ${item.confidence}%`}
                            title="Edit confidence"
                            onClick={() => { void editRowProperty(item, 'confidence') }}
                          >{item.confidence}%</button>}
                          {item.kind === 'task'
                            ? <button
                                type="button"
                                className="row-duration row-property"
                                aria-label={`Edit duration of ${name}`}
                                title="Edit duration"
                                onClick={() => { void editRowProperty(item, 'duration') }}
                              >{span ? `${daysBetween(span.start, span.end)}d` : '—'}</button>
                            : <span className="row-duration">{span ? `${daysBetween(span.start, span.end)}d` : '—'}</span>}
                          <button className="row-detail-button" aria-label={`Edit details for ${name}`} title="Item details" onClick={() => { cancelPendingLink(); setHovered(null); setSelectedId(item.id) }}><Icon name="calendar" size={14} /></button>
                        </div>
                      </div>
                      <div className="row-track" style={{ width: timeline.width, backgroundSize: `${dayWidth}px 100%` }}>
                        {span && geometry && (item.kind === 'group'
                          ? <button
                              className={`group-bar ${draggingBarId === item.id ? 'dragging' : ''}`}
                              style={{ left: geometry.left, width: geometry.width }}
                              aria-label={`Select group ${name}, ${itemDateLabel(span)}, ${confidenceText(item)}${importanceText(item)}. Drag vertically to reorder or nest. Arrow keys up and down reorder.`}
                              onPointerEnter={(event) => showHover(event, item)}
                              onPointerLeave={() => setHovered(null)}
                              onPointerDown={(event) => startDrag(event, item, 'move')}
                              onPointerMove={dragMove}
                              onPointerUp={endDrag}
                              onPointerCancel={cancelBarDrag}
                              onLostPointerCapture={cancelBarDrag}
                              onKeyDown={(event) => barKeyDown(event, item)}
                              onClick={(event) => selectBar(event, item)}
                            />
                          : <div
                              className={`task-bar ${item.completed ? 'completed' : ''} ${draggingBarId === item.id ? 'dragging' : ''}`}
                              style={{ left: geometry.left, width: geometry.width }}
                              role="button"
                              tabIndex={0}
                              aria-label={`${name}, ${itemDateLabel(span)}, ${confidenceText(item)}${importanceText(item)}${item.completed ? ', done' : ''}. Drag sideways to move dates, vertically to reorder or nest, or drag edges to resize. Arrow up and down reorder; left and right move dates.`}
                              onPointerEnter={(event) => showHover(event, item)}
                              onPointerLeave={() => setHovered(null)}
                              onPointerDown={(event) => startDrag(event, item, 'move')}
                              onPointerMove={dragMove}
                              onPointerUp={endDrag}
                              onPointerCancel={cancelBarDrag}
                              onLostPointerCapture={cancelBarDrag}
                              onKeyDown={(event) => barKeyDown(event, item)}
                              onClick={(event) => selectBar(event, item)}
                            >
                              {item.completed && <span className="bar-completion"><Icon name="check" size={13} /></span>}
                              <div className="resize-handle start-handle" role="button" aria-label={`Resize start of ${name}`} onPointerDown={(event) => startDrag(event, item, 'start')} onPointerMove={dragMove} onPointerUp={endDrag} onPointerCancel={cancelBarDrag} onLostPointerCapture={cancelBarDrag} />
                              <div className="resize-handle end-handle" role="button" aria-label={`Resize end of ${name}`} onPointerDown={(event) => startDrag(event, item, 'end')} onPointerMove={dragMove} onPointerUp={endDrag} onPointerCancel={cancelBarDrag} onLostPointerCapture={cancelBarDrag} />
                            </div>)}
                      </div>
                    </div>
                  )
                })}
                <div className={`board-row composer-row ${dropTarget?.placement === 'end' ? 'drop-end' : ''}`} style={{ height: ROW_HEIGHT }}>
                  <div className="row-label composer-label" style={{ width: labelWidth }}>
                    <div className="row-label-inner">
                      <span className="composer-mark"><Icon name="plus" size={15} /></span>
                      <input
                        ref={composerRef}
                        className="composer-input"
                        aria-label="New timeline row"
                        placeholder={rows.length ? 'Task name or # Group…' : 'First task or # Group…'}
                        value={draft}
                        maxLength={2049}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            commitDraft()
                          } else if (event.key === 'Escape') {
                            setDraft('')
                            event.currentTarget.blur()
                          }
                        }}
                        onBlur={() => { if (draft.trim()) commitDraft() }}
                      />
                    </div>
                  </div>
                  <div className="row-track composer-track" style={{ width: timeline.width, backgroundSize: `${dayWidth}px 100%` }}>
                    <span>Enter to add · Start with # to make a group</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="chart-footer"><span><span className="footer-dot" /> Drag bars or dotted handles to reorder or nest rows</span><span># creates a group · Right-click or ⌘/Ctrl+Backspace removes a row</span></div>
          {draggingRowId && plan.items.filter((item) => item.id === draggingRowId).map((item) => (
            <div ref={rowPreviewRef} className={`row-drag-preview confidence-${confidenceLevel(item.confidence)} ${rowDragRef.current?.source === 'bar' ? 'bar-origin' : ''}`} key={item.id} aria-hidden="true">
              <span className="preview-dot" />{displayItemName(item.name) || (item.kind === 'group' ? 'Untitled group' : 'Untitled task')}
            </div>
          ))}
          {hovered && hoveredItem && (
            <div className={`item-tooltip ${hovered.above ? 'above' : ''}`} role="tooltip" style={{ left: hovered.left, top: hovered.top }}>
              <span className="tooltip-name">{displayItemName(hoveredItem.name) || 'Untitled'}</span>
              {hoveredItem.kind === 'task' && hoveredItem.completed && <span className="tooltip-done"><Icon name="check" size={12} /> Done</span>}
              {hoveredItem.importance !== null && <span className={`importance-pill tooltip-importance ${importanceClass(hoveredItem.importance)}`}>{IMPORTANCE_LABELS[hoveredItem.importance]}</span>}
              <span className={`tooltip-confidence confidence-${confidenceLevel(hoveredItem.confidence)}`}>{confidenceText(hoveredItem)}</span>
              {hoveredSpan ? (
                <>
                  <strong>{daysBetween(hoveredSpan.start, hoveredSpan.end)} {daysBetween(hoveredSpan.start, hoveredSpan.end) === 1 ? 'day' : 'days'} elapsed</strong>
                  <span>{formatDate(hoveredSpan.start, { month: 'short', day: 'numeric', year: 'numeric' })} → {formatDate(hoveredSpan.end, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </>
              ) : <strong>No dated tasks yet</strong>}
            </div>
          )}
          {contextMenu && (
            <div className="row-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu">
              <button role="menuitem" onClick={() => {
                const item = plan.items.find((entry) => entry.id === contextMenu.itemId)
                if (item) deleteItem(item)
                setContextMenu(null)
              }}><Icon name="trash" size={15} /> Remove row</button>
            </div>
          )}
        </section>
        <p className="page-footnote">Type in the bottom row to add. Double-click a name to edit; Enter finishes editing, and ⌘/Ctrl+Enter adds a task below. Linked names open in a new window. Drag bars vertically to reorder or nest, and task bars sideways to change dates. Right-click a row to remove it.</p>
      </main>

      {selected && !expanded && (
        <aside className="detail-panel" ref={detailPanelRef} data-item-id={selected.id} aria-label={`${selected.kind} details`}>
            <div className="detail-top"><span>ITEM DETAILS</span><button className="icon-button" aria-label="Close details" onClick={() => setSelectedId(null)}><Icon name="close" size={18} /></button></div>
            <div className="detail-content">
              <div className={`kind-badge ${selected.kind}`}><Icon name={selected.kind === 'group' ? 'folder' : 'tasks'} size={15} /> {selected.kind}</div>
              <h2 className="detail-name">{displayItemName(selected.name) || 'Untitled'}</h2>
              {selected.kind === 'task' && <label className="detail-completion">
                <input type="checkbox" checked={selected.completed} onChange={(event) => updateItem(selected.id, { completed: event.target.checked })} />
                Task done
              </label>}

              <div className="field-divider" />
              <div className="section-label"><Icon name="flag" size={16} /> Importance</div>
              <label className="field-label" htmlFor="item-importance">Importance
                <select
                  id="item-importance"
                  className="field-input"
                  value={selected.importance ?? ''}
                  onChange={(event) => {
                    try {
                      updateItem(selected.id, { importance: parseImportance(event.target.value) })
                    } catch (importanceError) {
                      setError(message(importanceError))
                    }
                  }}
                >
                  <option value="">Not set</option>
                  {IMPORTANCE_OPTIONS.map((value) => <option value={value} key={value}>{IMPORTANCE_LABELS[value]}</option>)}
                </select>
              </label>
              {selected.importance !== null && <span className={`importance-pill detail-importance ${importanceClass(selected.importance)}`}>{IMPORTANCE_LABELS[selected.importance]}</span>}
              <div className="field-divider" />
              <div className="section-label"><Icon name="check" size={16} /> Confidence</div>
              <div className="confidence-editor">
                <label className="field-label" htmlFor="item-confidence">Confidence percentage
                  <input
                    id="item-confidence"
                    className="field-input"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    placeholder="Not set"
                    value={selected.confidence ?? ''}
                    onChange={(event) => {
                      const value = event.target.value
                      if (value === '') {
                        updateItem(selected.id, { confidence: null })
                      } else {
                        const numeric = Number(value)
                        try {
                          confidenceLevel(numeric)
                          updateItem(selected.id, { confidence: numeric })
                        } catch (confidenceError) {
                          setError(message(confidenceError))
                        }
                      }
                    }}
                  />
                </label>
                <span className={`confidence-status confidence-${confidenceLevel(selected.confidence)}`}>
                  {selected.confidence === null ? 'Not set' : `${selected.confidence}%`}
                </span>
              </div>
              <p className="field-help confidence-help">Above 90% green · 70–90% yellow · Below 70% red. Groups have their own confidence.</p>
              <div className="field-divider" />
              {selected.kind === 'task' ? (
                <>
                  <div className="section-label"><Icon name="calendar" size={16} /> Schedule</div>
                  <label className="field-label duration-field" htmlFor="item-duration">Duration (calendar days)
                    <input
                      id="item-duration"
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      className="field-input"
                      value={durationDraft?.itemId === selected.id ? durationDraft.value : daysBetween(selected.start, selected.end)}
                      onChange={(event) => changeDuration(selected, event.target.value)}
                      onBlur={(event) => {
                        if (event.currentTarget.value === '') setError('Duration must be a non-negative whole number of days.')
                        setDurationDraft(null)
                      }}
                    />
                  </label>
                  <p className="field-help duration-help">Changing duration keeps the start date fixed and moves the end date.</p>
                  <div className="date-fields">
                    <label className="field-label">Start date<input type="date" className="field-input" value={selected.start} onChange={(event) => changeDate(selected, 'start', event.target.value)} /></label>
                    <label className="field-label">End date<input id="item-end" type="date" className="field-input" value={selected.end} onChange={(event) => changeDate(selected, 'end', event.target.value)} /></label>
                  </div>
                  {spans[selected.id] && (
                    <div className="schedule-note">
                      <span>On timeline</span><strong>{itemDateLabel(spans[selected.id])}</strong>
                      {spans[selected.id]?.start !== selected.start && <small>Shifted to follow its dependencies. Duration stays the same.</small>}
                    </div>
                  )}
                </>
              ) : (
                <div className="schedule-note group-note"><strong>Group dates are automatic</strong><small>The group bar spans all its nested tasks. Edit a task to change this range.</small></div>
              )}

              {selected.kind === 'task' && (
                <>
                  <div className="field-divider" />
                  <div className="section-label"><Icon name="link" size={16} /> Depends on</div>
                  <p className="field-help">This task starts after every selected item finishes.</p>
                  <div className="dependency-list">
                    {allRows.filter(({ item }) => item.id !== selected.id).length
                      ? allRows.filter(({ item }) => item.id !== selected.id).map(({ item, depth }) => {
                          const checked = selected.dependencies.includes(item.id)
                          const enabled = canDependOn(selected, item.id)
                          const name = displayItemName(item.name) || 'Untitled'
                          return <label className={`dependency-option ${!enabled ? 'disabled' : ''}`} key={item.id} style={{ paddingLeft: 11 + depth * 13 }} title={enabled ? name : `${name}\nThis link would create a cycle or refers to an empty group`}>
                            <input type="checkbox" checked={checked} disabled={!enabled} onChange={() => toggleDependency(selected, item.id)} />
                            <span className="checkbox-face"><Icon name="check" size={13} /></span>
                            <Icon name={item.kind === 'group' ? 'folder' : 'tasks'} size={15} />
                            <span>{name}</span>
                          </label>
                        })
                      : <span className="no-dependencies">Add another task to link it here.</span>}
                  </div>
                </>
              )}
            </div>
            <div className="detail-bottom"><span>Drag rows to organize. Right-click a row to remove it.</span><span>Saved automatically</span></div>
        </aside>
      )}

      <dialog
        ref={importDialogRef}
        className="import-dialog"
        aria-labelledby="import-dialog-title"
        aria-describedby="import-dialog-description"
        aria-modal="true"
        onCancel={(event) => { event.preventDefault(); closeImport() }}
      >
        <div className="import-dialog-header">
          <div>
            <h2 id="import-dialog-title">Import a plan</h2>
            <p id="import-dialog-description">Bring in a Threadline file, or ask an AI agent to create one from your task list.</p>
          </div>
          <button className="icon-button" aria-label="Close import dialog" onClick={closeImport}><Icon name="close" size={18} /></button>
        </div>
        <div className="import-dialog-body">
          {importError && <p className="import-error" role="alert">{importError}</p>}
          <div className="import-method" role="group" aria-label="Import method">
            <button type="button" className={importMethod === 'file' ? 'active' : ''} aria-pressed={importMethod === 'file'} onClick={() => { setImportMethod('file'); setImportError(null) }}>Upload file</button>
            <button type="button" className={importMethod === 'paste' ? 'active' : ''} aria-pressed={importMethod === 'paste'} onClick={() => { setImportMethod('paste'); setImportError(null) }}>Paste JSON</button>
          </div>
          {importMethod === 'file' ? (
            <section className="import-section import-upload">
              <div><h3>Upload a plan file</h3><p>Choose a .threadline.json file. It will open as a new plan without replacing your existing plans.</p></div>
              <button ref={importChooseRef} className="primary-button" onClick={() => importRef.current?.click()}><Icon name="upload" size={17} /> Choose file</button>
            </section>
          ) : (
            <section className="import-section import-paste">
              <div><h3>Paste plan JSON</h3><p>Paste the JSON from your agent or a saved Threadline plan. It will open as a new plan.</p></div>
              <textarea
                className="import-json-editor"
                aria-label="Threadline plan JSON"
                placeholder='{"format":"threadline-plan","version":1,"plan":{...}}'
                value={pastedPlan}
                onChange={(event) => { setPastedPlan(event.target.value); setImportError(null) }}
                spellCheck={false}
                autoCapitalize="off"
              />
              <button className="primary-button" onClick={importPastedPlan}>Import pasted plan</button>
            </section>
          )}
          <input ref={importRef} type="file" hidden accept=".threadline.json,.json,application/json" aria-label="Choose a Threadline plan file" onChange={importPlanFile} />
          <section className="import-section import-agent">
            <div><h3>Create a plan with an AI agent</h3><p>Paste your Markdown task list into this prompt, then give it to an agent. Paste its JSON response above or save it as a .threadline.json file to upload.</p></div>
            <textarea className="import-prompt-preview" aria-label="Agent import instructions" value={AGENT_IMPORT_PROMPT} readOnly spellCheck={false} />
            <div className="import-prompt-actions">
              <button className="outline-button" aria-live="polite" onClick={copyAgentPrompt}><Icon name={promptCopied ? 'check' : 'copy'} size={17} /> {promptCopied ? 'Copied' : 'Copy instructions'}</button>
              <button className="outline-button" onClick={downloadAgentPrompt}><Icon name="download" size={17} /> Download instructions</button>
            </div>
          </section>
        </div>
      </dialog>
    </div>
  )
}
