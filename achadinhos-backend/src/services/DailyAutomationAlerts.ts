import { createHash, randomUUID } from 'node:crypto'
import { injectable, inject } from 'tsyringe'
import { QueryTypes } from 'sequelize'
import { sequelize } from '@/database'
import { ConnectionService } from '@/services/ConnectionService'
import { GroupService } from '@/services/GroupService'
import { UazapiClient } from '@/channels/uazapi/UazapiClient'
import { dailyWindow, type DailyAutomationConfig } from '@/config/dailyAutomation'
import { dailyPlanCoverage } from '@/utils/dailyPlanCoverage'
import { logger } from '@/utils/logger'

interface PendingAlert { id: string; group_id: string; body: string }

@injectable()
export class DailyAutomationAlerts {
  constructor(
    @inject(ConnectionService) private readonly connections: ConnectionService,
    @inject(GroupService) private readonly groups: GroupService,
    @inject(UazapiClient) private readonly provider: UazapiClient,
  ) {}

  async enqueue(config: DailyAutomationConfig, date: string, key: string, code: string, detail = ''): Promise<void> {
    if (!config.alertGroupId) return
    // Caller supplies typed codes/counts only. Never include an exception, request,
    // URL, browser page, cookie, credential, or provider response in the message.
    if (code === 'READY') return // Operational problems only; no routine status chatter.
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(code) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    // Extract only a bounded vocabulary of operational facts, never arbitrary text.
    const facts = detail.match(/(?:domestica|masculino)|(?:selected|required|missing|unknown|failed|skipped)=\d{1,6}\b|deadline=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|-03:00)|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)?.slice(0, 30).join(' ') ?? ''
    const body = `⚠️ Espia — operação de ${date}\nCódigo: ${code}\n${facts}\nJanela: ${config.startTime}–${config.endTime} (São Paulo).\nVerifique o painel Smart e os logs do worker. A automação não contorna filtros ou repete envios incertos.`
    await sequelize.query(`INSERT INTO daily_automation_alerts(id,user_id,event_key,group_id,body)
      VALUES(:id,:userId,:key,:groupId,:body) ON CONFLICT(user_id,event_key) DO NOTHING`, {
      replacements: { id: randomUUID(), userId: config.userId, key: `${date}:${code}:${createHash('sha256').update(key).digest('hex')}`, groupId: config.alertGroupId, body },
    })
  }

  async monitor(config: DailyAutomationConfig, now = new Date()): Promise<void> {
    if (!config.alertGroupId) return
    const today = dailyWindow(config, now).date
    const rows = await sequelize.query<{ uuid: string; date: string; status: string; unknown: number; failed: number; skipped: number }>(
      `SELECT p.uuid, p.start_date::text AS date, p.status,
        COUNT(*) FILTER(WHERE s.status='UNKNOWN')::int AS unknown,
        COUNT(*) FILTER(WHERE s.status='FAILED')::int AS failed,
        COUNT(*) FILTER(WHERE s.status='SKIPPED')::int AS skipped
      FROM smart_plans p LEFT JOIN smart_sends s ON s.plan_id=p.id
      WHERE p.user_id=:userId AND p.settings ? 'dailyAutomation'
        AND p.start_date BETWEEN CAST(:today AS DATE)-1 AND CAST(:today AS DATE)+1 AND p.status<>'CANCELLED'
      GROUP BY p.id`, { replacements: { userId: config.userId, today }, type: QueryTypes.SELECT },
    )
    for (const row of rows) {
      for (const code of [row.unknown ? 'SEND_UNKNOWN' : null, row.failed ? 'SEND_FAILED' : null,
        row.skipped ? 'DELIVERY_GAPS' : null, row.status === 'PAUSED' ? 'PLAN_PAUSED' : null,
        row.status === 'FAILED' ? 'SMART_ANALYSIS_FAILED' : null]) {
        if (code) await this.enqueue(config, row.date, `${row.uuid}:${code}`, code,
          `${row.uuid} unknown=${row.unknown} failed=${row.failed} skipped=${row.skipped}`)
      }
    }
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(now)
    const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
    // Warn before the sending window, even when collection or paid AI is stuck.
    if (minutes(time) >= minutes(config.startTime) - 30 && time < config.endTime &&
      (!config.weekdaysOnly || !['Sat', 'Sun'].includes(new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, weekday: 'short' }).format(now)))) {
      const plans = await sequelize.query<{ uuid: string; status: string; items: Parameters<typeof dailyPlanCoverage>[0] }>(
        `SELECT uuid,status,items FROM smart_plans WHERE user_id=:userId AND start_date=CAST(:today AS DATE)
         AND settings ? 'dailyAutomation' AND status<>'CANCELLED' ORDER BY created_at DESC LIMIT 1`,
        { replacements: { userId: config.userId, today }, type: QueryTypes.SELECT })
      const plan = plans[0]
      const coverage = dailyPlanCoverage(plan?.items ?? [], config, today)
      const code = !coverage.ready ? 'PRE_SEND_PLAN_INCOMPLETE' : plan?.status === 'REVIEW' ? 'MANUAL_APPROVAL_REQUIRED' : null
      if (code) await this.enqueue(config, today, `readiness:${code}`, code,
        `${plan?.uuid ?? ''} ${coverage.audiences.map(a => `${a.slug} selected=${a.selected} required=${a.required} missing=${a.missing}`).join('; ')} deadline=${today}T${config.startTime}:00-03:00`)
    }
  }

  async dispatch(config: DailyAutomationConfig): Promise<void> {
    if (!config.alertGroupId) return
    // A crashed transport might have succeeded. Preserve uncertainty; no replay.
    await sequelize.query("UPDATE daily_automation_alerts SET status='UNKNOWN',updated_at=NOW() WHERE user_id=:userId AND status='SENDING' AND updated_at<NOW()-INTERVAL '5 minutes'", { replacements: { userId: config.userId } })
    const pending = await sequelize.query<PendingAlert>("SELECT id,group_id,body FROM daily_automation_alerts WHERE user_id=:userId AND status='PENDING' AND next_attempt_at<=NOW() ORDER BY created_at LIMIT 5", { replacements: { userId: config.userId }, type: QueryTypes.SELECT })
    for (const alert of pending) {
      let credentials: Awaited<ReturnType<ConnectionService['requireConnectedCreds']>>
      try {
        credentials = await this.connections.requireConnectedCreds(config.userId)
        await this.groups.requireCurrentGroups(config.userId, [alert.group_id])
      } catch {
        await sequelize.query("UPDATE daily_automation_alerts SET preflight_attempts=preflight_attempts+1, next_attempt_at=NOW()+LEAST(900,30*POWER(2,LEAST(preflight_attempts,5)))*INTERVAL '1 second',updated_at=NOW() WHERE id=:id AND status='PENDING'", { replacements: { id: alert.id } })
        continue
      }
      const claimed = await sequelize.query<{ id: string }>("UPDATE daily_automation_alerts SET status='SENDING',updated_at=NOW() WHERE id=:id AND status='PENDING' RETURNING id", { replacements: { id: alert.id }, type: QueryTypes.SELECT })
      if (!claimed.length) continue
      try {
        const result = await this.provider.sendText(credentials, { number: alert.group_id, text: alert.body, linkPreview: false })
        const candidate = result.messageid ?? result.messageId ?? result.id
        const messageId = typeof candidate === 'string' && candidate.trim() ? candidate.slice(0, 200) : null
        await sequelize.query("UPDATE daily_automation_alerts SET status=:status,provider_message_id=:messageId,updated_at=NOW() WHERE id=:id AND status='SENDING'", { replacements: { id: alert.id, status: messageId ? 'SENT' : 'UNKNOWN', messageId: messageId ?? null } })
      } catch {
        await sequelize.query("UPDATE daily_automation_alerts SET status='UNKNOWN',updated_at=NOW() WHERE id=:id AND status='SENDING'", { replacements: { id: alert.id } })
        logger.warn({ alertId: alert.id }, 'Daily alert transport uncertain; not replaying')
      }
    }
  }
}
