import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, rename, unlink, stat } from 'node:fs/promises'
import type { BrowserContext } from 'playwright'

export type BrowserSessionState = Awaited<ReturnType<BrowserContext['storageState']>>
export const browserSessionHash = (raw: string): string => createHash('sha256').update(raw).digest('hex')

/** Cooperating writers serialize publication; an older browser cannot replace a newer login. */
export async function checkpointBrowserSession(file: string, expectedHash: string | null, state: BrowserSessionState): Promise<{ saved: true; hash: string } | { saved: false; hash: string | null }> {
  const lock = `${file}.lock`
  try { await writeFile(lock, '', { mode: 0o600, flag: 'wx' }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    // This lock covers a tiny local file write, never the browser lifetime.
    const info = await stat(lock).catch(() => null)
    if (!info || Date.now() - info.mtimeMs < 120_000) throw new Error('SESSION_WRITE_BUSY')
    await unlink(lock)
    await writeFile(lock, '', { mode: 0o600, flag: 'wx' })
  }
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    const currentRaw = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
    const current = currentRaw === null ? null : browserSessionHash(currentRaw)
    if (current !== expectedHash) return { saved: false, hash: current }
    const raw = JSON.stringify(state)
    await writeFile(temporary, raw, { mode: 0o600, flag: 'wx' })
    await rename(temporary, file)
    return { saved: true, hash: browserSessionHash(raw) }
  } finally {
    await unlink(temporary).catch(() => undefined)
    await unlink(lock).catch(() => undefined)
  }
}
