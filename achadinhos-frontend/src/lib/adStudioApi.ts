import { api } from './api'
import type { AdAsset, AdProject, AdProjectConfig } from './api'
export type StudioKind = 'library' | 'brand' | 'template' | 'preset' | 'publication'
export type StudioRecord<T = Record<string, unknown>> = {
  id: number
  key: string
  kind: StudioKind
  payload: T
  revision: number
  updatedAt: string
}
export type LibraryMedia = {
  name: string
  kind: 'clip' | 'image' | 'music'
  tags: string[]
  productIds: number[]
  fingerprint: string
  mimeType: string
  sizeBytes: number
  durationSeconds: number
  width: number | null
  height: number | null
}
export type BrandKit = {
  name: string
  textStyle: AdProjectConfig['textStyle']
  backgroundColor: string
  signature: string
}
export type CreativeMetrics = {
  impressions: number
  clicks: number
  saves: number
  likes: number
  comments: number
  sales: number | null
  revenue: number | null
  attribution: string
  observedAt: string
  source: 'manual'
}
export type Publication = {
  name: string
  projectId: number
  jobId: number | null
  scheduledAt: string | null
  timeZone: string
  status: 'draft' | 'scheduled' | 'exported' | 'published'
  caption: string
  productIds: number[]
  postUrl: string | null
  publishedAt: string | null
  metrics: CreativeMetrics | null
}
export type ProductCopy = {
  id: number
  title: string
  price: string
  coupon: string | null
  affiliateUrl: string
  text: string
  caption: string
}
const base = '/ad-projects'
const data = <T>(res: { data: { data: T } }): T => res.data.data
export const studioApi = {
  async list<T = Record<string, unknown>>(
    kind: StudioKind,
    offset = 0,
    q = '',
  ): Promise<{ items: StudioRecord<T>[]; total: number; nextOffset: number | null }> {
    return data(await api.get(`${base}/studio/${kind}`, { params: { offset, q } }))
  },
  async all<T = Record<string, unknown>>(kind: StudioKind, q = ''): Promise<StudioRecord<T>[]> {
    const items: StudioRecord<T>[] = []
    let offset: number | null = 0
    do {
      const page: { items: StudioRecord<T>[]; total: number; nextOffset: number | null } =
        await studioApi.list<T>(kind, offset, q)
      items.push(...page.items)
      offset = page.nextOffset
    } while (offset !== null)
    return items
  },
  async save<T>(
    kind: Exclude<StudioKind, 'library'>,
    payload: T,
    existing?: StudioRecord<T>,
    key: string = crypto.randomUUID(),
  ): Promise<StudioRecord<T>> {
    return data(
      await api.post(`${base}/studio/${kind}`, {
        payload,
        key: existing?.key ?? key,
        ...(existing ? { expectedRevision: existing.revision } : {}),
      }),
    )
  },
  async remove(id: number) {
    await api.delete(`${base}/studio/records/${id}`)
  },
  async saveMedia(
    projectId: number,
    asset: AdAsset,
    tags: string[],
    productIds: number[],
  ): Promise<{ record: StudioRecord<LibraryMedia>; duplicate: boolean }> {
    return data(
      await api.post(`${base}/${projectId}/assets/${asset.id}/library`, {
        name: asset.originalName,
        tags,
        productIds,
      }),
    )
  },
  async editMedia(
    recordId: number,
    metadata: { name: string; tags: string[]; productIds: number[] },
  ): Promise<StudioRecord<LibraryMedia>> {
    return data(await api.patch(`${base}/studio/library/${recordId}`, metadata))
  },
  async attach(projectId: number, recordId: number): Promise<AdAsset> {
    return data(await api.post(`${base}/${projectId}/library/attach`, { recordId }))
  },
  async importProducts(
    projectId: number,
    productIds: number[],
  ): Promise<{
    items: { asset: AdAsset; product: ProductCopy }[]
    errors: { productId: number; message: string }[]
  }> {
    return data(await api.post(`${base}/${projectId}/products/import`, { productIds }))
  },
  async suggest(
    productIds: number[],
    tone: string,
  ): Promise<{ texts: string[]; caption: string; facts: ProductCopy[] }> {
    return data(await api.post(`${base}/studio/copy/suggest`, { productIds, tone }))
  },
  async variant(
    projectId: number,
    format: 'feed' | 'carousel' | 'reels' | 'stories',
    framing: AdProjectConfig['framing'],
  ): Promise<AdProject> {
    return data(await api.post(`${base}/${projectId}/variants`, { format, framing }))
  },
  async bundle(projectId: number, jobId: number): Promise<Blob> {
    return (
      await api.get(`${base}/${projectId}/render-jobs/${jobId}/bundle`, { responseType: 'blob' })
    ).data as Blob
  },
}
