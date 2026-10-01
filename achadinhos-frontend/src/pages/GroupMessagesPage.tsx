import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  MessagesSquare,
  RefreshCw,
  Search,
  Send,
  Tag,
  X,
  ImageIcon,
} from 'lucide-react'
import {
  groupApi,
  groupMessageApi,
  savedProductApi,
  apiErrorMessage,
  type Group,
  type GroupMessage,
  type Offer,
  type SavedProduct,
} from '@/lib/api'
import { Button, Card, Badge, Spinner, Input } from '@/components/ui'

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
function MessageRow({ msg }: { msg: GroupMessage }) {
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
          <div className="mb-0.5 text-xs font-semibold text-violet-600">{msg.senderName}</div>
        )}
        {msg.mediaUrl && msg.mediaType === 'image' && (
          <img
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
          {!msg.text && !msg.mediaType && <span className="text-zinc-400">(sem conteúdo)</span>}
        </div>
        <span className="absolute bottom-1 right-2 text-[10px] text-zinc-400">
          {timeLabel(msg.timestamp)}
        </span>
        {url && <span className="sr-only">{url}</span>}
      </div>
    </div>
  )
}

/** Modal to pick a saved product to send as a formatted offer. */
function OfferPicker({
  onPick,
  onClose,
}: {
  onPick: (offer: Offer) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const query = useQuery({
    queryKey: ['saved-products', 'picker'],
    queryFn: () => savedProductApi.list(200, 0),
  })
  const items: SavedProduct[] = query.data?.items ?? []
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter((p) => p.offer.title.toLowerCase().includes(q))
  }, [items, search])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="flex max-h-[80vh] w-full max-w-lg flex-col">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Escolher oferta</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700">
            <X size={20} />
          </button>
        </div>
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-zinc-200 px-2">
          <Search size={16} className="text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar produto do catálogo"
            className="w-full py-2 text-sm outline-none"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {query.isLoading && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
          {query.isError && <p className="text-sm text-red-600">{apiErrorMessage(query.error)}</p>}
          {!query.isLoading && filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-zinc-500">
              Nenhum produto no catálogo. Salve produtos na página Produtos.
            </p>
          )}
          <div className="space-y-2">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p.offer)}
                className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 p-2 text-left hover:border-violet-400 hover:bg-violet-50"
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
                  <div className="text-xs text-zinc-500">
                    R$ {p.offer.discountedPrice.toFixed(2).replace('.', ',')}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}

export default function GroupMessagesPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Group | null>(null)
  const [text, setText] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sendImage, setSendImage] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const groupsQuery = useQuery({
    queryKey: ['groups', search],
    queryFn: () => groupApi.list(search || undefined),
  })

  const messagesQuery = useQuery({
    queryKey: ['group-messages', selected?.id],
    queryFn: () => groupMessageApi.list(selected!.id, { limit: 200 }),
    enabled: Boolean(selected),
    refetchInterval: selected ? 5000 : false,
  })

  // Scroll to the newest message when the thread changes.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messagesQuery.data, selected?.id])

  const sendTextMutation = useMutation({
    mutationFn: (body: string) => groupMessageApi.sendText(selected!.id, body),
    onSuccess: () => {
      setText('')
      setError(null)
      qc.invalidateQueries({ queryKey: ['group-messages', selected?.id] })
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const sendOfferMutation = useMutation({
    mutationFn: (offer: Offer) =>
      groupMessageApi.sendOffer(selected!.id, offer, { sendImage }),
    onSuccess: () => {
      setPickerOpen(false)
      setError(null)
      qc.invalidateQueries({ queryKey: ['group-messages', selected?.id] })
    },
    onError: (e) => {
      setPickerOpen(false)
      setError(apiErrorMessage(e))
    },
  })

  const groups = groupsQuery.data ?? []
  const messages = messagesQuery.data ?? []
  const sending = sendTextMutation.isPending || sendOfferMutation.isPending

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col">
      <div className="mb-4 flex items-center gap-3">
        <MessagesSquare className="text-violet-600" />
        <div>
          <h1 className="text-2xl font-bold">Mensagens dos grupos</h1>
          <p className="text-sm text-zinc-500">
            Veja o que chega nos grupos e envie ofertas escolhidas a dedo.
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        {/* Group list */}
        <Card className="flex min-h-0 flex-col lg:max-h-[calc(100vh-12rem)]">
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-zinc-200 px-2">
            <Search size={16} className="text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar grupo"
              className="w-full py-2 text-sm outline-none"
            />
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {groupsQuery.isLoading && (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            )}
            {groupsQuery.isError && (
              <p className="text-sm text-red-600">{apiErrorMessage(groupsQuery.error)}</p>
            )}
            {!groupsQuery.isLoading && groups.length === 0 && (
              <p className="py-8 text-center text-sm text-zinc-500">
                Nenhum grupo. Conecte um número com grupos.
              </p>
            )}
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => {
                  setSelected(g)
                  setError(null)
                }}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                  selected?.id === g.id
                    ? 'bg-violet-600 text-white'
                    : 'text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                <div className="truncate font-medium">{g.name}</div>
                <div
                  className={`text-xs ${selected?.id === g.id ? 'text-violet-100' : 'text-zinc-400'}`}
                >
                  {g.size} participante{g.size === 1 ? '' : 's'}
                  {g.announceOnly ? ' · só admin posta' : ''}
                </div>
              </button>
            ))}
          </div>
        </Card>

        {/* Thread */}
        <Card className="flex min-h-0 flex-col lg:max-h-[calc(100vh-12rem)]">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
              Selecione um grupo para ver as mensagens.
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between border-b border-zinc-100 pb-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{selected.name}</div>
                  {selected.announceOnly && (
                    <Badge tone="amber">Só administradores podem postar</Badge>
                  )}
                </div>
                <Button
                  variant="ghost"
                  onClick={() => messagesQuery.refetch()}
                  disabled={messagesQuery.isFetching}
                >
                  <RefreshCw size={16} /> Atualizar
                </Button>
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-lg bg-[#efeae2] p-3">
                {messagesQuery.isLoading && (
                  <div className="flex justify-center py-8">
                    <Spinner />
                  </div>
                )}
                {!messagesQuery.isLoading && messages.length === 0 && (
                  <p className="py-8 text-center text-sm text-zinc-500">
                    Nenhuma mensagem registrada ainda. As mensagens que chegam ao grupo aparecem
                    aqui depois que o webhook estiver sincronizado (página Conexão).
                  </p>
                )}
                {messages.map((m) => (
                  <MessageRow key={m.id} msg={m} />
                ))}
                <div ref={bottomRef} />
              </div>

              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

              {/* Composer */}
              <div className="mt-3 flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setPickerOpen(true)}
                  disabled={sending || selected.announceOnly}
                  title={selected.announceOnly ? 'Apenas administradores podem postar' : 'Enviar oferta'}
                >
                  <Tag size={16} /> Oferta
                </Button>
                <Input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
                      e.preventDefault()
                      sendTextMutation.mutate(text.trim())
                    }
                  }}
                  placeholder={
                    selected.announceOnly
                      ? 'Somente administradores podem enviar'
                      : 'Escreva uma mensagem…'
                  }
                  disabled={sending || selected.announceOnly}
                />
                <Button
                  onClick={() => text.trim() && sendTextMutation.mutate(text.trim())}
                  disabled={sending || !text.trim() || selected.announceOnly}
                >
                  <Send size={16} />
                  {sendTextMutation.isPending ? 'Enviando…' : 'Enviar'}
                </Button>
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
                <input
                  type="checkbox"
                  checked={sendImage}
                  onChange={(e) => setSendImage(e.target.checked)}
                />
                Enviar imagem do produto junto da oferta
              </label>
            </>
          )}
        </Card>
      </div>

      {pickerOpen && (
        <OfferPicker
          onClose={() => setPickerOpen(false)}
          onPick={(offer) => sendOfferMutation.mutate(offer)}
        />
      )}
    </div>
  )
}
