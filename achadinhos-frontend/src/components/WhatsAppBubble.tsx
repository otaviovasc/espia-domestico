import { type ReactNode } from 'react'

/**
 * Render WhatsApp inline formatting into React nodes:
 *   *bold*  _italic_  ~strikethrough~  ```monospace```
 * Applied per line; unmatched markers render literally.
 */
function renderInline(text: string): ReactNode[] {
  // Order matters: monospace (```) first, then * _ ~.
  const tokens: ReactNode[] = []
  const regex = /(```[^`]+```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) tokens.push(text.slice(lastIndex, match.index))
    const tok = match[0]
    if (tok.startsWith('```')) {
      tokens.push(
        <code key={key++} className="rounded bg-black/5 px-1 font-mono text-[0.85em]">
          {tok.slice(3, -3)}
        </code>,
      )
    } else if (tok.startsWith('*')) {
      tokens.push(<strong key={key++}>{tok.slice(1, -1)}</strong>)
    } else if (tok.startsWith('_')) {
      tokens.push(<em key={key++}>{tok.slice(1, -1)}</em>)
    } else if (tok.startsWith('~')) {
      tokens.push(
        <span key={key++} className="line-through">
          {tok.slice(1, -1)}
        </span>,
      )
    }
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) tokens.push(text.slice(lastIndex))
  return tokens
}

/** Linkify URLs while preserving the WhatsApp blue link colour. */
function renderLineWithLinks(line: string, keyBase: string): ReactNode[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const parts: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = urlRegex.exec(line)) !== null) {
    if (m.index > last) parts.push(...renderInline(line.slice(last, m.index)))
    parts.push(
      <span key={`${keyBase}-u${i++}`} className="text-[#53bdeb] underline">
        {m[0]}
      </span>,
    )
    last = urlRegex.lastIndex
  }
  if (last < line.length) parts.push(...renderInline(line.slice(last)))
  return parts
}

export function extractFirstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s]+/)
  return m ? m[0] : null
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export interface WhatsAppBubbleProps {
  message: string
  /** Image shown as a media bubble on top of the caption. */
  imageUrl?: string
  /** Whether to show the image bubble (send-image toggle). */
  showImage?: boolean
  /** Show a link-preview card for the first URL when no image is shown. */
  linkPreviewImageUrl?: string
  linkPreviewTitle?: string
}

/**
 * A single outgoing WhatsApp message bubble that mirrors the real client:
 * optional image on top, a link-preview card, formatted text, time + check
 * marks. Background is the WhatsApp chat wallpaper colour.
 */
export function WhatsAppBubble({
  message,
  imageUrl,
  showImage = true,
  linkPreviewImageUrl,
  linkPreviewTitle,
}: WhatsAppBubbleProps) {
  const url = extractFirstUrl(message)
  const lines = message.split('\n')
  const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  // Link preview only when we are NOT sending an image bubble (mirrors WhatsApp:
  // an image message shows the photo, a text message shows the link card).
  const showLinkCard = !showImage && !!url

  return (
    <div className="flex justify-end">
      <div className="relative max-w-[85%] rounded-lg rounded-tr-none bg-[#d9fdd3] p-1.5 shadow-sm">
        {showImage && imageUrl && (
          <img
            src={imageUrl}
            alt=""
            className="mb-1 max-h-60 w-full rounded-md object-cover"
            loading="lazy"
          />
        )}

        {showLinkCard && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mb-1 block overflow-hidden rounded-md bg-black/5"
          >
            {linkPreviewImageUrl && (
              <img
                src={linkPreviewImageUrl}
                alt=""
                className="max-h-40 w-full object-cover"
                loading="lazy"
              />
            )}
            <div className="p-2">
              {linkPreviewTitle && (
                <div className="line-clamp-2 text-xs font-medium text-zinc-800">
                  {linkPreviewTitle}
                </div>
              )}
              <div className="mt-0.5 text-[11px] uppercase text-zinc-500">{hostOf(url)}</div>
            </div>
          </a>
        )}

        <div className="whitespace-pre-wrap px-1.5 pb-4 text-sm leading-snug text-zinc-900">
          {lines.map((line, idx) => (
            <div key={idx}>{line ? renderLineWithLinks(line, `l${idx}`) : '\u00A0'}</div>
          ))}
        </div>

        <span className="absolute bottom-1 right-2 flex items-center gap-1 text-[10px] text-zinc-500">
          {now}
          <svg viewBox="0 0 16 11" width="14" height="11" className="text-[#53bdeb]">
            <path
              fill="currentColor"
              d="M11.07.65a.5.5 0 0 0-.7.03L5.4 6.1 3.32 3.9a.5.5 0 1 0-.73.68l2.45 2.6a.5.5 0 0 0 .72 0l5.34-5.83a.5.5 0 0 0-.03-.7Z"
            />
            <path
              fill="currentColor"
              d="M15.07.65a.5.5 0 0 0-.7.03L9 6.13l.72.76 5.38-5.87a.5.5 0 0 0-.03-.37Z"
            />
          </svg>
        </span>
      </div>
    </div>
  )
}
