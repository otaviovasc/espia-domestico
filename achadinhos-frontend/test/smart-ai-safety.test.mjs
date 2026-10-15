import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createSmartAIRequestId } from '../src/lib/smartAiSafety.ts'

const pageSource = await readFile(new URL('../src/pages/SmartCampaignsPage.tsx', import.meta.url), 'utf8')
const apiSource = await readFile(new URL('../src/lib/smartCampaignApi.ts', import.meta.url), 'utf8')

test('paid Smart Campaign mutations opt out of automatic retries', () => {
  const paidSections = [
    pageSource.slice(pageSource.indexOf('function KeywordPlanner'), pageSource.indexOf('function ImportPlanner')),
    pageSource.slice(pageSource.indexOf('function ImportPlanner'), pageSource.indexOf('function ItemStateSelect')),
    pageSource.slice(pageSource.indexOf('function PlanActions'), pageSource.indexOf('function PlanHistory')),
  ]
  for (const section of paidSections) assert.match(section, /useMutation\([\s\S]*?retry: false,/)
})

test('paid endpoints are POST-only and carry caller-generated request ids', () => {
  assert.match(apiSource, /api\.post\('\/smart-campaigns\/keywords', input\)/)
  assert.match(apiSource, /api\.post\('\/smart-campaigns\/plans', input\)/)
  assert.match(apiSource, /requestId: string/)
  assert.match(apiSource, /requestId\?: string/)
  assert.match(apiSource, /api\.get\('\/smart-campaigns\/ai-status'\)/)
  assert.doesNotMatch(pageSource, /useQuery\([^\n]*smartCampaignApi\.(keywords|createPlan)/)
})

test('AI request ids are valid UUIDs', () => {
  assert.match(createSmartAIRequestId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
})
