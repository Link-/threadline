import { serializePlan } from './model'
import type { Plan } from './model'

const example: Plan = {
  id: 'plan-example',
  name: 'Example delivery',
  items: [
    {
      id: 'group-planning', name: 'Planning', kind: 'group', parentId: null,
      start: '2026-11-02', end: '2026-11-04', dependencies: [], collapsed: false, confidence: null,
      importance: 'critical', completed: false,
    },
    {
      id: 'group-research', name: 'Research', kind: 'group', parentId: 'group-planning',
      start: '2026-11-02', end: '2026-11-04', dependencies: [], collapsed: false, confidence: null,
      importance: null, completed: false,
    },
    {
      id: 'task-outline', name: 'Outline', kind: 'task', parentId: 'group-research',
      start: '2026-11-02', end: '2026-11-04', dependencies: [], collapsed: false, confidence: 90,
      importance: 'investment', completed: true,
    },
    {
      id: 'task-build', name: 'Build', kind: 'task', parentId: null,
      start: '2026-11-03', end: '2026-11-07', dependencies: ['task-outline'], collapsed: false, confidence: 75,
      importance: 'stretch goal', completed: false,
    },
  ],
}

export const AGENT_IMPORT_PROMPT = `# Create a Threadline plan file

Convert the Markdown plan below into one importable Threadline JSON object. Return ONLY the JSON object, without a code fence or explanation. I can paste that response into Threadline's Import plan > Paste JSON editor or save it as a UTF-8 file ending in .threadline.json and upload it.

Rules:
- Use exactly this top-level shape: {"format":"threadline-plan","version":1,"plan":{"id":"...","name":"...","items":[...]}}. Produce one plan, not a workspace or an array.
- Give the plan and every item a unique, nonempty string id. Every item must have id, name, kind, parentId, start, end, dependencies, collapsed, confidence, importance, and completed.
- Set plan.name to the plan title; do not turn the plan title into a group. Use kind "group" for grouping headings and "task" for actual tasks. Preserve their order and nesting: parentId is the containing group's id, or null for a top-level item. Groups can contain other groups. Put each group before its children in the items array.
- For each task, start and end are real YYYY-MM-DD calendar dates with end on or after start. Both endpoints are included. Use the dates from my Markdown; do not adjust them for dependencies because Threadline schedules them automatically.
- Groups also need start and end strings in YYYY-MM-DD format, but Threadline ignores those values and derives each group's displayed range from its descendant tasks. Use the earliest start and latest end of the group's tasks, or another valid date if it is empty.
- Only tasks may have dependencies. Set a task's dependencies to the ids of the tasks or nonempty groups it depends on; otherwise use []. A dependent task starts the calendar day AFTER its latest dependency finishes, keeping its original duration. Do not create missing references, self-dependencies, or cycles (including a task depending on a group containing that task).
- Set collapsed to false. Set confidence to an integer from 0 to 100 when given, otherwise null. Set importance to exactly "critical", "investment", "debt", "stretch goal", or "optional" when specified for either a group or task, otherwise null. Do not infer importance from confidence. Set completed to true only for tasks marked done, otherwise false; groups must always use false. Completion is visual and does not change dates or dependencies. Use [] for every group's dependencies. Keep all JSON values valid: strings quoted, no comments or trailing commas.
- If any task lacks a required start or end date, or a named dependency is ambiguous, ask me to clarify BEFORE producing JSON rather than inventing data.

This example demonstrates the format, including a nested group and a dependency. Replace ALL example names, ids, dates, and items with my plan; do not include the example in your response:

\`\`\`json
${serializePlan(example).trimEnd()}
\`\`\`

## My plan in Markdown (replace this section)

Plan name: [Your plan name]

- Group: [Group name] | Importance: [critical, investment, debt, stretch goal, optional, or not set] | Confidence: [0-100, or unknown]
  - Task: [Task name] | Start: [YYYY-MM-DD] | End: [YYYY-MM-DD] | Depends on: [task or group name, or none] | Confidence: [0-100, or unknown] | Importance: [critical, investment, debt, stretch goal, optional, or not set] | Done: [yes or no]
- Task: [Another task] | Start: [YYYY-MM-DD] | End: [YYYY-MM-DD] | Depends on: [task or group name, or none] | Confidence: [0-100, or unknown] | Importance: [critical, investment, debt, stretch goal, optional, or not set] | Done: [yes or no]
`
