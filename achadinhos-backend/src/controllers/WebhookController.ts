import { Request, Response } from 'express'
import { injectable, inject } from 'tsyringe'
import { ConnectionService } from '@/services/ConnectionService'
import { GroupMessageService } from '@/services/GroupMessageService'
import { logger } from '@/utils/logger'

/**
 * Public endpoint UAZAPI calls for a connection's events. It carries no auth —
 * the connection uuid in the path is the shared secret. We always answer 200
 * so UAZAPI does not retry; ingestion failures are logged, not surfaced.
 */
@injectable()
export class WebhookController {
  constructor(
    @inject(ConnectionService) private connectionService: ConnectionService,
    @inject(GroupMessageService) private groupMessageService: GroupMessageService,
  ) {}

  /** POST /webhook/uazapi/:uuid */
  async ingest(req: Request, res: Response): Promise<void> {
    const uuid = req.params.uuid
    try {
      const scope = await this.connectionService.resolveScopeByUuid(uuid)
      if (!scope) {
        // Unknown/unprovisioned connection — acknowledge and drop.
        res.status(200).json({ success: true, ignored: true })
        return
      }
      const stored = await this.groupMessageService.ingestWebhook(scope, req.body)
      res.status(200).json({ success: true, stored })
    } catch (error) {
      logger.warn({ error, uuid }, 'Webhook ingestion error (acknowledged anyway)')
      res.status(200).json({ success: true, stored: 0 })
    }
  }
}
