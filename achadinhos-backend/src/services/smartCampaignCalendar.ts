import type { NicheSlug } from '@/dtos/smartIntelligence'

export const SMART_CAMPAIGN_TIMEZONE = 'America/Sao_Paulo'

export interface SmartCampaignCustomEvent {
  id: string
  name: string
  date: string
  audiences?: NicheSlug[]
  preparationDays?: number
  followUpDays?: number
  sourceUrl?: string
  note?: string
}

export interface SmartCampaignCalendarEvent {
  id: string
  name: string
  date: string
  audiences: NicheSlug[]
  sourceUrl?: string
  sourceKind: 'official' | 'user'
  timing: 'upcoming' | 'today' | 'after'
  daysUntil: number
  note: string
}

export interface SmartCampaignCalendarContext {
  localDate: string
  timezone: typeof SMART_CAMPAIGN_TIMEZONE
  weekday: string
  events: SmartCampaignCalendarEvent[]
  caveat: string
}

interface EventDefinition {
  id: string
  name: string
  dateForYear(year: number): string
  audiences: NicheSlug[]
  preparationDays: number
  followUpDays: number
  sourceUrl: string
  note: string
}

const ALL_AUDIENCES: NicheSlug[] = ['domestica', 'masculino', 'natal', 'pesca', 'pet']
const GIFT_AUDIENCES: NicheSlug[] = ['domestica', 'masculino', 'natal', 'pet']

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** UTC noon avoids host-timezone rollover while computing Brazil calendar dates. */
function nthWeekday(year: number, month: number, weekday: number, occurrence: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1, 12))
  const day = 1 + ((weekday - first.getUTCDay() + 7) % 7) + (occurrence - 1) * 7
  return isoDate(year, month, day)
}

function blackFriday(year: number): string {
  const fourthThursday = nthWeekday(year, 11, 4, 4)
  const date = new Date(`${fourthThursday}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

export const SMART_CAMPAIGN_EVENT_DEFINITIONS: readonly EventDefinition[] = [
  {
    id: 'new-year',
    name: 'Ano-Novo / Confraternização Universal',
    dateForYear: (year) => isoDate(year, 1, 1),
    audiences: ALL_AUDIENCES,
    preparationDays: 14,
    followUpDays: 1,
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/2002/l10607.htm',
    note: 'Feriado nacional. Use apenas como contexto de organização e celebração; não presuma demanda.',
  },
  {
    id: 'mothers-day',
    name: 'Dia das Mães',
    dateForYear: (year) => nthWeekday(year, 5, 0, 2),
    audiences: ['domestica', 'natal'],
    preparationDays: 21,
    followUpDays: 1,
    sourceUrl:
      'https://legislacao.presidencia.gov.br/atos/?ano=1932&ato=a9c0TQE5ENBpXT488&numero=21366&tipo=DEC',
    note: 'Segundo domingo de maio. Sugestões de presente exigem destinatário claro e revisão.',
  },
  {
    id: 'fathers-day',
    name: 'Dia dos Pais',
    dateForYear: (year) => nthWeekday(year, 8, 0, 2),
    audiences: ['masculino', 'natal'],
    preparationDays: 21,
    followUpDays: 1,
    sourceUrl:
      'https://procon.pb.gov.br/noticias/em-virtude-da-proximidade-do-201cdia-dos-pais201d-o-procon-pb-oferece-dicas-valiosas-na-hora-de-homenagear-o-seu-heroi',
    note: 'Segundo domingo de agosto. Sugestões de presente exigem destinatário claro e revisão.',
  },
  {
    id: 'world-animal-day',
    name: 'Dia Mundial dos Animais',
    dateForYear: (year) => isoDate(year, 10, 4),
    audiences: ['pet'],
    preparationDays: 10,
    followUpDays: 1,
    sourceUrl:
      'https://saude.sp.gov.br/coordenadoria-de-defesa-e-saude-animal/noticias/dia-mundial-dos-animais',
    note: 'Data de conscientização. Não autoriza medicamentos, alegações de saúde ou urgência.',
  },
  {
    id: 'black-friday',
    name: 'Black Friday',
    dateForYear: blackFriday,
    audiences: ALL_AUDIENCES,
    preparationDays: 21,
    followUpDays: 2,
    sourceUrl:
      'https://www.ba.gov.br/justica/sites/site-sjdh/files/2024-11/copy2_of_CartilhaSenaconBlackFriday12.pdf',
    note: 'Sexta-feira após a quarta quinta-feira de novembro. A data não comprova desconto real.',
  },
  {
    id: 'christmas',
    name: 'Natal',
    dateForYear: (year) => isoDate(year, 12, 25),
    audiences: GIFT_AUDIENCES,
    preparationDays: 45,
    followUpDays: 2,
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/2002/l10607.htm',
    note: 'Feriado nacional. Nunca presuma estoque ou entrega antes do Natal.',
  },
] as const

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Calendar date must use YYYY-MM-DD')
  const parsed = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid calendar date')
  }
  return parsed
}

function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000)
}

function boundedDays(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 0 || value > 90)
    throw new Error('Event window must be 0-90 days')
  return value
}

export function smartCampaignCalendarContext(
  date: string,
  audienceSlugs: NicheSlug[],
  customEvents: SmartCampaignCustomEvent[] = [],
): SmartCampaignCalendarContext {
  const localDate = parseDate(date)
  const audiences = new Set(audienceSlugs)
  const years = [
    localDate.getUTCFullYear() - 1,
    localDate.getUTCFullYear(),
    localDate.getUTCFullYear() + 1,
  ]
  const candidates: Array<
    Omit<SmartCampaignCalendarEvent, 'timing' | 'daysUntil'> & {
      preparationDays: number
      followUpDays: number
    }
  > = SMART_CAMPAIGN_EVENT_DEFINITIONS.flatMap((definition) =>
    years.map((year) => ({
      id: definition.id,
      name: definition.name,
      date: definition.dateForYear(year),
      audiences: definition.audiences,
      sourceUrl: definition.sourceUrl,
      sourceKind: 'official' as const,
      preparationDays: definition.preparationDays,
      followUpDays: definition.followUpDays,
      note: definition.note,
    })),
  )

  for (const event of customEvents) {
    parseDate(event.date)
    if (!event.id.trim() || !event.name.trim())
      throw new Error('Custom event id and name are required')
    candidates.push({
      id: event.id.trim(),
      name: event.name.trim(),
      date: event.date,
      audiences: event.audiences?.length ? event.audiences : [...audiences],
      sourceUrl: event.sourceUrl,
      sourceKind: 'user',
      preparationDays: boundedDays(event.preparationDays, 14),
      followUpDays: boundedDays(event.followUpDays, 1),
      note:
        event.note?.trim() ||
        'Evento informado pelo usuário; validar contexto e alegações manualmente.',
    })
  }

  const events = candidates
    .filter((event) => event.audiences.some((slug) => audiences.has(slug)))
    .map((event) => ({ event, daysUntil: daysBetween(date, event.date) }))
    .filter(
      ({ event, daysUntil }) =>
        daysUntil <= event.preparationDays && daysUntil >= -event.followUpDays,
    )
    .sort((left, right) => {
      const leftDistance = Math.abs(left.daysUntil)
      const rightDistance = Math.abs(right.daysUntil)
      return leftDistance - rightDistance || left.event.date.localeCompare(right.event.date)
    })
    .slice(0, 3)
    .map(({ event, daysUntil }) => ({
      id: event.id,
      name: event.name,
      date: event.date,
      audiences: event.audiences.filter((slug) => audiences.has(slug)),
      sourceUrl: event.sourceUrl,
      sourceKind: event.sourceKind,
      timing:
        daysUntil === 0
          ? ('today' as const)
          : daysUntil > 0
            ? ('upcoming' as const)
            : ('after' as const),
      daysUntil,
      note: event.note,
    }))

  return {
    localDate: date,
    timezone: SMART_CAMPAIGN_TIMEZONE,
    weekday: new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      timeZone: SMART_CAMPAIGN_TIMEZONE,
    }).format(localDate),
    events,
    caveat:
      'Contexto determinístico de calendário, não sinal de demanda ao vivo. Não presume preço, estoque, prazo de entrega ou legalidade regional.',
  }
}
