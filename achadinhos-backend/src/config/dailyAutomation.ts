import { z } from 'zod'

interface CadenceConfig {
  startTime: string
  endTime: string
  minIntervalMinutes: number
  maxIntervalMinutes: number
  requireFullWindow: boolean
}

function bufferedCadence(config: CadenceConfig) {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  const duration = (minutes(config.endTime) - minutes(config.startTime)) * 60 - 120
  const capacity = Math.max(
    0,
    Math.min(50, Math.floor(duration / (config.minIntervalMinutes * 60)) + 1),
  )
  const minimum = config.requireFullWindow
    ? Math.max(1, Math.ceil(duration / (config.maxIntervalMinutes * 60)) + 1)
    : 1
  const desired =
    Math.floor(duration / ((config.minIntervalMinutes + config.maxIntervalMinutes) * 30)) + 1
  return { capacity, minimum, target: Math.min(capacity, Math.max(minimum, desired)) }
}

export const DailyAutomationConfigSchema = z
  .object({
    userId: z.number().int().positive(),
    planningDaysAhead: z.number().int().min(0).max(1).default(1),
    alertGroupId: z.string().trim().max(120).regex(/^\d+@g\.us$/).optional(),
    timezone: z.literal('America/Sao_Paulo').default('America/Sao_Paulo'),
    collectTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default('19:00'),
    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default('08:00'),
    endTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default('19:00'),
    minIntervalMinutes: z.number().int().min(20).max(25).default(20),
    maxIntervalMinutes: z.number().int().min(20).max(25).default(25),
    candidateLimit: z.number().int().min(1).max(250).default(250),
    repeatCooldownDays: z.number().int().min(0).max(3650).refine(days => days === 0 || days >= 7).default(30),
    minRating: z.number().min(0).max(5).default(4.5),
    minSoldCount: z.number().int().min(1).max(1_000_000).default(100),
    minFitScore: z.number().min(70).max(100).default(75),
    minCommercialScore: z.number().min(0).max(100).default(60),
    requireFullWindow: z.boolean().default(true),
    maxStandouts: z.number().int().min(0).max(10).default(0),
    weekdaysOnly: z.boolean().default(false),
    autoApprove: z.boolean().default(false),
  })
  .strict()
  .superRefine((config, context) => {
    if (
      (config.planningDaysAhead === 0 && config.collectTime > config.startTime) ||
      (config.planningDaysAhead === 1 && config.collectTime < config.endTime) ||
      config.startTime >= config.endTime ||
      config.endTime > '21:00'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Require startTime < endTime <= 21:00; D+1 collectTime >= endTime; same-day collectTime <= startTime',
      })
    }
    if (config.minIntervalMinutes > config.maxIntervalMinutes)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Minimum interval must not exceed maximum',
      })
    const cadence = bufferedCadence(config)
    if (cadence.capacity < 1 || (config.requireFullWindow && cadence.minimum > cadence.capacity))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The full window cannot fit this cadence with its two-minute end buffer',
      })
  })

export type DailyAutomationConfig = z.infer<typeof DailyAutomationConfigSchema>

export function dailyItemTarget(config: DailyAutomationConfig): number {
  return bufferedCadence(config).target
}

export function dailyMinimumItems(config: DailyAutomationConfig): number {
  return bufferedCadence(config).minimum
}

export function dailyRequiredItems(config: DailyAutomationConfig): number {
  return config.requireFullWindow && config.planningDaysAhead === 1 ? dailyItemTarget(config) : dailyMinimumItems(config)
}

export function dailyCandidateTarget(config: DailyAutomationConfig): number {
  return Math.min(config.candidateLimit, Math.max(50, dailyRequiredItems(config) * 4))
}

export function dailyDateOffset(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function dailyRemainingCapacity(config: DailyAutomationConfig, now = new Date(), targetDate?: string): number {
  if (targetDate && targetDate > dailyWindow(config, now).date) return bufferedCadence(config).capacity
  if (targetDate && targetDate < dailyWindow(config, now).date) return 0
  const seconds = (time: string) =>
    Number(time.slice(0, 2)) * 3600 + Number(time.slice(3, 5)) * 60 + Number(time.slice(6) || 0)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(now)
  const earliest = Math.max(seconds(config.startTime), Math.ceil(seconds(time) / 60) * 60)
  return Math.max(
    0,
    Math.floor((seconds(config.endTime) - 120 - earliest) / (config.minIntervalMinutes * 60)) + 1,
  )
}

export function readDailyAutomationConfig(): DailyAutomationConfig | null {
  if (process.env.DAILY_AUTOMATION_ENABLED !== 'true') return null
  return DailyAutomationConfigSchema.parse(JSON.parse(process.env.DAILY_AUTOMATION_CONFIG ?? '{}'))
}

export function dailyWindow(config: DailyAutomationConfig, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now)
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === name)!.value
  const date = `${part('year')}-${part('month')}-${part('day')}`
  const time = `${part('hour')}:${part('minute')}`
  const targetDate = dailyDateOffset(date, config.planningDaysAhead ?? 0)
  const targetWeekday = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, weekday: 'short' })
    .format(new Date(`${targetDate}T12:00:00Z`))
  return {
    date,
    targetDate,
    due:
      time >= config.collectTime &&
      ((config.planningDaysAhead ?? 0) === 1 || time < config.endTime) &&
      (!config.weekdaysOnly || !['Sat', 'Sun'].includes(targetWeekday)),
  }
}
