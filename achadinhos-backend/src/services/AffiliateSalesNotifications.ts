import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { QueryTypes } from 'sequelize'
import { sequelize } from '@/database'
import { env } from '@/config/env'
import type { DailyAutomationConfig } from '@/config/dailyAutomation'
import { AffiliateSalesState, affiliateSalesStatus } from './AffiliateSalesState'
import { affiliateSalesSlot, type AffiliateSale } from './AffiliateSalesObserver'

const brl = (cents: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
const cents = (value: number | null): number => value === null ? 0 : Math.round(value * 100)
const title = (value: string): string => value.replace(/https?:\/\/\S+/gi, '').replace(/[\p{Cc}\p{Cf}*_~`<>]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)

/** Reported commissions are provisional; conflicting identities never produce a money sum. */
export function affiliateSalesNotice(sales: AffiliateSale[]): string | null {
  const active = [...new Map(sales.map(sale => [sale.key, sale])).values()].filter(sale => {
    if (sale.observationAmbiguous) return Boolean(sale.observationStatuses?.length) && sale.observationStatuses!.every(value => affiliateSalesStatus(value) !== 'cancelled')
    return affiliateSalesStatus(sale.status) !== 'cancelled'
  })
  if (!active.length) return null
  let saleCents = 0, commissionCents = 0, missingAmounts = 0, pending = 0, indirect = 0
  const products = new Map<string, { title: string; count: number; units: number; unknownUnits: boolean; saleCents: number; commissionCents: number; uncertain: boolean }>()
  for (const sale of active) {
    const uncertain = Boolean(sale.observationAmbiguous)
    if (!uncertain) { saleCents += cents(sale.saleValueBRL); commissionCents += cents(sale.commissionBRL) }
    if (uncertain || sale.saleValueBRL === null || sale.commissionBRL === null) missingAmounts++
    if (affiliateSalesStatus(sale.status) === 'pending') pending++
    if (!uncertain && sale.attribution === 'indirect') indirect++
    const product = products.get(sale.productId) ?? { title: title(sale.title) || sale.productId, count: 0, units: 0, unknownUnits: false, saleCents: 0, commissionCents: 0, uncertain: false }
    product.count++
    product.units += !uncertain ? sale.units ?? 0 : 0
    product.unknownUnits ||= uncertain || sale.units == null
    product.saleCents += !uncertain ? cents(sale.saleValueBRL) : 0
    product.commissionCents += !uncertain ? cents(sale.commissionBRL) : 0
    product.uncertain ||= uncertain || sale.saleValueBRL === null || sale.commissionBRL === null
    products.set(sale.productId, product)
  }
  const lines = [`🛒 *Novas vendas observadas — Mercado Livre*`, `${active.length} venda(s) · ${products.size} produto(s) · ${indirect} indireta(s)`,
    `Valor vendido informado: *${brl(saleCents)}*`, `Comissão informada: *${brl(commissionCents)}*`, `${pending} venda(s) em revisão. Comissões provisórias; não são valores recebidos.`, '']
  for (const product of [...products.values()]) lines.push(`• ${product.title} — ${product.count} venda(s)${product.unknownUnits ? '' : ` / ${product.units} un.`}\n  Venda ${brl(product.saleCents)} · comissão ${brl(product.commissionCents)}${product.uncertain ? ' (valores parciais/incertos)' : ''}`)
  if (missingAmounts) lines.push(`${missingAmounts} venda(s) com valores ausentes ou ambíguos: não somados integralmente.`)
  lines.push('Desde a última consulta completa; pode incluir vendas de dias anteriores recém-exibidas pelo painel.')
  return lines.join('\n')
}

export function affiliateSalesNoticeMessages(sales: AffiliateSale[]): string[] {
  const body = affiliateSalesNotice(sales)
  if (!body) return []
  const chunks: string[] = []
  let chunk = ''
  for (const line of body.split('\n')) {
    if (chunk.length + line.length > 2900) { chunks.push(chunk.trim()); chunk = '' }
    chunk += `${line}\n`
  }
  if (chunk.trim()) chunks.push(chunk.trim())
  return chunks.map((text, index) => chunks.length === 1 ? text : `📊 Resumo de vendas (${index + 1}/${chunks.length})\n${text}\nComissões provisórias; não representam pagamento.`)
}

export class AffiliateSalesNotifications {
  async tick(config: DailyAutomationConfig, now = new Date()): Promise<void> {
    const file = process.env.DAILY_BROWSER_STATE_PATH
    if (!file || !config.alertGroupId) return
    const slot = affiliateSalesSlot(now, env.DAILY_SALES_ALERT_INTERVAL_HOURS)
    const directory = path.join(path.dirname(file), '..', 'affiliate-sales', `account-${config.userId}`)
    const generation = await new AffiliateSalesState(directory, config.userId).readGeneration()
    if (!generation || generation.capture.reportRange.to !== slot.date || new Date(generation.capture.observedAt) < slot.start) return
    const observedAt = generation.capture.observedAt
    await sequelize.transaction(async transaction => {
      const inserted = await sequelize.query<{ user_id: number }>(`INSERT INTO affiliate_sales_notice_cursors(user_id,observed_at,generation_id)
        VALUES(:userId,:observedAt,:generationId) ON CONFLICT DO NOTHING RETURNING user_id`, {
        replacements: { userId: config.userId, observedAt, generationId: generation.capture.generationId }, type: QueryTypes.SELECT, transaction })
      // Establish a silent baseline: never announce the initial 90-day history as new sales.
      if (inserted.length) return
      const rows = await sequelize.query<{ observed_at: Date }>('SELECT observed_at FROM affiliate_sales_notice_cursors WHERE user_id=:userId FOR UPDATE', {
        replacements: { userId: config.userId }, type: QueryTypes.SELECT, transaction })
      const previous = new Date(rows[0].observed_at)
      if (new Date(observedAt) <= previous) return
      const messages = affiliateSalesNoticeMessages(generation.sales.filter(sale => new Date(sale.firstSeenAt) > previous))
      for (const [index, body] of messages.entries()) await sequelize.query(`INSERT INTO daily_automation_alerts(id,user_id,event_key,group_id,body)
        VALUES(:id,:userId,:key,:groupId,:body) ON CONFLICT(user_id,event_key) DO NOTHING`, {
        replacements: { id: randomUUID(), userId: config.userId, key: `sales:${generation.capture.generationId}:${index}`, groupId: config.alertGroupId, body }, transaction })
      await sequelize.query('UPDATE affiliate_sales_notice_cursors SET observed_at=:observedAt,generation_id=:generationId,updated_at=NOW() WHERE user_id=:userId', {
        replacements: { userId: config.userId, observedAt, generationId: generation.capture.generationId }, transaction })
    })
  }
}
