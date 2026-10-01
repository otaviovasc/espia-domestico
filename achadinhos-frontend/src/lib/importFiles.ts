import type { ImportPayload } from './api'

export const MAX_IMPORT_FILES = 50
export const MAX_IMPORT_BYTES = 32 * 1024 * 1024

export interface ImportFileEntry {
  id: number
  name: string
  size: number
  status: 'reading' | 'ready' | 'error'
  text?: string
  error?: string
}

export function importInputError(files: ImportFileEntry[], pastedJson: string): string | null {
  const count = files.length + (pastedJson.trim() ? 1 : 0)
  if (!count) return 'Escolha arquivos JSON ou cole um JSON.'
  if (count > MAX_IMPORT_FILES) return `Escolha no máximo ${MAX_IMPORT_FILES} arquivos, contando o JSON colado.`
  if (files.some((file) => file.status === 'reading')) return 'Aguarde a leitura dos arquivos.'
  if (files.some((file) => file.status === 'error')) return 'Remova ou substitua os arquivos com erro antes de classificar.'
  const totalBytes = files.reduce((total, file) => total + file.size, 0) + new TextEncoder().encode(pastedJson).length
  if (totalBytes > MAX_IMPORT_BYTES) return 'Os arquivos e o JSON colado ultrapassam 32 MB. Divida a importação.'
  if (pastedJson.trim()) {
    try { JSON.parse(pastedJson) } catch { return 'JSON colado inválido. Corrija o conteúdo antes de classificar.' }
  }
  return null
}

export function prepareImportPayloads(files: ImportFileEntry[], pastedJson: string): ImportPayload[] {
  const error = importInputError(files, pastedJson)
  if (error) throw new Error(error)
  const payloads: ImportPayload[] = files.map((file) => ({ name: file.name, json: file.text! }))
  if (pastedJson.trim()) payloads.push({ name: 'JSON colado', json: pastedJson })
  // String JSON needs escaping in the HTTP body; its encoded size can exceed the raw file size.
  if (new TextEncoder().encode(JSON.stringify({ payloads })).length > MAX_IMPORT_BYTES - 1024) {
    throw new Error('O envio dos arquivos ultrapassa 32 MB. Divida a importação.')
  }
  return payloads
}

export async function readImportFile(file: Pick<File, 'name' | 'text'>): Promise<{ text?: string; error?: string }> {
  let text: string
  try { text = await file.text() } catch { return { error: `Não foi possível ler ${file.name}. Remova o arquivo e escolha novamente.` } }
  try { JSON.parse(text) } catch { return { error: `JSON inválido em ${file.name}. Corrija o arquivo antes de classificar.` } }
  return { text }
}

/** A removed file's late read cannot replace a newly added file with the same name. */
export function applyFileRead(files: ImportFileEntry[], id: number, result: { text?: string; error?: string }): ImportFileEntry[] {
  return files.map((file) => file.id === id
    ? { ...file, ...result, status: result.error ? 'error' : 'ready' }
    : file)
}
