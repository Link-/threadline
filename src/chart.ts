import { addDays, confidenceLevel, daysBetween, displayItemName, formatDate, IMPORTANCE_LABELS, MAX_LABEL_WIDTH, MIN_LABEL_WIDTH, planFileStem, summarizePlan, today } from './model'
import type { ConfidenceLevel, Importance, Plan, Row, Span } from './model'

export { MAX_LABEL_WIDTH, MIN_LABEL_WIDTH } from './model'
export const LABEL_WIDTH = 320
export const HEADER_HEIGHT = 78
export const ROW_HEIGHT = 54
const CONFIDENCE_COLORS: Record<ConfidenceLevel, string> = {
  high: '#398d6c',
  medium: '#c49128',
  low: '#cb625b',
  unrated: '#90a19a',
}
const IMPORTANCE_COLORS: Record<Importance, { background: string; foreground: string }> = {
  critical: { background: '#fce9e6', foreground: '#ae4139' },
  investment: { background: '#e7efff', foreground: '#345b99' },
  debt: { background: '#fff1d7', foreground: '#895d20' },
  'stretch goal': { background: '#f0eafb', foreground: '#6d51a5' },
  optional: { background: '#edf2ee', foreground: '#5d7569' },
}

export type Timeline = {
  start: string
  days: string[]
  dayWidth: number
  width: number
}

export type Link = {
  key: string
  x1: number
  x2: number
  y1: number
  y2: number
  exitX: number
  enterX: number
  exitY: number
  enterY: number
  routeX: number
}

type Point = { x: number; y: number }
type LinkCommand =
  | { kind: 'line'; point: Point }
  | { kind: 'curve'; control: Point; end: Point }

function portOffset(index: number, count: number, limit: number): number {
  return count < 2 ? 0 : (index / (count - 1) * 2 - 1) * limit
}

function clearChannel(exitX: number, enterX: number, obstacles: { left: number; width: number }[], width: number): number {
  const blocked = obstacles.map(({ left, width: barWidth }) => [left - 8, left + barWidth + 8])
  const candidates = [exitX, enterX, 0, width, ...blocked.flatMap(([left, right]) => [left - 1, right + 1])]
  const clear = candidates.filter((x) =>
    x >= 0 && x <= width && blocked.every(([left, right]) => x < left || x > right),
  )
  if (!clear.length) throw new Error('Could not route a dependency around the task bars.')
  return clear.reduce((best, x) => {
    const distance = (candidate: number) =>
      Math.abs(candidate - exitX) + Math.abs(candidate - enterX) + Math.abs(candidate - exitX) * .01
    return distance(x) < distance(best) ? x : best
  })
}

export function clampLabelWidth(width: number, chartWidth: number): number {
  const max = Math.max(MIN_LABEL_WIDTH, Math.min(MAX_LABEL_WIDTH, chartWidth - 120))
  return Math.max(MIN_LABEL_WIDTH, Math.min(max, Math.round(width)))
}

export function createTimeline(spans: Record<string, Span | null>, dayWidth: number): Timeline {
  const dates = Object.values(spans).filter((span): span is Span => span !== null)
  const anchor = today()
  const first = dates.length
    ? dates.reduce((min, span) => span.start < min ? span.start : min, dates[0].start)
    : anchor
  const last = dates.length
    ? dates.reduce((max, span) => span.end > max ? span.end : max, dates[0].end)
    : addDays(anchor, 18)
  const start = addDays(first, -5)
  const end = addDays(last, 12)
  const count = Math.max(25, daysBetween(start, end) + 1)
  return {
    start,
    days: Array.from({ length: count }, (_, i) => addDays(start, i)),
    dayWidth,
    width: count * dayWidth,
  }
}

export function barGeometry(span: Span, timeline: Timeline): { left: number; width: number } {
  return {
    left: daysBetween(timeline.start, span.start) * timeline.dayWidth + 5,
    width: (daysBetween(span.start, span.end) + 1) * timeline.dayWidth - 10,
  }
}

export function dependencyLinks(
  rows: Row[],
  spans: Record<string, Span | null>,
  timeline: Timeline,
): Link[] {
  const positions = new Map(rows.map((row, index) => [row.item.id, index]))
  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  for (const { item } of rows) {
    if (!spans[item.id]) continue
    for (const predecessorId of new Set(item.dependencies)) {
      if (!positions.has(predecessorId) || !spans[predecessorId]) continue
      incoming.set(item.id, [...(incoming.get(item.id) ?? []), predecessorId])
      outgoing.set(predecessorId, [...(outgoing.get(predecessorId) ?? []), item.id])
    }
  }
  for (const ids of [...incoming.values(), ...outgoing.values()]) {
    ids.sort((a, b) => positions.get(a)! - positions.get(b)!)
  }
  const links: Link[] = []
  for (const row of rows) {
    const targetIndex = positions.get(row.item.id)!
    const target = spans[row.item.id]
    if (!target) continue
    for (const predecessorId of incoming.get(row.item.id) ?? []) {
      const sourceIndex = positions.get(predecessorId)!
      const from = barGeometry(spans[predecessorId]!, timeline)
      const to = barGeometry(target, timeline)
      const x1 = from.left + from.width + 2
      const x2 = to.left - 3
      const exitX = x1 + 18
      const enterX = x2 - 18
      const direction = targetIndex > sourceIndex ? 1 : -1
      const sources = outgoing.get(predecessorId)!
      const targets = incoming.get(row.item.id)!
      const sourceOffset = portOffset(sources.indexOf(row.item.id), sources.length, rows[sourceIndex].item.kind === 'group' ? 2 : 6)
      const targetOffset = portOffset(targets.indexOf(predecessorId), targets.length, row.item.kind === 'group' ? 2 : 6)
      const obstacles = rows.slice(Math.min(sourceIndex, targetIndex) + 1, Math.max(sourceIndex, targetIndex))
        .flatMap(({ item }) => spans[item.id] ? [barGeometry(spans[item.id]!, timeline)] : [])
      links.push({
        key: `${predecessorId}-${row.item.id}`,
        x1, x2, exitX, enterX,
        y1: (sourceIndex + .5) * ROW_HEIGHT + sourceOffset,
        y2: (targetIndex + .5) * ROW_HEIGHT + targetOffset,
        exitY: (sourceIndex + (direction > 0 ? 1 : 0)) * ROW_HEIGHT + sourceOffset,
        enterY: (targetIndex + (direction > 0 ? 0 : 1)) * ROW_HEIGHT + targetOffset,
        routeX: clearChannel(exitX, enterX, obstacles, timeline.width),
      })
    }
  }
  return links
}

export function linkPoints(link: Link): Point[] {
  return [
    { x: link.x1, y: link.y1 },
    { x: link.exitX, y: link.y1 },
    { x: link.exitX, y: link.exitY },
    { x: link.routeX, y: link.exitY },
    { x: link.routeX, y: link.enterY },
    { x: link.enterX, y: link.enterY },
    { x: link.enterX, y: link.y2 },
    { x: link.x2, y: link.y2 },
  ]
}

function linkCommands(link: Link): LinkCommand[] {
  const points = linkPoints(link).filter((point, index, all) =>
    index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y,
  )
  const commands: LinkCommand[] = []
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]
    const corner = points[index]
    const next = points[index + 1]
    const before = Math.hypot(corner.x - previous.x, corner.y - previous.y)
    const after = Math.hypot(next.x - corner.x, next.y - corner.y)
    const turn = (corner.x - previous.x) * (next.y - corner.y) -
      (corner.y - previous.y) * (next.x - corner.x)
    if (!turn) {
      commands.push({ kind: 'line', point: corner })
      continue
    }
    const radius = Math.min(7, before / 2, after / 2)
    commands.push({
      kind: 'line',
      point: {
        x: corner.x - (corner.x - previous.x) / before * radius,
        y: corner.y - (corner.y - previous.y) / before * radius,
      },
    })
    commands.push({
      kind: 'curve',
      control: corner,
      end: {
        x: corner.x + (next.x - corner.x) / after * radius,
        y: corner.y + (next.y - corner.y) / after * radius,
      },
    })
  }
  commands.push({ kind: 'line', point: points.at(-1)! })
  return commands
}

export function linkPath(link: Link): string {
  return `M ${link.x1} ${link.y1} ${linkCommands(link).map((command) =>
    command.kind === 'line'
      ? `L ${command.point.x} ${command.point.y}`
      : `Q ${command.control.x} ${command.control.y} ${command.end.x} ${command.end.y}`,
  ).join(' ')}`
}

function drawClippedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
): void {
  if (width <= 0) return
  let label = text
  while (label.length > 1 && ctx.measureText(label).width > width) label = `${label.slice(0, -2)}…`
  if (ctx.measureText(label).width <= width) ctx.fillText(label, x, y)
}

function drawDoneMark(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#398d6c'
  ctx.beginPath()
  ctx.roundRect(x, y, 14, 14, 3)
  ctx.fill()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1.8
  ctx.beginPath()
  ctx.moveTo(x + 3, y + 7)
  ctx.lineTo(x + 6, y + 10)
  ctx.lineTo(x + 11, y + 4)
  ctx.stroke()
}

export async function exportPng(
  plan: Plan,
  rows: Row[],
  spans: Record<string, Span | null>,
  timeline: Timeline,
  requestedLabelWidth: number,
): Promise<void> {
  const labelWidth = Math.max(LABEL_WIDTH, requestedLabelWidth)
  const titleHeight = 160
  const width = labelWidth + timeline.width
  const height = titleHeight + HEADER_HEIGHT + Math.max(rows.length, 1) * ROW_HEIGHT + 22
  const scale = Math.min(2, 12000 / width, 12000 / height, Math.sqrt(48_000_000 / (width * height)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * scale)
  canvas.height = Math.ceil(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser could not create an image for this chart.')
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = '#17342d'
  ctx.font = '600 23px system-ui, sans-serif'
  drawClippedText(ctx, plan.name, 24, 36, width - 48)
  ctx.fillStyle = '#89958e'
  ctx.font = '12px system-ui, sans-serif'
  ctx.fillText('THREADLINE  /  PROJECT TIMELINE', 25, 58)

  const summary = summarizePlan(plan, spans)
  const metrics = [
    { label: 'TASKS', value: String(summary.taskCount) },
    { label: 'GROUPS', value: String(summary.groupCount) },
    { label: 'START', value: summary.start ? formatDate(summary.start, { month: 'short', day: 'numeric', year: 'numeric' }) : 'No dates yet' },
    { label: 'END', value: summary.end ? formatDate(summary.end, { month: 'short', day: 'numeric', year: 'numeric' }) : 'No dates yet' },
    { label: 'DURATION', value: summary.calendarDays === null ? '—' : `${summary.calendarDays} calendar days` },
  ]
  const summaryWidth = Math.min(width - 48, 1180)
  const metricWidth = summaryWidth / metrics.length
  ctx.fillStyle = '#f5f8f5'
  ctx.beginPath()
  ctx.roundRect(24, 76, summaryWidth, 68, 8)
  ctx.fill()
  metrics.forEach(({ label, value }, index) => {
    const x = 24 + index * metricWidth
    if (index) {
      ctx.fillStyle = '#e0e9e1'
      ctx.fillRect(x, 90, 1, 40)
    }
    ctx.fillStyle = '#84978a'
    ctx.font = '700 10px system-ui, sans-serif'
    ctx.fillText(label, x + 14, 100)
    ctx.fillStyle = '#294739'
    ctx.font = '600 14px system-ui, sans-serif'
    drawClippedText(ctx, value, x + 14, 124, metricWidth - 28)
  })

  const top = titleHeight
  ctx.fillStyle = '#f5f7f5'
  ctx.fillRect(0, top, width, HEADER_HEIGHT)
  ctx.fillStyle = '#e1e8e2'
  ctx.fillRect(0, top + HEADER_HEIGHT - 1, width, 1)

  ctx.font = '600 11px system-ui, sans-serif'
  ctx.fillStyle = '#76867d'
  ctx.fillText('TASKS', 24, top + 47)
  for (let day = 0; day < timeline.days.length; day++) {
    const date = timeline.days[day]
    const x = labelWidth + day * timeline.dayWidth
    if ([0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())) {
      ctx.fillStyle = '#f8faf8'
      ctx.fillRect(x, top + HEADER_HEIGHT, timeline.dayWidth, rows.length * ROW_HEIGHT)
    }
    ctx.fillStyle = '#e9eeea'
    ctx.fillRect(x, top + 34, 1, HEADER_HEIGHT - 34 + rows.length * ROW_HEIGHT)
    ctx.fillStyle = '#526359'
    ctx.font = '600 11px system-ui, sans-serif'
    ctx.fillText(date.slice(-2), x + timeline.dayWidth / 2 - 7, top + 61)
    if (day === 0 || date.slice(0, 7) !== timeline.days[day - 1].slice(0, 7)) {
      ctx.fillStyle = '#516b5c'
      ctx.font = '600 12px system-ui, sans-serif'
      ctx.fillText(formatDate(date, { month: 'long', year: 'numeric' }), x + 10, top + 23)
    }
  }

  const links = dependencyLinks(rows, spans, timeline)
  for (let index = 0; index < rows.length; index++) {
    const { item, depth } = rows[index]
    const y = top + HEADER_HEIGHT + index * ROW_HEIGHT
    if (item.kind === 'group') {
      ctx.fillStyle = '#f7faf7'
      ctx.fillRect(0, y, width, ROW_HEIGHT)
    }
    ctx.fillStyle = '#e9eeea'
    ctx.fillRect(0, y + ROW_HEIGHT - 1, width, 1)
    let textRight = labelWidth - 15
    if (item.confidence !== null) {
      ctx.fillStyle = CONFIDENCE_COLORS[confidenceLevel(item.confidence)]
      ctx.font = '700 10px system-ui, sans-serif'
      const confidence = `${item.confidence}%`
      const confidenceWidth = ctx.measureText(confidence).width
      ctx.fillText(confidence, textRight - confidenceWidth, y + 31)
      textRight -= confidenceWidth + 10
    }
    if (item.importance !== null) {
      const label = IMPORTANCE_LABELS[item.importance]
      const colors = IMPORTANCE_COLORS[item.importance]
      ctx.font = '700 10px system-ui, sans-serif'
      const badgeWidth = Math.ceil(ctx.measureText(label).width) + 12
      const badgeLeft = textRight - badgeWidth
      ctx.fillStyle = colors.background
      ctx.beginPath()
      ctx.roundRect(badgeLeft, y + 17, badgeWidth, 19, 4)
      ctx.fill()
      ctx.fillStyle = colors.foreground
      ctx.fillText(label, badgeLeft + 6, y + 30)
      textRight = badgeLeft - 8
    }
    ctx.font = `${item.kind === 'group' ? '600' : '500'} 13px system-ui, sans-serif`
    let nameLeft = 23 + depth * 17
    if (item.completed) {
      drawDoneMark(ctx, nameLeft, y + 20)
      nameLeft += 20
    }
    ctx.fillStyle = item.completed ? '#819589' : item.kind === 'group' ? '#254c3c' : '#34463d'
    drawClippedText(ctx, displayItemName(item.name), nameLeft, y + 32, Math.max(0, textRight - nameLeft))
  }

  ctx.save()
  ctx.translate(labelWidth, top + HEADER_HEIGHT)
  ctx.strokeStyle = '#919b95'
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const link of links) {
    ctx.beginPath()
    ctx.moveTo(link.x1, link.y1)
    for (const command of linkCommands(link)) {
      if (command.kind === 'line') ctx.lineTo(command.point.x, command.point.y)
      else ctx.quadraticCurveTo(command.control.x, command.control.y, command.end.x, command.end.y)
    }
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(link.x2, link.y2)
    ctx.lineTo(link.x2 - 5, link.y2 - 3)
    ctx.lineTo(link.x2 - 5, link.y2 + 3)
    ctx.closePath()
    ctx.fillStyle = '#919b95'
    ctx.fill()
  }
  for (let index = 0; index < rows.length; index++) {
    const { item } = rows[index]
    const span = spans[item.id]
    if (!span) continue
    const { left, width: barWidth } = barGeometry(span, timeline)
    const y = index * ROW_HEIGHT + ROW_HEIGHT / 2
    ctx.fillStyle = CONFIDENCE_COLORS[confidenceLevel(item.confidence)]
    const barHeight = item.kind === 'group' ? 10 : 24
    ctx.globalAlpha = item.kind === 'group' ? .75 : item.completed ? .6 : 1
    ctx.beginPath()
    ctx.roundRect(left, y - barHeight / 2, barWidth, barHeight, item.kind === 'group' ? 3 : 6)
    ctx.fill()
    ctx.globalAlpha = 1
    if (item.completed) drawDoneMark(ctx, left + barWidth / 2 - 7, y - 7)
    if (item.kind === 'group') {
      ctx.fillStyle = CONFIDENCE_COLORS[confidenceLevel(item.confidence)]
      ctx.fillRect(left, y - 6, 3, 13)
      ctx.fillRect(left + barWidth - 3, y - 6, 3, 13)
    }
  }
  ctx.restore()

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error('PNG export failed. Try a smaller date range.')), 'image/png'),
  )
  downloadFile(blob, `${planFileStem(plan.name)}.png`)
}

export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}

export function itemDateLabel(span: Span | null): string {
  if (!span) return 'No tasks yet'
  return `${daysBetween(span.start, span.end)}d · ${formatDate(span.start, { month: 'short', day: 'numeric' })} – ${formatDate(span.end, { month: 'short', day: 'numeric' })}`
}
