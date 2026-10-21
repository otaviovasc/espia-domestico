interface SearchPack {
  audienceSlug: string
  keywords: string[]
  excludePolitical?: boolean
  minPrice?: number
  maxPrice?: number
  minCommissionPercent?: number
  minEstimatedCommission?: number
}

/** Whole-word matching avoids pet→tapete and ração→decoração false positives. */
export function buildSmartSearchPreset(pack: SearchPack, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error('Escolha uma data válida para o preset.')
  }
  const seen = new Set<string>()
  const keywords = pack.keywords.map((word) => word.trim()).filter((word) => {
    const key = word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
    if (!word || word.length > 200 || /[,\r\n]/.test(word) || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 20)
  if (!keywords.length) throw new Error('Gere palavras-chave antes de copiar o preset.')
  if ([pack.minPrice, pack.maxPrice, pack.minCommissionPercent, pack.minEstimatedCommission].some((value) => value !== undefined && (!Number.isFinite(value) || value < 0))
    || (pack.minCommissionPercent !== undefined && pack.minCommissionPercent > 100)
    || (pack.minPrice !== undefined && pack.maxPrice !== undefined && pack.minPrice > pack.maxPrice)) {
    throw new Error('Revise os filtros de preço e comissão antes de copiar o preset.')
  }
  return {
    version: 1 as const,
    type: 'achadinhos-smart-search' as const,
    audience: pack.audienceSlug,
    date,
    keywords,
    matchMode: 'any' as const,
    matchStyle: 'word' as const,
    excludePolitical: pack.excludePolitical ?? false,
    ...(pack.minPrice !== undefined ? { minPrice: pack.minPrice } : {}),
    ...(pack.maxPrice !== undefined ? { maxPrice: pack.maxPrice } : {}),
    commission: {
      ...(typeof pack.minCommissionPercent === 'number' ? { minPercent: pack.minCommissionPercent } : {}),
      ...(typeof pack.minEstimatedCommission === 'number' ? { minEstimatedBrl: pack.minEstimatedCommission } : {}),
    },
  }
}
