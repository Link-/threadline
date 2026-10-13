import { describe, expect, it } from 'vitest'
import { AGENT_IMPORT_PROMPT } from './agentPrompt'
import { flattenItems, parsePlanFile, schedulePlan } from './model'

describe('agent import instructions', () => {
  it('provides a complete example that the real importer accepts, including nested groups and dependencies', () => {
    const sample = AGENT_IMPORT_PROMPT.match(/```json\n([\s\S]*?)\n```/)?.[1]
    if (!sample) throw new Error('The import prompt has no JSON example.')
    const plan = parsePlanFile(sample)
    expect(flattenItems(plan.items).map(({ item, depth }) => [item.name, depth]))
      .toEqual([['Planning', 0], ['Research', 1], ['Outline', 2], ['Build', 0]])
    expect(schedulePlan(plan)['task-build']).toEqual({ start: '2026-11-05', end: '2026-11-09' })
  })

  it('leaves a Markdown placeholder and specifies every field needed to generate an importable file', () => {
    expect(AGENT_IMPORT_PROMPT).toContain('## My plan in Markdown (replace this section)')
    expect(AGENT_IMPORT_PROMPT).toContain('- Group: [Group name]')
    expect(AGENT_IMPORT_PROMPT).toContain('Start: [YYYY-MM-DD] | End: [YYYY-MM-DD]')
    expect(AGENT_IMPORT_PROMPT).toContain('"format":"threadline-plan","version":1')
    for (const field of ['id', 'name', 'kind', 'parentId', 'start', 'end', 'dependencies', 'collapsed', 'confidence']) {
      expect(AGENT_IMPORT_PROMPT).toContain(field)
    }
    expect(AGENT_IMPORT_PROMPT).toContain('without a code fence or explanation')
    expect(AGENT_IMPORT_PROMPT).toContain('Import plan > Paste JSON')
  })
})
