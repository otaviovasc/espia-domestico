import { injectable, inject } from 'tsyringe'
import { UazapiClient, UazapiGroup } from '@/channels/uazapi/UazapiClient'
import { ConnectionService } from '@/services/ConnectionService'

export interface GroupDTO {
  /** JID ending in @g.us — used directly as the send target. */
  id: string
  name: string
  size: number
  /** True when only admins can post (broadcaster must be admin). */
  announceOnly: boolean
}

/** Normalize UAZAPI's inconsistent field casing into a stable DTO. */
function normalizeGroup(g: UazapiGroup): GroupDTO | null {
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

  /** List the connected number's groups, sorted by name. */
  async listForUser(userId: number, search?: string): Promise<GroupDTO[]> {
    const creds = await this.connectionService.requireConnectedCreds(userId)
    const raw = await this.uazapi.listGroups(creds, { limit: 500, offset: 0, noParticipants: true })
    let groups = raw
      .map(normalizeGroup)
      .filter((g): g is GroupDTO => g !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
    if (search && search.trim()) {
      const q = search.trim().toLowerCase()
      groups = groups.filter((g) => g.name.toLowerCase().includes(q))
    }
    return groups
  }
}
