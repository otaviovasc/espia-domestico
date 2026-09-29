import { injectable, inject } from 'tsyringe'
import { UazapiClient, UazapiGroup } from '@/channels/uazapi/UazapiClient'
import { ConnectionService } from '@/services/ConnectionService'
import { BadRequestError } from '@/middleware/Error/AppError'

export interface GroupDTO {
  /** JID ending in @g.us — used directly as the send target. */
  id: string
  name: string
  size: number
  /** True when only admins can post (broadcaster must be admin). */
  announceOnly: boolean
}

/** Normalize UAZAPI's inconsistent field casing into a stable DTO. */
export function normalizeGroup(g: UazapiGroup): GroupDTO | null {
  const id = g.JID || g.jid || g.id
  if (!id || !String(id).endsWith('@g.us')) return null
  const name = g.Name || g.name || g.subject || '(sem nome)'
  const size = g.Size ?? g.size ?? g.participantsCount ?? 0
  const announceOnly = Boolean(g.announce ?? g.IsAnnounce ?? g.isAnnounce ?? false)
  return { id: String(id), name: String(name), size: Number(size) || 0, announceOnly }
}

@injectable()
export class GroupService {
  constructor(
    @inject(UazapiClient) private uazapi: UazapiClient,
    @inject(ConnectionService) private connectionService: ConnectionService,
  ) {}

  private async listAll(userId: number): Promise<GroupDTO[]> {
    const creds = await this.connectionService.requireConnectedCreds(userId)
    const pageSize = 500
    const maxGroups = 50_000
    const byId = new Map<string, GroupDTO>()

    let offset = 0
    while (offset < maxGroups) {
      const raw = await this.uazapi.listGroups(creds, {
        limit: pageSize,
        offset,
        noParticipants: true,
      })
      const before = byId.size
      for (const item of raw) {
        const group = normalizeGroup(item)
        if (group) byId.set(group.id, group)
      }
      if (raw.length === 0) break
      if (byId.size === before) {
        throw BadRequestError('Não foi possível validar toda a lista de grupos da conexão atual')
      }
      offset += raw.length
      if (offset >= maxGroups) {
        throw BadRequestError('A lista de grupos excede o limite seguro de validação')
      }
    }

    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** List the connected number's groups, sorted by name. */
  async listForUser(userId: number, search?: string): Promise<GroupDTO[]> {
    let groups = await this.listAll(userId)
    if (search && search.trim()) {
      const q = search.trim().toLowerCase()
      groups = groups.filter((g) => g.name.toLowerCase().includes(q))
    }
    return groups
  }

  /** Validate that every target still belongs to the user's current connection. */
  async requireCurrentGroups(
    userId: number,
    requestedIds: string[],
  ): Promise<Map<string, GroupDTO>> {
    const requested = new Set(requestedIds)
    const groups = await this.listAll(userId)
    const selected = new Map(
      groups.filter((group) => requested.has(group.id)).map((group) => [group.id, group]),
    )
    const missing = [...requested].filter((id) => !selected.has(id))
    if (missing.length) {
      throw BadRequestError(
        `A conexão atual não participa de ${missing.length} grupo(s) selecionado(s). Atualize os grupos antes de enviar.`,
      )
    }
    return selected
  }
}
