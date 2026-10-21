import { QueryTypes, type Sequelize } from 'sequelize'
import { z } from 'zod'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Data inválida')
const positiveInteger = z.string().regex(/^[1-9]\d*$/).transform(Number)
  .pipe(z.number().int().positive().safe())

// Pagination and filters are opt-in, so existing callers keep the array response.
export const SmartPlanHistoryQuerySchema = z.object({
  summary: z.enum(['true', 'false']).optional(),
  page: positiveInteger.optional(),
  pageSize: positiveInteger.pipe(z.number().max(100)).optional(),
  status: z.enum(['ANALYZING', 'REVIEW', 'SCHEDULED', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
  dateFrom: date.optional(),
  dateTo: date.optional(),
}).superRefine((query, context) => {
  if (query.summary !== 'true' && [query.page, query.pageSize, query.status, query.dateFrom, query.dateTo].some((value) => value !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['summary'], message: 'Filtros e paginação exigem summary=true' })
  }
  if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['dateTo'], message: 'dateTo deve ser igual ou posterior a dateFrom' })
  }
  if (!Number.isSafeInteger((query.page ?? 1) * (query.pageSize ?? 20))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['page'], message: 'Página fora do intervalo suportado' })
  }
}).transform((query) => query.summary === 'true' ? {
  summary: true as const,
  page: query.page ?? 1,
  pageSize: query.pageSize ?? 20,
  status: query.status,
  dateFrom: query.dateFrom,
  dateTo: query.dateTo,
} : undefined)

export type SmartPlanHistoryQuery = Exclude<z.output<typeof SmartPlanHistoryQuerySchema>, undefined>

interface SmartPlanSummary {
  id: string
  uuid: string
  status: string
  revision: number
  startDate: string
  date: string
  days: number
  timezone: string
  audienceSlugs: string[]
  audiences: string[]
  itemCount: number
  sendSummary: Record<'PENDING' | 'SENDING' | 'SENT' | 'SKIPPED' | 'FAILED' | 'UNKNOWN', number>
  approvedAt: Date | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export async function listSmartPlanHistory(
  database: Pick<Sequelize, 'query'>,
  userId: number,
  query: SmartPlanHistoryQuery,
) {
  const predicates = ['p.user_id = :userId']
  if (query.status) predicates.push('p.status = :status')
  if (query.dateFrom) predicates.push('p.start_date >= :dateFrom')
  if (query.dateTo) predicates.push('p.start_date <= :dateTo')
  const where = predicates.join(' AND ')
  // One snapshot for count + page, including an empty/out-of-range page. Only the
  // bounded page is joined to sends; no offer/input/settings payload is fetched.
  const rows = await database.query<SmartPlanSummary & { total: string }>(`
    WITH page AS MATERIALIZED (
      SELECT p.id AS plan_id, p.uuid, p.status, p.revision, p.start_date, p.days,
        p.timezone, p.audience_slugs, jsonb_array_length(p.items) AS item_count,
        p.approved_at, p.completed_at, p.created_at, p.updated_at
      FROM smart_plans p WHERE ${where}
      ORDER BY p.created_at DESC, p.id DESC LIMIT :limit OFFSET :offset
    ), delivery AS (
      SELECT s.plan_id, jsonb_build_object(
        'PENDING', count(*) FILTER (WHERE s.status = 'PENDING'),
        'SENDING', count(*) FILTER (WHERE s.status = 'SENDING'),
        'SENT', count(*) FILTER (WHERE s.status = 'SENT'),
        'SKIPPED', count(*) FILTER (WHERE s.status = 'SKIPPED'),
        'FAILED', count(*) FILTER (WHERE s.status = 'FAILED'),
        'UNKNOWN', count(*) FILTER (WHERE s.status = 'UNKNOWN')
      ) AS summary
      FROM smart_sends s JOIN page ON page.plan_id = s.plan_id
      WHERE s.user_id = :userId GROUP BY s.plan_id
    ), total AS (
      SELECT count(*) AS total FROM smart_plans p WHERE ${where}
    )
    SELECT total.total, page.uuid AS id, page.uuid, page.status, page.revision,
      page.start_date AS "startDate", page.start_date AS date, page.days, page.timezone,
      page.audience_slugs AS "audienceSlugs", page.audience_slugs AS audiences,
      page.item_count AS "itemCount", page.approved_at AS "approvedAt",
      page.completed_at AS "completedAt", page.created_at AS "createdAt",
      page.updated_at AS "updatedAt",
      COALESCE(delivery.summary, '{"PENDING":0,"SENDING":0,"SENT":0,"SKIPPED":0,"FAILED":0,"UNKNOWN":0}'::jsonb) AS "sendSummary"
    FROM total LEFT JOIN page ON true LEFT JOIN delivery ON delivery.plan_id = page.plan_id
    ORDER BY page.created_at DESC, page.plan_id DESC
  `, {
    type: QueryTypes.SELECT,
    replacements: {
      userId,
      status: query.status,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    },
  })
  const total = Number(rows[0]?.total ?? 0)
  const plans = rows.filter((row) => row.uuid !== null).map(({ total: _total, ...plan }) => plan)
  return { plans, page: query.page, pageSize: query.pageSize, total, hasMore: query.page * query.pageSize < total }
}
