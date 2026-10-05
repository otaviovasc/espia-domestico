export interface ExtensionCommissionFilters {
  minPercent?: number | null
  maxPercent?: number | null
  minEstimatedBrl?: number | null
}
export interface ExtensionEvidence {
  productUrl?: string
  extractedAt?: string
  commission?: { percent: number | null; priceBrl: number | null; estimatedBrl: number | null; basis: 'visible_current_price_times_displayed_percent'; guaranteed: false }
  searchMatch?: { keywords?: string[]; matchMode?: 'any' | 'all'; commission?: ExtensionCommissionFilters | null }
  selection?: { method?: string; evidenceStatus?: string; addedAt?: string; sourceUrl?: string | null; keyword?: string; keywords?: string[]; matchMode?: 'any' | 'all'; commission?: ExtensionCommissionFilters | null }
  reviewVideos?: {
    source: 'mercado_livre_product_page'
    requested?: number
    status: string
    found?: number
    error?: string | null
    scanScope?: 'loaded_product_page'
    videos: { url: string; kind?: 'customer_review' | 'product_video'; status: 'pending' | 'downloading' | 'complete' | 'failed' | 'cancelled' | 'interrupted'; format?: string; filename?: string; reused?: boolean; error?: string }[]
  }
}

export function extensionVideoSummary(evidence?: ExtensionEvidence) {
  const job = evidence?.reviewVideos
  if (!job) return null
  return { completed: job.videos.filter(video => video.status === 'complete').length, requested: job.requested, status: job.status }
}
