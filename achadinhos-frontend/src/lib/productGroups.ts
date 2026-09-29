import {
  api,
  type ProductGroup as ApiProductGroup,
  type SavedProduct,
  type SavedProductClassification as ApiSavedProductClassification,
} from '@/lib/api'

export type ProductGroup = ApiProductGroup
export type SavedProductClassification = ApiSavedProductClassification
export type GroupedSavedProduct = SavedProduct

interface Envelope<T> {
  data: T
}

export const productGroupApi = {
  async list(): Promise<ProductGroup[]> {
    const response = await api.get<Envelope<{ items: ProductGroup[] }>>('/product-groups')
    return response.data.data.items
  },
  async create(name: string): Promise<ProductGroup> {
    const response = await api.post<Envelope<ProductGroup>>('/product-groups', { name })
    return response.data.data
  },
  async update(id: number, name: string): Promise<ProductGroup> {
    const response = await api.patch<Envelope<ProductGroup>>(`/product-groups/${id}`, { name })
    return response.data.data
  },
  async remove(id: number): Promise<void> {
    await api.delete(`/product-groups/${id}`)
  },
  async assign(payload: {
    productIds: number[]
    groupIds: number[]
    mode: 'add' | 'remove' | 'set'
  }): Promise<{ updated: number; productIds: number[]; groupIds: number[]; mode: 'add' | 'remove' | 'set' }> {
    const response = await api.put<Envelope<{
      updated: number
      productIds: number[]
      groupIds: number[]
      mode: 'add' | 'remove' | 'set'
    }>>('/saved-products/groups', payload)
    return response.data.data
  },
}
