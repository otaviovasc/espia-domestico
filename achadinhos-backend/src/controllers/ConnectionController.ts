import { Request, Response } from 'express'
import { injectable, inject } from 'tsyringe'
import { z } from 'zod'
import { ConnectionService } from '@/services/ConnectionService'
import { UnauthorizedError, BadRequestError } from '@/middleware/Error/AppError'

const ConnectRequestSchema = z.object({
  // Optional phone (E.164 digits, no +) to use pairing-code flow instead of QR.
  pairingPhoneNumber: z
    .string()
    .regex(/^\d{10,15}$/, 'Número inválido (use apenas dígitos, com DDI)')
    .optional(),
})

const AttachExistingSchema = z.object({
  baseUrl: z.string().url('URL do servidor UAZAPI inválida'),
  instanceToken: z.string().min(8, 'Token da instância inválido'),
  instanceId: z.string().optional(),
})

@injectable()
export class ConnectionController {
  constructor(@inject(ConnectionService) private connectionService: ConnectionService) {}

  private userId(req: Request): number {
    if (!req.user) throw UnauthorizedError('Não autenticado')
    return req.user.userId
  }

  /** GET /connection — current status (creates nothing). */
  async status(req: Request, res: Response): Promise<void> {
    const result = await this.connectionService.refreshStatus(this.userId(req))
    res.json({ success: true, data: result })
  }

  /** POST /connection/connect — provision (if needed) + start QR/pair cycle. */
  async connect(req: Request, res: Response): Promise<void> {
    const parsed = ConnectRequestSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      throw BadRequestError(parsed.error.errors.map((e) => e.message).join(', '))
    }
    const result = await this.connectionService.connect(
      this.userId(req),
      parsed.data.pairingPhoneNumber,
    )
    res.json({ success: true, data: result })
  }

  /** POST /connection/disconnect */
  async disconnect(req: Request, res: Response): Promise<void> {
    await this.connectionService.disconnect(this.userId(req))
    res.json({ success: true })
  }

  /** POST /connection/attach — link to an existing UAZAPI instance (no QR). */
  async attachExisting(req: Request, res: Response): Promise<void> {
    const parsed = AttachExistingSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      throw BadRequestError(parsed.error.errors.map((e) => e.message).join(', '))
    }
    const result = await this.connectionService.attachExisting(this.userId(req), parsed.data)
    res.json({ success: true, data: result })
  }

  /** GET /connection/webhook — show configured vs expected webhook URL. */
  async webhookInfo(req: Request, res: Response): Promise<void> {
    const info = await this.connectionService.getWebhookInfo(this.userId(req))
    res.json({ success: true, data: info })
  }

  /** POST /connection/webhook — (re)register the webhook using current API_BASE_URL. */
  async updateWebhook(req: Request, res: Response): Promise<void> {
    const result = await this.connectionService.updateWebhook(this.userId(req))
    res.json({ success: true, data: result })
  }
}
