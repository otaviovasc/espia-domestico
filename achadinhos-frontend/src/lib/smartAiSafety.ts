export function createSmartAIRequestId(): string {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.randomUUID) throw new Error('Este navegador não oferece suporte a identificadores seguros. Atualize-o antes de usar a IA.')
  return cryptoApi.randomUUID()
}
