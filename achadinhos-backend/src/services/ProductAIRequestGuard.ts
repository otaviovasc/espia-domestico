import { createHash } from 'node:crypto'
import { Op, QueryTypes, Transaction } from 'sequelize'
import { env } from '@/config/env'
import { sequelize } from '@/database'
import { SMART_AI_REQUEST_STATUS, SmartAIRequest } from '@/database/models/SmartAIRequest'
import { AppError, BadRequestError } from '@/middleware/Error/AppError'

export interface AIRequestContext {
  userId: number
  /** Correlates an explicit user action without affecting semantic deduplication. */
  operationId?: string
  /** Explicit retry generation. A failed uncertain attempt is never auto-replayed. */
  retryAttempt?: number
}

export interface AIProviderUsage {
  inputTokens?: number
  outputTokens?: number
}

export interface GuardedProviderResult<T> {
  value: T
  usage?: AIProviderUsage
}

export interface GuardedAIRequest<T> {
  context: AIRequestContext
  operation: string
  model: string
  modelVersion: string
  /** Semantic facts only. Do not include prices, affiliate links, or credentials. */
  semanticInput: unknown
  /** Exact bounded text sent to the provider, used only for conservative estimation. */
  providerInput: string
  maxOutputTokens: number
  /** Re-validates persisted JSON before returning it to application code. */
  validate: (value: unknown) => T
  execute: () => Promise<GuardedProviderResult<T>>
}

export interface AIRequestGuardConfig {
  dailyRequestLimit: number
  dailyInputTokenLimit: number
  dailyOutputTokenLimit: number
  dailyCostLimitMicros: number
  globalDailyCostLimitMicros: number
  requestCostLimitMicros: number
  maxInputTokens: number
  maxOutputTokens: number
  inputCostUsdPerMillion: number
  outputCostUsdPerMillion: number
  cacheTtlHours: number
}

interface ReservationInput {
  context: AIRequestContext
  operation: string
  model: string
  modelVersion: string
  cacheKey: string
  requestKey: string
  quotaDate: string
  reservedInputTokens: number
  reservedOutputTokens: number
  reservedCostMicros: number
  cacheExpiresAt: Date
}

export type ReservationResult =
  { kind: 'cached'; value: unknown } | { kind: 'reserved'; id: number }

export interface AIRequestLedger {
  reserve(input: ReservationInput, config: AIRequestGuardConfig): Promise<ReservationResult>
  succeed(
    id: number,
    value: unknown,
    usage: AIProviderUsage | undefined,
    accountedCostMicros: number,
  ): Promise<void>
  failUnknown(id: number): Promise<void>
}

export function productAIRequestGuardConfig(): AIRequestGuardConfig {
  return {
    dailyRequestLimit: env.AI_DAILY_REQUEST_LIMIT,
    dailyInputTokenLimit: env.AI_DAILY_INPUT_TOKEN_LIMIT,
    dailyOutputTokenLimit: env.AI_DAILY_OUTPUT_TOKEN_LIMIT,
    dailyCostLimitMicros: Math.floor(env.AI_DAILY_COST_LIMIT_USD * 1_000_000),
    globalDailyCostLimitMicros: Math.floor(env.AI_GLOBAL_DAILY_COST_LIMIT_USD * 1_000_000),
    requestCostLimitMicros: Math.floor(env.AI_REQUEST_COST_LIMIT_USD * 1_000_000),
    maxInputTokens: env.AI_MAX_INPUT_TOKENS,
    maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
    inputCostUsdPerMillion: env.AI_INPUT_COST_USD_PER_MILLION,
    outputCostUsdPerMillion: env.AI_OUTPUT_COST_USD_PER_MILLION,
    cacheTtlHours: env.AI_CACHE_TTL_HOURS,
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Conservative tokenizer-independent reservation: UTF-8 bytes plus fixed chat/schema overhead.
 * This intentionally over-reserves Portuguese text rather than undercounting provider tokens.
 */
export function estimateAIInputTokens(providerInput: string): number {
  return Buffer.byteLength(providerInput, 'utf8') + 4_096
}

function estimatedCostMicros(
  inputTokens: number,
  outputTokens: number,
  config: AIRequestGuardConfig,
): number {
  // tokens × USD/million is numerically equal to micro-dollars.
  return Math.ceil(
    inputTokens * config.inputCostUsdPerMillion + outputTokens * config.outputCostUsdPerMillion,
  )
}

function quotaError(message: string): AppError {
  return new AppError(message, 429, 'AI_DAILY_BUDGET_EXCEEDED')
}

export class SequelizeAIRequestLedger implements AIRequestLedger {
  async reserve(input: ReservationInput, config: AIRequestGuardConfig): Promise<ReservationResult> {
    // Successful rows are immutable, so the common cache-hit path needs no quota locks.
    const existingCache = await SmartAIRequest.findOne({
      where: {
        userId: input.context.userId,
        cacheKey: input.cacheKey,
        status: SMART_AI_REQUEST_STATUS.SUCCEEDED,
        cacheExpiresAt: { [Op.gt]: new Date() },
      },
      order: [['completedAt', 'DESC']],
    })
    if (existingCache?.responsePayload !== null && existingCache?.responsePayload !== undefined) {
      return { kind: 'cached', value: existingCache.responsePayload }
    }

    return sequelize.transaction(
      { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
      async (transaction) => {
        // Always acquire the global lock before the tenant lock to avoid deadlocks while enforcing
        // both deployment-wide and per-tenant spend ceilings across API/worker processes.
        await sequelize.query('SELECT pg_advisory_xact_lock(741931, 1)', {
          type: QueryTypes.SELECT,
          transaction,
        })
        await sequelize.query('SELECT pg_advisory_xact_lock(741932, :userId)', {
          replacements: { userId: input.context.userId },
          type: QueryTypes.SELECT,
          transaction,
        })

        const cached = await SmartAIRequest.findOne({
          where: {
            userId: input.context.userId,
            cacheKey: input.cacheKey,
            status: SMART_AI_REQUEST_STATUS.SUCCEEDED,
            cacheExpiresAt: { [Op.gt]: new Date() },
          },
          order: [['completedAt', 'DESC']],
          transaction,
        })
        if (cached?.responsePayload !== null && cached?.responsePayload !== undefined) {
          return { kind: 'cached', value: cached.responsePayload }
        }

        const duplicate = await SmartAIRequest.findOne({
          where: { userId: input.context.userId, requestKey: input.requestKey },
          transaction,
        })
        if (duplicate) {
          // Unknown outcomes deliberately retain their reservation. Repeating automatically could
          // double-charge after a provider timeout whose response was lost.
          throw new AppError(
            'Esta solicitação de IA já está em andamento ou teve resultado incerto. Tente outra operação mais tarde.',
            409,
            'AI_REQUEST_ALREADY_RESERVED',
          )
        }

        const rows = await SmartAIRequest.findAll({
          where: { userId: input.context.userId, quotaDate: input.quotaDate },
          attributes: [
            'reservedInputTokens',
            'reservedOutputTokens',
            'reservedCostMicros',
            'actualInputTokens',
            'actualOutputTokens',
            'accountedCostMicros',
          ],
          transaction,
        })
        const usage = rows.reduce(
          (total, row) => ({
            input: total.input + Number(row.actualInputTokens ?? row.reservedInputTokens),
            output: total.output + Number(row.actualOutputTokens ?? row.reservedOutputTokens),
            cost: total.cost + Number(row.accountedCostMicros ?? row.reservedCostMicros),
          }),
          { input: 0, output: 0, cost: 0 },
        )
        if (rows.length + 1 > config.dailyRequestLimit)
          throw quotaError('Limite diário de solicitações de IA atingido.')
        if (usage.input + input.reservedInputTokens > config.dailyInputTokenLimit)
          throw quotaError('Limite diário de tokens de entrada da IA atingido.')
        if (usage.output + input.reservedOutputTokens > config.dailyOutputTokenLimit)
          throw quotaError('Limite diário de tokens de saída da IA atingido.')
        if (usage.cost + input.reservedCostMicros > config.dailyCostLimitMicros)
          throw quotaError('Limite diário de custo da IA atingido.')

        const [globalUsage] = await sequelize.query<{ cost: string }>(
          `SELECT COALESCE(SUM(COALESCE(accounted_cost_micros, reserved_cost_micros)), 0)::text AS cost
             FROM smart_ai_requests
            WHERE quota_date = :quotaDate`,
          {
            replacements: { quotaDate: input.quotaDate },
            type: QueryTypes.SELECT,
            transaction,
          },
        )
        const globalCost = Number(globalUsage?.cost ?? 0)
        if (!Number.isSafeInteger(globalCost)) {
          throw new AppError(
            'Não foi possível verificar o orçamento global da IA.',
            503,
            'AI_BUDGET_UNAVAILABLE',
          )
        }
        if (globalCost + input.reservedCostMicros > config.globalDailyCostLimitMicros)
          throw quotaError('Limite diário global de custo da IA atingido.')

        const created = await SmartAIRequest.create(
          {
            userId: input.context.userId,
            requestKey: input.requestKey,
            cacheKey: input.cacheKey,
            operation: input.operation,
            operationId: input.context.operationId ?? null,
            model: input.model,
            modelVersion: input.modelVersion,
            quotaDate: input.quotaDate,
            reservedInputTokens: input.reservedInputTokens,
            reservedOutputTokens: input.reservedOutputTokens,
            reservedCostMicros: input.reservedCostMicros,
            cacheExpiresAt: input.cacheExpiresAt,
          },
          { transaction },
        )
        return { kind: 'reserved', id: Number(created.id) }
      },
    )
  }

  async succeed(
    id: number,
    value: unknown,
    usage: AIProviderUsage | undefined,
    accountedCostMicros: number,
  ): Promise<void> {
    await SmartAIRequest.update(
      {
        status: SMART_AI_REQUEST_STATUS.SUCCEEDED,
        responsePayload: value as never,
        actualInputTokens: usage?.inputTokens ?? null,
        actualOutputTokens: usage?.outputTokens ?? null,
        accountedCostMicros,
        completedAt: new Date(),
      },
      { where: { id, status: SMART_AI_REQUEST_STATUS.RESERVED } },
    )
  }

  async failUnknown(id: number): Promise<void> {
    await SmartAIRequest.update(
      { status: SMART_AI_REQUEST_STATUS.FAILED_UNKNOWN, completedAt: new Date() },
      { where: { id, status: SMART_AI_REQUEST_STATUS.RESERVED } },
    )
  }
}

export class ProductAIRequestGuard {
  constructor(
    private readonly ledger: AIRequestLedger = new SequelizeAIRequestLedger(),
    private readonly config: AIRequestGuardConfig = productAIRequestGuardConfig(),
  ) {}

  async run<T>(request: GuardedAIRequest<T>): Promise<T> {
    if (!Number.isSafeInteger(request.context?.userId) || request.context.userId <= 0) {
      throw new AppError(
        'Contexto do usuário é obrigatório antes de chamar a IA.',
        500,
        'AI_CONTEXT_REQUIRED',
      )
    }
    if (request.context.operationId && request.context.operationId.length > 120) {
      throw BadRequestError('Identificador da operação é muito longo.')
    }
    if (
      request.context.retryAttempt !== undefined &&
      (!Number.isSafeInteger(request.context.retryAttempt) || request.context.retryAttempt < 0)
    ) {
      throw BadRequestError('Tentativa da solicitação de IA inválida.')
    }
    if (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1) {
      throw BadRequestError('Limite de saída da IA inválido.')
    }
    const inputTokens = estimateAIInputTokens(request.providerInput)
    if (inputTokens > this.config.maxInputTokens) {
      throw new AppError('Entrada excede o limite seguro da IA.', 413, 'AI_INPUT_TOO_LARGE')
    }
    if (request.maxOutputTokens > this.config.maxOutputTokens) {
      throw new AppError(
        'Saída solicitada excede o limite seguro da IA.',
        422,
        'AI_OUTPUT_TOO_LARGE',
      )
    }
    if (this.config.inputCostUsdPerMillion <= 0 || this.config.outputCostUsdPerMillion <= 0) {
      throw new AppError(
        'Configure os tetos estáticos de preço do modelo antes de habilitar a IA.',
        503,
        'AI_COST_CONFIG_REQUIRED',
      )
    }
    const costMicros = estimatedCostMicros(inputTokens, request.maxOutputTokens, this.config)
    if (costMicros > this.config.requestCostLimitMicros) {
      throw new AppError(
        'Esta solicitação excede o teto de custo permitido.',
        422,
        'AI_REQUEST_COST_EXCEEDED',
      )
    }

    const quotaDate = new Date().toISOString().slice(0, 10)
    const cacheKey = digest(
      canonical({
        operation: request.operation,
        model: request.model,
        modelVersion: request.modelVersion,
        semanticInput: request.semanticInput,
      }),
    )
    const reservation = await this.ledger.reserve(
      {
        context: request.context,
        operation: request.operation,
        model: request.model,
        modelVersion: request.modelVersion,
        cacheKey,
        requestKey: digest(
          request.context.retryAttempt === undefined || request.context.retryAttempt === 0
            ? `${quotaDate}:${cacheKey}`
            : `${quotaDate}:${cacheKey}:attempt:${request.context.retryAttempt}`,
        ),
        quotaDate,
        reservedInputTokens: inputTokens,
        reservedOutputTokens: request.maxOutputTokens,
        reservedCostMicros: costMicros,
        cacheExpiresAt: new Date(Date.now() + this.config.cacheTtlHours * 3_600_000),
      },
      this.config,
    )
    if (reservation.kind === 'cached') return request.validate(reservation.value)

    try {
      const result = await request.execute()
      const actualInput = result.usage?.inputTokens ?? inputTokens
      const actualOutput = result.usage?.outputTokens ?? request.maxOutputTokens
      // Provider-independent accounting uses the configured price ceilings. It is deliberately
      // conservative and must not be presented as the provider's invoiced cost.
      const accountedCost = estimatedCostMicros(actualInput, actualOutput, this.config)
      await this.ledger.succeed(reservation.id, result.value, result.usage, accountedCost)
      return result.value
    } catch (error) {
      // Keep the full reservation on all provider/validation failures. The provider may have
      // charged even when the application never received a valid response.
      await this.ledger.failUnknown(reservation.id)
      throw error
    }
  }
}

export function assertProductAIEnabled(): void {
  if (!env.AI_ENABLED) {
    throw new AppError('A inteligência de produtos está desabilitada.', 503, 'AI_DISABLED')
  }
}
