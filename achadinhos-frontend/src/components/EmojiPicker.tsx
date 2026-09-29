import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Search, SmilePlus, X } from 'lucide-react'

type EmojiCategoryId = 'popular' | 'offers' | 'reactions' | 'home' | 'objects' | 'symbols'

type EmojiOption = {
  emoji: string
  label: string
  keywords: string
  category: EmojiCategoryId
}

const RECENT_EMOJI_KEY = 'ad-copy-recent-emojis-v1'
const EMOJI_COLUMNS = 8

const CATEGORIES: Array<{ id: EmojiCategoryId; label: string }> = [
  { id: 'popular', label: 'Mais usados' },
  { id: 'offers', label: 'Ofertas' },
  { id: 'reactions', label: 'Reações' },
  { id: 'home', label: 'Casa' },
  { id: 'objects', label: 'Produtos' },
  { id: 'symbols', label: 'Símbolos' },
]

const EMOJIS: EmojiOption[] = [
  { emoji: '🔥', label: 'Fogo', keywords: 'fogo quente viral oferta', category: 'popular' },
  { emoji: '✨', label: 'Brilhos', keywords: 'brilho novo mágico destaque', category: 'popular' },
  { emoji: '🚀', label: 'Foguete', keywords: 'foguete lançamento rápido', category: 'popular' },
  { emoji: '😍', label: 'Apaixonado', keywords: 'amor apaixonado gostei', category: 'popular' },
  { emoji: '🤩', label: 'Encantado', keywords: 'estrela encantado incrível', category: 'popular' },
  { emoji: '👀', label: 'Olhos', keywords: 'olha veja atenção', category: 'popular' },
  { emoji: '❤️', label: 'Coração vermelho', keywords: 'amor coração favorito', category: 'popular' },
  { emoji: '⭐', label: 'Estrela', keywords: 'estrela destaque avaliação', category: 'popular' },
  { emoji: '⚡', label: 'Raio', keywords: 'raio rápido energia oferta', category: 'popular' },
  { emoji: '💥', label: 'Explosão', keywords: 'explosão impacto promoção', category: 'popular' },
  { emoji: '🎉', label: 'Festa', keywords: 'festa comemoração novidade', category: 'popular' },
  { emoji: '🙌', label: 'Mãos levantadas', keywords: 'mãos comemoração sucesso', category: 'popular' },
  { emoji: '👍', label: 'Curtir', keywords: 'curtir aprovado gostei', category: 'popular' },
  { emoji: '💯', label: 'Cem pontos', keywords: 'cem perfeito garantido', category: 'popular' },
  { emoji: '✅', label: 'Confirmado', keywords: 'confirmado certo aprovado', category: 'popular' },
  { emoji: '📌', label: 'Alfinete', keywords: 'salvar atenção importante', category: 'popular' },

  { emoji: '🏷️', label: 'Etiqueta', keywords: 'etiqueta preço desconto', category: 'offers' },
  { emoji: '🤑', label: 'Rosto com dinheiro', keywords: 'dinheiro economia promoção', category: 'offers' },
  { emoji: '💸', label: 'Dinheiro voando', keywords: 'dinheiro desconto economia', category: 'offers' },
  { emoji: '🎁', label: 'Presente', keywords: 'presente brinde grátis', category: 'offers' },
  { emoji: '⏰', label: 'Despertador', keywords: 'tempo urgente acaba hoje', category: 'offers' },
  { emoji: '🚨', label: 'Alerta', keywords: 'alerta urgente atenção', category: 'offers' },
  { emoji: '📦', label: 'Caixa', keywords: 'caixa pacote entrega produto', category: 'offers' },
  { emoji: '🛒', label: 'Carrinho', keywords: 'comprar carrinho loja', category: 'offers' },
  { emoji: '💳', label: 'Cartão', keywords: 'cartão pagamento parcela', category: 'offers' },
  { emoji: '💰', label: 'Saco de dinheiro', keywords: 'dinheiro preço economia', category: 'offers' },
  { emoji: '🆓', label: 'Grátis', keywords: 'grátis gratuito brinde', category: 'offers' },
  { emoji: '📉', label: 'Preço caiu', keywords: 'queda preço barato desconto', category: 'offers' },
  { emoji: '🚚', label: 'Caminhão', keywords: 'frete entrega envio', category: 'offers' },
  { emoji: '🔖', label: 'Marcador', keywords: 'etiqueta promoção preço', category: 'offers' },
  { emoji: '⏳', label: 'Ampulheta', keywords: 'tempo acabando último', category: 'offers' },
  { emoji: '🛍️', label: 'Sacolas', keywords: 'compras loja oferta', category: 'offers' },

  { emoji: '😀', label: 'Sorriso', keywords: 'feliz sorriso alegria', category: 'reactions' },
  { emoji: '😂', label: 'Rindo', keywords: 'rindo engraçado lágrimas', category: 'reactions' },
  { emoji: '😱', label: 'Surpreso', keywords: 'surpresa choque nossa', category: 'reactions' },
  { emoji: '🤯', label: 'Mente explodindo', keywords: 'incrível surpresa mente', category: 'reactions' },
  { emoji: '🥳', label: 'Comemorando', keywords: 'festa comemoração parabéns', category: 'reactions' },
  { emoji: '🥰', label: 'Carinhoso', keywords: 'amor carinho apaixonado', category: 'reactions' },
  { emoji: '😋', label: 'Delicioso', keywords: 'gostoso delicioso comida', category: 'reactions' },
  { emoji: '👏', label: 'Aplausos', keywords: 'aplausos parabéns aprovado', category: 'reactions' },
  { emoji: '🤝', label: 'Aperto de mãos', keywords: 'acordo confiança parceria', category: 'reactions' },
  { emoji: '🙏', label: 'Agradecimento', keywords: 'obrigado gratidão pedido', category: 'reactions' },
  { emoji: '💜', label: 'Coração roxo', keywords: 'amor coração roxo', category: 'reactions' },
  { emoji: '💚', label: 'Coração verde', keywords: 'amor coração verde', category: 'reactions' },
  { emoji: '🤍', label: 'Coração branco', keywords: 'amor coração branco', category: 'reactions' },
  { emoji: '💪', label: 'Força', keywords: 'força resistente potente', category: 'reactions' },
  { emoji: '🤔', label: 'Pensando', keywords: 'pensando dúvida curiosidade', category: 'reactions' },
  { emoji: '😎', label: 'Óculos escuros', keywords: 'legal estilo confiança', category: 'reactions' },

  { emoji: '🏠', label: 'Casa', keywords: 'casa lar doméstico', category: 'home' },
  { emoji: '🏡', label: 'Casa com jardim', keywords: 'casa jardim lar', category: 'home' },
  { emoji: '🛋️', label: 'Sofá', keywords: 'sofá sala móveis', category: 'home' },
  { emoji: '🛏️', label: 'Cama', keywords: 'cama quarto dormir', category: 'home' },
  { emoji: '🚿', label: 'Chuveiro', keywords: 'chuveiro banheiro banho', category: 'home' },
  { emoji: '🍳', label: 'Cozinhando', keywords: 'cozinha panela ovo', category: 'home' },
  { emoji: '🧹', label: 'Vassoura', keywords: 'limpeza vassoura casa', category: 'home' },
  { emoji: '🧼', label: 'Sabão', keywords: 'limpeza sabão higiene', category: 'home' },
  { emoji: '🧽', label: 'Esponja', keywords: 'limpeza esponja cozinha', category: 'home' },
  { emoji: '🪴', label: 'Planta', keywords: 'planta decoração jardim', category: 'home' },
  { emoji: '🧺', label: 'Cesto', keywords: 'cesto roupa organização', category: 'home' },
  { emoji: '🧴', label: 'Frasco', keywords: 'frasco limpeza beleza', category: 'home' },
  { emoji: '🪞', label: 'Espelho', keywords: 'espelho decoração beleza', category: 'home' },
  { emoji: '🧊', label: 'Gelo', keywords: 'gelo gelado cozinha', category: 'home' },
  { emoji: '🍽️', label: 'Pratos', keywords: 'pratos cozinha mesa', category: 'home' },
  { emoji: '🫧', label: 'Bolhas', keywords: 'bolhas limpeza brilho', category: 'home' },

  { emoji: '📱', label: 'Celular', keywords: 'celular telefone tecnologia', category: 'objects' },
  { emoji: '🎧', label: 'Fones', keywords: 'fone áudio música', category: 'objects' },
  { emoji: '🔌', label: 'Tomada', keywords: 'tomada energia carregador', category: 'objects' },
  { emoji: '🔋', label: 'Bateria', keywords: 'bateria energia carga', category: 'objects' },
  { emoji: '💡', label: 'Lâmpada', keywords: 'luz lâmpada ideia', category: 'objects' },
  { emoji: '🛠️', label: 'Ferramentas', keywords: 'ferramentas conserto utilidade', category: 'objects' },
  { emoji: '✂️', label: 'Tesoura', keywords: 'tesoura cortar ferramenta', category: 'objects' },
  { emoji: '💄', label: 'Batom', keywords: 'batom beleza maquiagem', category: 'objects' },
  { emoji: '👟', label: 'Tênis', keywords: 'tênis calçado moda', category: 'objects' },
  { emoji: '👗', label: 'Vestido', keywords: 'vestido roupa moda', category: 'objects' },
  { emoji: '👜', label: 'Bolsa', keywords: 'bolsa moda acessório', category: 'objects' },
  { emoji: '🎒', label: 'Mochila', keywords: 'mochila bolsa escola', category: 'objects' },
  { emoji: '⌚', label: 'Relógio', keywords: 'relógio tempo acessório', category: 'objects' },
  { emoji: '🕶️', label: 'Óculos', keywords: 'óculos sol acessório', category: 'objects' },
  { emoji: '🧸', label: 'Ursinho', keywords: 'brinquedo criança presente', category: 'objects' },
  { emoji: '🐾', label: 'Patinhas', keywords: 'pet animal cachorro gato', category: 'objects' },

  { emoji: '❌', label: 'Errado', keywords: 'errado não proibido', category: 'symbols' },
  { emoji: '⚠️', label: 'Atenção', keywords: 'atenção aviso cuidado', category: 'symbols' },
  { emoji: '❗', label: 'Exclamação', keywords: 'atenção importante exclamação', category: 'symbols' },
  { emoji: '❓', label: 'Interrogação', keywords: 'dúvida pergunta interrogação', category: 'symbols' },
  { emoji: '📣', label: 'Megafone', keywords: 'anúncio novidade atenção', category: 'symbols' },
  { emoji: '⬇️', label: 'Seta para baixo', keywords: 'seta baixo clique', category: 'symbols' },
  { emoji: '➡️', label: 'Seta para direita', keywords: 'seta direita próximo', category: 'symbols' },
  { emoji: '↘️', label: 'Seta diagonal', keywords: 'seta diagonal abaixo', category: 'symbols' },
  { emoji: '🔗', label: 'Link', keywords: 'link ligação acesso', category: 'symbols' },
  { emoji: '📍', label: 'Localização', keywords: 'local endereço mapa', category: 'symbols' },
  { emoji: '🔴', label: 'Círculo vermelho', keywords: 'vermelho alerta ponto', category: 'symbols' },
  { emoji: '🟢', label: 'Círculo verde', keywords: 'verde disponível ponto', category: 'symbols' },
  { emoji: '🔢', label: 'Números', keywords: 'números contagem lista', category: 'symbols' },
  { emoji: '🥇', label: 'Primeiro lugar', keywords: 'primeiro prêmio melhor', category: 'symbols' },
  { emoji: '🎯', label: 'Alvo', keywords: 'alvo objetivo certeiro', category: 'symbols' },
  { emoji: '🔝', label: 'Topo', keywords: 'topo melhor acima', category: 'symbols' },
]

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim()
}

function readRecentEmojis(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = JSON.parse(window.localStorage.getItem(RECENT_EMOJI_KEY) ?? '[]') as unknown
    if (!Array.isArray(stored)) return []
    const allowed = new Set(EMOJIS.map((item) => item.emoji))
    return stored.filter((item): item is string => typeof item === 'string' && allowed.has(item)).slice(0, 16)
  } catch {
    return []
  }
}

export interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  ariaLabel?: string
  disabled?: boolean
  align?: 'left' | 'right'
}

export default function EmojiPicker({
  onSelect,
  ariaLabel = 'Adicionar emoji',
  disabled = false,
  align = 'left',
}: EmojiPickerProps) {
  const pickerId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<EmojiCategoryId>('popular')
  const [recent, setRecent] = useState<string[]>(readRecentEmojis)
  const [announcement, setAnnouncement] = useState('')

  const visibleEmojis = useMemo(() => {
    const normalizedQuery = normalizeSearch(query)
    if (normalizedQuery) {
      return EMOJIS.filter((item) => normalizeSearch(`${item.label} ${item.keywords}`).includes(normalizedQuery))
    }
    if (category === 'popular' && recent.length > 0) {
      const byEmoji = new Map(EMOJIS.map((item) => [item.emoji, item]))
      const recentOptions = recent.flatMap((emoji) => {
        const item = byEmoji.get(emoji)
        return item ? [item] : []
      })
      const seen = new Set(recentOptions.map((item) => item.emoji))
      return [...recentOptions, ...EMOJIS.filter((item) => item.category === 'popular' && !seen.has(item.emoji))]
    }
    return EMOJIS.filter((item) => item.category === category)
  }, [category, query, recent])

  useEffect(() => {
    if (!open) return undefined

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.requestAnimationFrame(() => searchRef.current?.focus())
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  function togglePicker() {
    if (!open) {
      setQuery('')
      setAnnouncement('')
    }
    setOpen(!open)
  }

  function selectEmoji(item: EmojiOption) {
    onSelect(item.emoji)
    setAnnouncement(`${item.label} inserido`)
    setRecent((current) => {
      const next = [item.emoji, ...current.filter((emoji) => emoji !== item.emoji)].slice(0, 16)
      try {
        window.localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(next))
      } catch {
        // Recent choices are optional when browser storage is unavailable.
      }
      return next
    })
  }

  function moveGridFocus(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index
    if (event.key === 'ArrowRight') nextIndex = Math.min(visibleEmojis.length - 1, index + 1)
    else if (event.key === 'ArrowLeft') nextIndex = Math.max(0, index - 1)
    else if (event.key === 'ArrowDown') nextIndex = Math.min(visibleEmojis.length - 1, index + EMOJI_COLUMNS)
    else if (event.key === 'ArrowUp') nextIndex = Math.max(0, index - EMOJI_COLUMNS)
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = visibleEmojis.length - 1
    else return

    event.preventDefault()
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-emoji-index="${nextIndex}"]`)?.focus()
  }

  return (
    <div ref={rootRef} className="emoji-picker-root">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? pickerId : undefined}
        onClick={togglePicker}
        className="emoji-picker-trigger"
      >
        <SmilePlus size={15} aria-hidden="true" />
        Emoji
      </button>

      {open ? (
        <div
          id={pickerId}
          role="dialog"
          aria-label="Seletor de emojis"
          className={`emoji-picker-panel ${align === 'right' ? 'emoji-picker-panel-right' : ''}`}
        >
          <div className="emoji-picker-header">
            <label className="emoji-picker-search">
              <Search size={14} aria-hidden="true" />
              <span className="sr-only">Buscar emoji</span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar emoji"
                autoComplete="off"
              />
            </label>
            <button type="button" onClick={() => setOpen(false)} className="emoji-picker-close" aria-label="Fechar seletor de emojis">
              <X size={15} aria-hidden="true" />
            </button>
          </div>

          <div className="emoji-picker-categories" aria-label="Categorias de emoji">
            {CATEGORIES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={!query && category === item.id}
                onClick={() => {
                  setCategory(item.id)
                  setQuery('')
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          {visibleEmojis.length > 0 ? (
            <div className="emoji-picker-grid" role="group" aria-label={query ? 'Resultados da busca' : CATEGORIES.find((item) => item.id === category)?.label}>
              {visibleEmojis.map((item, index) => (
                <button
                  key={item.emoji}
                  type="button"
                  data-emoji-index={index}
                  title={item.label}
                  aria-label={`Inserir ${item.label}`}
                  onClick={() => selectEmoji(item)}
                  onKeyDown={(event) => moveGridFocus(event, index)}
                >
                  {item.emoji}
                </button>
              ))}
            </div>
          ) : (
            <p className="emoji-picker-empty">Nenhum emoji encontrado.</p>
          )}
          <p className="sr-only" aria-live="polite">{announcement}</p>
          <p className="emoji-picker-tip">Use as setas para navegar e Enter para inserir.</p>
        </div>
      ) : null}
    </div>
  )
}
