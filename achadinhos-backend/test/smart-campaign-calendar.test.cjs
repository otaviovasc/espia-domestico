const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
  SMART_CAMPAIGN_TIMEZONE,
  smartCampaignCalendarContext,
} = require('../dist/services/smartCampaignCalendar.js')

const event = (context, id) => context.events.find((item) => item.id === id)

test('calendar computes movable family dates and exposes preparation timing, not a false holiday today', () => {
  const mothers = smartCampaignCalendarContext('2026-04-19', ['domestica'])
  assert.equal(event(mothers, 'mothers-day').date, '2026-05-10')
  assert.equal(event(mothers, 'mothers-day').daysUntil, 21)
  assert.equal(event(mothers, 'mothers-day').timing, 'upcoming')
  assert.equal(smartCampaignCalendarContext('2026-04-18', ['domestica']).events.length, 0)

  const fathers = smartCampaignCalendarContext('2026-08-09', ['masculino'])
  assert.equal(event(fathers, 'fathers-day').timing, 'today')
  assert.equal(event(fathers, 'fathers-day').date, '2026-08-09')
})

test('Black Friday follows the fourth Thursday even in a leap year with five Fridays', () => {
  const context = smartCampaignCalendarContext('2024-11-29', ['pet'])
  assert.equal(event(context, 'black-friday').date, '2024-11-29')
  assert.equal(event(context, 'black-friday').timing, 'today')
  assert.match(event(context, 'black-friday').note, /não comprova desconto real/)
})

test('calendar crosses year boundaries and distinguishes before, today and after', () => {
  const before = smartCampaignCalendarContext('2026-12-20', ['natal'])
  assert.equal(event(before, 'christmas').daysUntil, 5)
  assert.equal(event(before, 'new-year').daysUntil, 12)
  const today = smartCampaignCalendarContext('2026-12-25', ['natal'])
  assert.equal(event(today, 'christmas').timing, 'today')
  const after = smartCampaignCalendarContext('2026-12-26', ['natal'])
  assert.equal(event(after, 'christmas').timing, 'after')
  assert.equal(event(after, 'christmas').daysUntil, -1)
})

test('pet awareness is audience-scoped and never introduces medical permission', () => {
  assert.equal(
    event(smartCampaignCalendarContext('2026-09-24', ['domestica']), 'world-animal-day'),
    undefined,
  )
  const pet = event(smartCampaignCalendarContext('2026-09-24', ['pet']), 'world-animal-day')
  assert.equal(pet.daysUntil, 10)
  assert.match(pet.note, /Não autoriza medicamentos/)
})

test('weekday calculation is deterministic across leap day and uses the declared timezone contract', () => {
  const context = smartCampaignCalendarContext('2028-02-29', ['pesca'])
  assert.equal(context.weekday, 'terça-feira')
  assert.equal(context.timezone, SMART_CAMPAIGN_TIMEZONE)
  assert.equal(context.events.length, 0)
})

test('custom events are bounded, labeled user input and filtered by audience', () => {
  const custom = {
    id: 'group-anniversary',
    name: 'Aniversário do grupo PET',
    date: '2026-06-15',
    audiences: ['pet'],
    preparationDays: 7,
    followUpDays: 0,
  }
  assert.equal(smartCampaignCalendarContext('2026-06-08', ['domestica'], [custom]).events.length, 0)
  const context = smartCampaignCalendarContext('2026-06-08', ['pet'], [custom])
  assert.equal(context.events[0].sourceKind, 'user')
  assert.equal(context.events[0].daysUntil, 7)
  assert.match(context.events[0].note, /validar contexto/)
  assert.equal(
    smartCampaignCalendarContext(
      '2026-06-08',
      ['pet'],
      Array.from({ length: 5 }, (_, index) => ({
        ...custom,
        id: `custom-${index}`,
        name: `Evento ${index}`,
      })),
    ).events.length,
    3,
  )
  assert.throws(
    () => smartCampaignCalendarContext('2026-06-08', ['pet'], [{ ...custom, preparationDays: 91 }]),
    /0-90/,
  )
})
