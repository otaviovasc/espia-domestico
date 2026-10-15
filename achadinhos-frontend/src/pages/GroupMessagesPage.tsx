import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  MessagesSquare,
  RefreshCw,
  Search,
  Send,
  Tag,
  ArrowLeft,
  ArrowDown,
  ImageIcon,
  FileJson,
} from 'lucide-react'
import {
  groupApi,
  groupMessageApi,
  savedProductApi,
  campaignApi,
  apiErrorMessage,
  type Group,
  type GroupMessage,
  type Offer,
  type SavedProduct,
} from '@/lib/api'
import { Button, Card, Badge, Spinner, Input } from '@/components/ui'
import { WhatsAppBubble } from '@/components/WhatsAppBubble'
import { ConnectionMessagesDialog } from './ConnectionMessagesDialog'

function timeLabel(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function firstUrl(text: string | null): string | null {
  if (!text) return null
  const m = text.match(/https?:\/\/[^\s]+/)
  return m ? m[0] : null
}

/** Inbound bubble (left, white). Outbound uses the shared WhatsAppBubble look. */
function MessageRow({ msg, onMediaLoad }: { msg: GroupMessage; onMediaLoad: () => void }) {
  const out = msg.direction === 'out'
  const url = firstUrl(msg.text)
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`relative max-w-[80%] rounded-lg p-2 text-sm shadow-sm ${
          out ? 'rounded-tr-none bg-[#d9fdd3]' : 'rounded-tl-none bg-white'
        }`}
      >
        {!out && msg.senderName && (
          <div className="mb-0.5 text-xs font-semibold text-[#6941a5]">{msg.senderName}</div>
        )}
        {msg.mediaUrl && msg.mediaType === 'image' && (
          <img
            onLoad={onMediaLoad}
            src={msg.mediaUrl}
            alt=""
            className="mb-1 max-h-56 w-full rounded-md object-cover"
            loading="lazy"
          />
        )}
        {msg.mediaType && msg.mediaType !== 'image' && !msg.text && (
          <div className="flex items-center gap-1 text-zinc-500">
            <ImageIcon size={14} /> {msg.mediaType}
          </div>
        )}
        <div className="whitespace-pre-wrap break-words pr-10 text-zinc-900">
          {(msg.text ?? '').split('\n').map((line, i) => (
            <div key={i}>
              {line
                ? line.split(/(https?:\/\/[^\s]+)/g).map((part, j) =>
                    /^https?:\/\//.test(part) ? (
                      <a
                        key={j}
                        href={part}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#027eb5] underline"
                      >
                        {part}
                      </a>
                    ) : (
                      <span key={j}>{part}</span>
                    ),
                  )
                : '\u00A0'}
            </div>
          ))}
          {!msg.text && !msg.mediaType && <span className="text-zinc-500">(sem conteúdo)</span>}
        </div>
        <span className="absolute bottom-1 right-2 text-[10px] text-zinc-500">
          {timeLabel(msg.timestamp)}
        </span>
        {url && <span className="sr-only">{url}</span>}
      </div>
    </div>
  )
}

/** Catalog list used inside the sender modal. */
function CatalogList({ onSelect }: { onSelect: (offer: Offer) => void }) {
  const [search, setSearch] = useState('')
  const query = useInfiniteQuery({
    queryKey: ['saved-products', 'offer-picker'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => savedProductApi.list(100, pageParam),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0)
      return loaded < lastPage.total && lastPage.items.length > 0 ? loaded : undefined
    },
  })
  const items: SavedProduct[] = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter((p) => p.offer.title.toLowerCase().includes(q))
  }, [items, search])

  return (
    <>
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-line px-2">
        <Search size={16} className="text-subtle" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar produto do catálogo"
          aria-label="Buscar produto do catálogo"
          className="w-full bg-transparent py-2 text-sm text-ink outline-none"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isLoading && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}
        {query.isError && <div role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger"><p>{apiErrorMessage(query.error)}</p><Button variant="secondary" className="mt-2" onClick={() => query.refetch()}>Tentar novamente</Button></div>}
        {!query.isLoading && !query.isError && filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">
            {search.trim() ? (query.hasNextPage ? 'Nenhum produto carregado corresponde à busca. Carregue mais produtos ou tente outro nome.' : 'Nenhum produto corresponde à busca. Tente outro nome.') : 'Seu catálogo está vazio. Salve produtos na página Produtos para escolher uma oferta.'}
          </p>
        )}
        <div className="space-y-2">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p.offer)}
              className="flex w-full items-center gap-3 rounded-lg border border-line p-2 text-left hover:border-accent hover:bg-accent-soft"
            >
              {p.offer.imageUrl && (
                <img
                  src={p.offer.imageUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-md object-cover"
                  loading="lazy"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.offer.title}</div>
                <div className="text-xs text-muted">
                  R$ {p.offer.discountedPrice.toFixed(2).replace('.', ',')}
                </div>
              </div>
            </button>
          ))}
        </div>
        {query.hasNextPage && <Button variant="secondary" className="mt-3 w-full" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>{query.isFetchingNextPage ? 'Carregando…' : 'Carregar mais produtos'}</Button>}
      </div>
    </>
  )
}

/** Paste a product JSON, parse it (no AI), and preview before sending. */
function PasteJson({ onSelect, includeImage }: { onSelect: (offer: Offer) => void; includeImage: boolean }) {
  const [raw, setRaw] = useState('')
  const [offers, setOffers] = useState<Offer[]>([])
  const [error, setError] = useState<string | null>(null)

  const parseMutation = useMutation({
    // parseOnly normalizes aliases/prices without any paid AI call.
    mutationFn: () => campaignApi.importOffers(raw, { parseOnly: true }),
    onSuccess: (res) => {
      setOffers(res.offers)
      setError(
        res.offers.length === 0
          ? 'Nenhum produto válido encontrado no JSON.'
          : null,
      )
    },
    onError: (e) => {
      setOffers([])
      setError(apiErrorMessage(e))
    },
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {offers.length === 0 ? (
        <>
          <label htmlFor="offer-json" className="mb-2 text-sm font-medium text-ink">JSON dos produtos</label>
          <textarea
            id="offer-json"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder='Cole aqui o JSON do produto (um objeto ou um array). Ex.: [{"title":"...","por":99.9,"link":"https://..."}]'
            className="min-h-[200px] flex-1 resize-none bg-surface text-ink rounded-lg border border-line-strong p-3 font-mono text-xs outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
          {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
          <Button
            className="mt-3 self-start"
            onClick={() => parseMutation.mutate()}
            disabled={parseMutation.isPending || !raw.trim()}
          >
            {parseMutation.isPending ? 'Lendo…' : 'Pré-visualizar'}
          </Button>
        </>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-muted">
              {offers.length} produto{offers.length === 1 ? '' : 's'} — escolha para enviar
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                setOffers([])
                setError(null)
              }}
            >
              Editar JSON
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            {offers.map((offer, i) => (
              <OfferPreviewCard key={i} offer={offer} includeImage={includeImage} actionLabel="Selecionar oferta" onSend={() => onSelect(offer)} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** A single parsed offer: WhatsApp preview + a send button. */
function OfferPreviewCard({ offer, onSend, includeImage, pending = false, actionLabel = 'Enviar oferta para o grupo' }: { offer: Offer; onSend: () => void; includeImage: boolean; pending?: boolean; actionLabel?: string }) {
  const previewQuery = useQuery({
    queryKey: ['offer-preview', offer],
    queryFn: async () => {
      const [p] = await campaignApi.preview([offer])
      return p?.message ?? ''
    },
  })
  return (
    <div className="rounded-lg border border-line p-3">
      {previewQuery.isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : previewQuery.isError ? (
        <div role="alert" className="text-sm text-danger"><p>Não foi possível preparar a oferta. {apiErrorMessage(previewQuery.error)}</p><Button variant="secondary" className="mt-2" onClick={() => previewQuery.refetch()}>Tentar novamente</Button></div>
      ) : (
        <WhatsAppBubble
          message={previewQuery.data ?? ''}
          imageUrl={offer.imageUrl}
          showImage={includeImage && Boolean(offer.imageUrl)}
        />
      )}
      <div className="mt-3 flex justify-end">
        <Button onClick={onSend} disabled={pending || previewQuery.isLoading || previewQuery.isError}>
          <Send size={16} /> {pending ? 'Enviando…' : actionLabel}
        </Button>
      </div>
    </div>
  )
}

/** Modal to send an offer: pick from catalog OR paste a JSON and preview it. */
function OfferSender({ onSelect, onClose, pending, error, includeImage, onImageChange, groupName }: {
  onSelect: (offer: Offer) => void
  onClose: () => void
  pending: boolean
  error: string | null
  includeImage: boolean
  onImageChange: (value: boolean) => void
  groupName: string
}) {
  const [tab, setTab] = useState<'catalog' | 'json'>('catalog')
  const [offer, setOffer] = useState<Offer | null>(null)
  const previewHeadingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { previewHeadingRef.current?.focus({ preventScroll: true }) }, [offer])
  const tabClass = (active: boolean) => `flex min-h-10 items-center gap-1.5 rounded-lg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${active ? 'bg-accent text-accent-foreground' : 'text-muted hover:bg-surface-muted'}`
  return (
    <ConnectionMessagesDialog title="Enviar oferta" titleId="offer-sender-title" onClose={onClose}>
      <p className="mb-3 text-sm text-muted">Destino: <strong className="text-ink">{groupName}</strong>. Confira a oferta antes de enviar.</p>
      {offer ? (
        <div className="min-h-0 overflow-y-auto">
          <h3 ref={previewHeadingRef} tabIndex={-1} className="mb-2 font-semibold focus-visible:outline-2 focus-visible:outline-accent">Conferir oferta</h3>
          <Button variant="ghost" disabled={pending} onClick={() => setOffer(null)}><ArrowLeft size={16} /> Escolher outro produto</Button>
          <label className="my-3 flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={includeImage} disabled={pending} onChange={(event) => onImageChange(event.target.checked)} />Incluir imagem do produto</label>
          <OfferPreviewCard offer={offer} includeImage={includeImage} onSend={() => onSelect(offer)} pending={pending} />
        </div>
      ) : (
        <>
          <div className="mb-3 flex gap-1" aria-label="Origem da oferta">
            <button type="button" aria-pressed={tab === 'catalog'} onClick={() => setTab('catalog')} className={tabClass(tab === 'catalog')}><Tag size={15} /> Catálogo</button>
            <button type="button" aria-pressed={tab === 'json'} onClick={() => setTab('json')} className={tabClass(tab === 'json')}><FileJson size={15} /> Colar JSON</button>
          </div>
          {tab === 'catalog' ? <CatalogList onSelect={setOffer} /> : <PasteJson onSelect={setOffer} includeImage={includeImage} />}
        </>
      )}
      {error && <p role="alert" className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger">A oferta não foi enviada. {error} Confira e tente novamente.</p>}
      {pending && <p role="status" className="mt-2 text-sm text-muted">Enviando oferta para {groupName}…</p>}
    </ConnectionMessagesDialog>
  )
}

export default function GroupMessagesPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Group | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sendImage, setSendImage] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newMessages, setNewMessages] = useState(0)
  const threadRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const nearBottomRef = useRef(true)
  const seenRef = useRef<{ groupId: string | undefined; ids: Set<number> }>({ groupId: undefined, ids: new Set() })
  const text = selected ? drafts[selected.id] ?? '' : ''
  const setText = (value: string) => { if (selected) setDrafts((previous) => ({ ...previous, [selected.id]: value })) }

  const groupsQuery = useQuery({ queryKey: ['groups', search], queryFn: () => groupApi.list(search || undefined) })
  const messagesQuery = useQuery({
    queryKey: ['group-messages', selected?.id],
    queryFn: () => groupMessageApi.list(selected!.id, { limit: 200 }),
    enabled: Boolean(selected),
    refetchInterval: selected ? 5000 : false,
  })

  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [selected?.id])

  // Polling must preserve the reader's position. Only a new thread or a reader
  // already near the latest message follows new arrivals automatically.
  useEffect(() => {
    if (!messagesQuery.data || !selected) return
    const previous = seenRef.current
    const changedThread = previous.groupId !== selected.id
    const added = changedThread ? 0 : messagesQuery.data.filter((message) => !previous.ids.has(message.id)).length
    seenRef.current = { groupId: selected.id, ids: new Set(messagesQuery.data.map((message) => message.id)) }
    if (changedThread || nearBottomRef.current) {
      const thread = threadRef.current
      if (thread) thread.scrollTop = thread.scrollHeight
      nearBottomRef.current = true
      setNewMessages(0)
    } else if (added > 0) setNewMessages((count) => count + added)
  }, [messagesQuery.data, selected])

  const sendTextMutation = useMutation({
    mutationFn: ({ groupId, body }: { groupId: string; body: string }) => groupMessageApi.sendText(groupId, body),
    onSuccess: (_data, { groupId }) => {
      setDrafts((previous) => ({ ...previous, [groupId]: '' }))
      setError(null)
      nearBottomRef.current = true
      qc.invalidateQueries({ queryKey: ['group-messages', groupId] })
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })
  const sendOfferMutation = useMutation({
    mutationFn: ({ groupId, offer, includeImage }: { groupId: string; offer: Offer; includeImage: boolean }) => groupMessageApi.sendOffer(groupId, offer, { sendImage: includeImage }),
    onSuccess: (_data, { groupId }) => {
      setPickerOpen(false)
      setError(null)
      nearBottomRef.current = true
      qc.invalidateQueries({ queryKey: ['group-messages', groupId] })
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })
  const groups = groupsQuery.data ?? []
  const messages = messagesQuery.data ?? []
  const sending = sendTextMutation.isPending || sendOfferMutation.isPending
  const sendText = () => { if (selected && text.trim() && !sending) sendTextMutation.mutate({ groupId: selected.id, body: text.trim() }) }
  const jumpToLatest = () => {
    const thread = threadRef.current
    if (thread) thread.scrollTop = thread.scrollHeight
    nearBottomRef.current = true
    setNewMessages(0)
  }

  return (
    <div className="workspace-page mx-auto flex min-h-0 w-full max-w-6xl flex-col text-ink">
      <div className="page-header">
        <div><h1 className="page-title">Mensagens dos grupos</h1><p className="page-description">Acompanhe as conversas e confira cada oferta antes de enviar.</p></div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className={`${selected ? 'hidden lg:flex' : 'flex'} min-h-0 flex-col lg:max-h-[calc(100dvh-12rem)]`}>
          <h2 className="mb-3 font-semibold">Seus grupos</h2>
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-2 focus-within:ring-2 focus-within:ring-accent/30"><Search size={16} className="shrink-0 text-subtle" /><input aria-label="Buscar grupo" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar grupo" className="min-w-0 w-full bg-transparent py-2 text-sm outline-none" /></div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {groupsQuery.isLoading && <div role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-muted"><Spinner /> Carregando grupos…</div>}
            {groupsQuery.isError && <div role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger"><p>Não foi possível carregar os grupos. {apiErrorMessage(groupsQuery.error)}</p><Button variant="secondary" className="mt-2" onClick={() => groupsQuery.refetch()}>Tentar novamente</Button></div>}
            {!groupsQuery.isLoading && !groupsQuery.isError && groups.length === 0 && <div className="py-8 text-center text-sm text-muted"><MessagesSquare size={28} className="mx-auto mb-3" /><p>{search.trim() ? 'Nenhum grupo corresponde à busca.' : 'Nenhum grupo disponível. Conecte um número que participe de grupos e atualize a lista.'}</p><Button variant="ghost" className="mt-3" onClick={() => groupsQuery.refetch()}><RefreshCw size={16} />Atualizar grupos</Button></div>}
            {groups.map((g) => <button key={g.id} disabled={sending} aria-current={selected?.id === g.id ? 'true' : undefined} onClick={() => { setSelected(g); setError(null); nearBottomRef.current = true; setNewMessages(0) }} className={`w-full rounded-lg px-3 py-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60 ${selected?.id === g.id ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-surface-muted'}`}><div className="truncate font-medium">{g.name}</div><div className="mt-1 text-xs text-muted">{g.size} participante{g.size === 1 ? '' : 's'}{g.announceOnly ? ' · só administradores' : ''}</div></button>)}
          </div>
        </Card>
        <Card className={`${selected ? 'flex' : 'hidden lg:flex'} min-h-0 min-w-0 flex-col lg:h-[calc(100dvh-12rem)]`}>
          {!selected ? <div className="flex min-h-80 flex-1 flex-col items-center justify-center gap-3 text-center text-sm text-muted"><MessagesSquare size={32} /><p>Selecione um grupo para acompanhar as mensagens.</p></div> : <>
            <div className="mb-3 flex shrink-0 items-center justify-between gap-2 border-b border-line pb-3">
              <div className="flex min-w-0 items-center gap-2"><Button variant="ghost" className="h-11 w-11 shrink-0 !p-0 lg:hidden" aria-label="Voltar para os grupos" disabled={sending} onClick={() => setSelected(null)}><ArrowLeft size={20} /></Button><div className="min-w-0"><h2 ref={headingRef} tabIndex={-1} className="truncate font-semibold focus-visible:outline-2 focus-visible:outline-accent">{selected.name}</h2>{selected.announceOnly && <Badge tone="amber">Só administradores podem postar</Badge>}</div></div>
              <Button variant="ghost" aria-label="Atualizar mensagens" className="shrink-0" onClick={() => messagesQuery.refetch()} disabled={messagesQuery.isFetching}><RefreshCw size={16} /><span className="hidden sm:inline">Atualizar</span></Button>
            </div>
            {messagesQuery.isError && <div role="alert" className="mb-2 rounded-lg bg-danger-soft p-3 text-sm text-danger"><p>Não foi possível atualizar as mensagens. {apiErrorMessage(messagesQuery.error)}</p><Button variant="secondary" className="mt-2" onClick={() => messagesQuery.refetch()}>Tentar novamente</Button></div>}
            <div ref={threadRef} aria-label={`Mensagens de ${selected.name}`} tabIndex={0} onScroll={() => { const thread = threadRef.current; if (!thread) return; nearBottomRef.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80; if (nearBottomRef.current) setNewMessages(0) }} className="min-h-[260px] max-h-[44dvh] min-w-0 flex-1 space-y-2 overflow-y-auto rounded-lg bg-[#efeae2] p-3 [overflow-anchor:none] focus-visible:outline-2 focus-visible:outline-accent lg:max-h-none">
              {messagesQuery.isLoading && <div role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-[#526a5d]"><Spinner /> Carregando mensagens…</div>}
              {!messagesQuery.isLoading && !messagesQuery.isError && messages.length === 0 && <p className="py-8 text-center text-sm text-[#526a5d]">Ainda não há mensagens registradas. Novas mensagens aparecem aqui quando a sincronização está ativa na página Conexão.</p>}
              {messages.map((m) => <MessageRow key={m.id} msg={m} onMediaLoad={() => { if (nearBottomRef.current && threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight }} />)}
            </div>
            {newMessages > 0 && <div role="status" className="mt-2 flex justify-center"><Button variant="secondary" onClick={jumpToLatest}><ArrowDown size={16} />{newMessages} nova{newMessages === 1 ? '' : 's'} mensage{newMessages === 1 ? 'm' : 'ns'}</Button></div>}
            {error && !pickerOpen && <p role="alert" className="mt-2 text-sm text-danger">Não foi possível enviar. {error}</p>}
            <form onSubmit={(event) => { event.preventDefault(); sendText() }} className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
              <label htmlFor="group-message" className="sr-only">Mensagem para {selected.name}</label><Input id="group-message" className="order-first basis-full sm:order-none sm:basis-0 sm:flex-1 sm:min-w-0" value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva uma mensagem…" disabled={sending} />
              <Button type="button" variant="secondary" aria-label="Enviar oferta" onClick={() => { setError(null); setPickerOpen(true) }} disabled={sending}><Tag size={16} />Oferta</Button>
              <Button type="submit" aria-label="Enviar mensagem" className="ml-auto sm:ml-0" disabled={sending || !text.trim()}><Send size={16} />{sendTextMutation.isPending ? 'Enviando…' : 'Enviar'}</Button>
            </form>
            <label className="mt-3 flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={sendImage} onChange={(e) => setSendImage(e.target.checked)} disabled={sending} />Incluir imagem do produto nas ofertas</label>
          </>}
        </Card>
      </div>
      {pickerOpen && selected && <OfferSender onClose={() => setPickerOpen(false)} onSelect={(offer) => { if (!sending) sendOfferMutation.mutate({ groupId: selected.id, offer, includeImage: sendImage }) }} pending={sendOfferMutation.isPending} error={error} includeImage={sendImage} onImageChange={setSendImage} groupName={selected.name} />}
    </div>
  )
}
