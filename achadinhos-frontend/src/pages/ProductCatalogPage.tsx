import { useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CheckCircle2, FileJson, Upload } from 'lucide-react'
import { apiErrorMessage, campaignApi, savedProductApi, type ImportResult } from '@/lib/api'
import { Badge, Button, Card, Spinner } from '@/components/ui'

const CATEGORIES = ['A', 'B', 'C', 'D'] as const
const TONES = { A: 'green', B: 'blue', C: 'amber', D: 'red' } as const

function money(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

export default function ProductCatalogPage() {
  const queryClient = useQueryClient()
  const [jsonText, setJsonText] = useState('')
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [categoryFilter, setCategoryFilter] = useState<'all' | typeof CATEGORIES[number]>('all')
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  const catalog = useInfiniteQuery({
    queryKey: ['saved-products', 'pages'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => savedProductApi.list(100, pageParam),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0)
      return loaded < last.total && last.items.length > 0 ? loaded : undefined
    },
  })
  const savedItems = useMemo(() => catalog.data?.pages.flatMap((page) => page.items) ?? [], [catalog.data])
  const savedKeys = useMemo(() => new Set(savedItems.map((item) =>
    item.offer.source && item.offer.productId
      ? `${item.offer.source}:${item.offer.productId}`
      : item.offer.affiliateUrl,
  )), [savedItems])
  const remove = useMutation({
    mutationFn: savedProductApi.remove,
    onSuccess: async () => {
      setFeedback('Produto removido do catálogo.')
      setError(null)
      await queryClient.invalidateQueries({ queryKey: ['saved-products'] })
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  })
  const classify = useMutation({
    mutationFn: () => campaignApi.importOffers(jsonText, { source: 'mercadolivre' }),
    onSuccess: (data) => {
      setResult(data)
      setSelected(new Set())
      setCategoryFilter('all')
      setError(null)
      setFeedback(null)
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  })
  const save = useMutation({
    mutationFn: () => savedProductApi.save(result?.offers.filter((_, index) => selected.has(index)) ?? []),
    onSuccess: async (data) => {
      setSelected(new Set())
      setFeedback(`${data.created} produto(s) salvo(s), ${data.updated} atualizado(s).`)
      setError(null)
      await queryClient.invalidateQueries({ queryKey: ['saved-products'] })
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  })
  const counts = useMemo(() => {
    const next = { A: 0, B: 0, C: 0, D: 0, uncategorized: 0 }
    for (const offer of result?.offers ?? []) {
      if (offer.category && offer.category in next) next[offer.category]++
      else next.uncategorized++
    }
    return next
  }, [result])
  const visibleOffers = useMemo(() => (result?.offers ?? []).map((offer, index) => ({ offer, index }))
    .filter(({ offer }) => categoryFilter === 'all' || offer.category === categoryFilter), [result, categoryFilter])
  const selectVisible = () => setSelected((current) => new Set([
    ...current,
    ...visibleOffers.filter(({ offer }) => !!offer.category).map(({ index }) => index),
  ]))

  const updateText = (value: string) => {
    setJsonText(value)
    setResult(null)
    setSelected(new Set())
    setCategoryFilter('all')
    setFeedback(null)
    setError(null)
  }

  const readFile = async (file?: File) => {
    if (!file) return
    setFileName(file.name)
    setFileError(null)
    try {
      updateText(await file.text())
    } catch {
      setFileError('Não foi possível ler o arquivo. Escolha outro arquivo JSON.')
    }
  }

  const toggle = (index: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Classificar produtos</h1>
        <p className="mt-1 text-sm text-zinc-600">Cole ou envie o JSON do Mercado Livre, revise as categorias e salve os produtos que quer usar em campanhas.</p>
      </div>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <FileJson size={18} className="text-violet-600" />
          <h2 className="font-semibold">JSON do Mercado Livre</h2>
        </div>
        <label htmlFor="catalog-json" className="mb-1 block text-sm font-medium text-zinc-700">Conteúdo do arquivo</label>
        <textarea
          id="catalog-json"
          value={jsonText}
          disabled={classify.isPending || save.isPending}
          onChange={(event) => { setFileName(''); updateText(event.target.value) }}
          placeholder="Cole aqui o JSON exportado do hub de afiliados"
          className="h-36 w-full rounded-lg border border-zinc-300 p-3 font-mono text-xs outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
        />
          <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-within:ring-2 focus-within:ring-violet-400">
            <Upload size={16} /> Escolher JSON
            <input type="file" accept=".json,application/json" className="sr-only" disabled={classify.isPending || save.isPending} onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = '' }} />
          </label>
          {fileName && <span className="text-sm text-zinc-500">{fileName}</span>}
          <Button onClick={() => classify.mutate()} disabled={!jsonText.trim() || classify.isPending || save.isPending}>
            {classify.isPending ? 'Classificando…' : 'Classificar produtos'}
          </Button>
        </div>
        {fileError && <p role="alert" className="mt-3 text-sm text-red-700">{fileError}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        {feedback && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-green-700"><CheckCircle2 size={16} />{feedback}</p>}
      </Card>

      {result && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Revisar classificação</h2>
              <p className="text-sm text-zinc-500">{result.offers.length} produto(s) reconhecido(s) de {result.totalSeen} no arquivo.</p>
            </div>
            <Button onClick={() => save.mutate()} disabled={selected.size === 0 || save.isPending}>
              {save.isPending ? 'Salvando…' : `Salvar ${selected.size} selecionado(s)`}
            </Button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">Até 100 produtos por arquivo. Cada produto válido é avaliado por Jev, então a classificação pode levar alguns minutos.</p>
            <div className="mt-4 flex flex-wrap gap-2" aria-label="Filtrar por categoria">
              <button type="button" aria-pressed={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')} className={`rounded-lg px-2 py-1 ring-offset-2 ${categoryFilter === 'all' ? 'ring-2 ring-violet-500' : ''}`}><Badge>Todos: {result.offers.length}</Badge></button>
              {CATEGORIES.map((category) => <button type="button" key={category} aria-pressed={categoryFilter === category} onClick={() => setCategoryFilter(category)} className={`rounded-lg px-2 py-1 ring-offset-2 ${categoryFilter === category ? 'ring-2 ring-violet-500' : ''}`}><Badge tone={TONES[category]}>{category}: {counts[category]}</Badge></button>)}
              {counts.uncategorized > 0 && <Badge>Sem categoria: {counts.uncategorized}</Badge>}
            </div>
            <p className="mt-2 text-xs text-zinc-500">A combina alta afinidade com casa, desconto e comissão; D indica baixa prioridade. A afinidade aparece ao passar o cursor sobre a categoria.</p>
            {result.offers.some((offer) => !!offer.category) && <div className="mt-3 flex gap-4 text-sm"><button type="button" className="text-violet-700 underline" onClick={selectVisible}>Selecionar visíveis</button><button type="button" className="text-zinc-600 underline" onClick={() => setSelected(new Set())}>Limpar seleção</button></div>}
          {counts.uncategorized > 0 && <p className="mt-2 text-sm text-amber-800">Produtos sem categoria não podem ser salvos. Confira os avisos da importação.</p>}
          {result.errors.length > 0 && <p className="mt-3 text-sm text-amber-800">{result.errors.length} item(ns) não puderam ser importados. {result.errors.slice(0, 3).map((item) => item.message).join(' ')}</p>}
            {visibleOffers.length === 0 ? (
              <p className="mt-5 text-sm text-zinc-600">Nenhum produto nesta categoria.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-zinc-200 text-xs text-zinc-500"><th className="px-2 py-2">Salvar</th><th className="px-2 py-2">Produto</th><th className="px-2 py-2">Categoria</th><th className="px-2 py-2">Desconto</th><th className="px-2 py-2">Comissão</th><th className="px-2 py-2">Preço</th><th className="px-2 py-2">Link</th></tr></thead>
                  <tbody>
                    {visibleOffers.map(({ offer, index }) => (
                    <tr key={`${offer.productId || offer.affiliateUrl}-${index}`} className="border-b border-zinc-100">
                      <td className="px-2 py-3"><input type="checkbox" aria-label={`Salvar ${offer.title}`} checked={selected.has(index)} disabled={!offer.category || save.isPending} onChange={() => toggle(index)} /></td>
                        <td className="px-2 py-3"><div className="flex min-w-48 items-center gap-2">{offer.imageUrl && <img src={offer.imageUrl} alt="" loading="lazy" className="h-10 w-10 rounded object-cover" />}<span>{offer.title}</span>{savedKeys.has(offer.source && offer.productId ? `${offer.source}:${offer.productId}` : offer.affiliateUrl) && <Badge tone="green">Salvo</Badge>}</div></td>
                        <td className="px-2 py-3">{offer.category ? <span title={`Afinidade com casa: ${offer.relevanceScore ?? '—'}/100`}><Badge tone={TONES[offer.category]}>Categoria {offer.category}</Badge></span> : <Badge>Sem categoria</Badge>}</td>
                        <td className="whitespace-nowrap px-2 py-3">{offer.discountPercent != null ? `${offer.discountPercent}%` : '—'}</td>
                        <td className="whitespace-nowrap px-2 py-3">{offer.commissioned === false ? 'Sem comissão' : offer.commissionRate != null ? `${offer.commissionRate}%` : '—'}</td>
                      <td className="whitespace-nowrap px-2 py-3">{money(offer.discountedPrice)}</td>
                      <td className="px-2 py-3"><a href={offer.affiliateUrl} target="_blank" rel="noopener noreferrer" className="text-violet-700 underline">Abrir</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold">Catálogo salvo</h2><p className="text-sm text-zinc-500">Produtos disponíveis para campanhas futuras.</p></div>
          <Link to="/compose" className="text-sm font-medium text-violet-700 underline">Criar campanha</Link>
        </div>
        {catalog.isPending ? <div className="mt-4"><Spinner /></div> : catalog.isError ? (
          <p role="alert" className="mt-4 text-sm text-red-700">Não foi possível carregar o catálogo. <button type="button" className="underline" onClick={() => void catalog.refetch()}>Tentar novamente</button></p>
        ) : savedItems.length ? (
          <div className="mt-4 space-y-2">{savedItems.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 border-b border-zinc-100 py-2 text-sm"><span className="min-w-0 truncate">{item.offer.title}</span><Badge tone={item.offer.category ? TONES[item.offer.category] : 'zinc'}>{item.offer.category || 'Sem categoria'}</Badge><button type="button" disabled={remove.isPending} onClick={() => remove.mutate(item.id)} className="text-red-700 underline disabled:opacity-50" aria-label={`Remover ${item.offer.title}`}>Remover</button></div>)}<p className="text-xs text-zinc-500">Mostrando {savedItems.length} de {catalog.data?.pages[0]?.total ?? savedItems.length} produtos.</p>{catalog.hasNextPage && <Button variant="secondary" disabled={catalog.isFetchingNextPage} onClick={() => void catalog.fetchNextPage()}>{catalog.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}</Button>}</div>
        ) : <p className="mt-4 text-sm text-zinc-600">Nenhum produto salvo. Classifique um JSON e escolha os produtos acima.</p>}
      </Card>
    </div>
  )
}
