import type { AdOverlay } from './api.ts'

export const MAX_COMPOSITION_LAYERS = 8

export function newCompositionLayer(type: AdOverlay['type'], id: string, assetId?: number): AdOverlay {
  const base = { id, name: type === 'text' ? 'Texto' : type === 'shape' ? 'Forma' : 'Imagem', x: 10, y: 10, width: 80, height: 20, opacity: 1, hidden: false }
  if (type === 'text') return { ...base, type, text: 'Seu texto aqui', color: '#FFFFFF', fontSize: 64, backgroundColor: '#18181B' }
  if (type === 'shape') return { ...base, type, shape: 'rectangle', color: '#FFFFFF' }
  return { ...base, type, assetId: assetId ?? 0, width: 25, height: 25, fit: 'contain' }
}

export function moveCompositionLayer(layers: AdOverlay[], id: string, offset: number): AdOverlay[] {
  const index = layers.findIndex((layer) => layer.id === id)
  const target = index + offset
  if (index < 0 || target < 0 || target >= layers.length) return layers
  const result = [...layers]
  ;[result[index], result[target]] = [result[target], result[index]]
  return result
}

export function duplicateCompositionLayer(layers: AdOverlay[], id: string, newId: string): AdOverlay[] {
  if (layers.length >= MAX_COMPOSITION_LAYERS) return layers
  const index = layers.findIndex((layer) => layer.id === id)
  if (index < 0) return layers
  const original = layers[index]
  const copy = { ...original, id: newId, name: `${original.name} (cópia)`.slice(0, 80), x: Math.min(100, original.x + 2), y: Math.min(100, original.y + 2) }
  return [...layers.slice(0, index + 1), copy, ...layers.slice(index + 1)]
}

/** Deliberately deterministic character wrapping, shared with the export renderer. */
export function wrapCompositionText(text: string, width: number, fontSize: number): string[] {
  const maxChars = Math.max(1, Math.floor((width - fontSize * 0.5) / (fontSize * 0.6)))
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let remaining = Array.from(paragraph)
    if (!remaining.length) { lines.push(''); continue }
    while (remaining.length > maxChars) {
      const chunk = remaining.slice(0, maxChars + 1)
      let breakAt = -1
      for (let i = Math.min(maxChars, chunk.length - 1); i > 0; i--) {
        if (/\s/.test(chunk[i])) { breakAt = i; break }
      }
      if (breakAt < 1) breakAt = maxChars
      lines.push(remaining.slice(0, breakAt).join('').trimEnd())
      remaining = remaining.slice(breakAt)
      while (remaining.length && /\s/.test(remaining[0])) remaining.shift()
    }
    if (remaining.length) lines.push(remaining.join(''))
  }
  return lines
}

export function compositionGeometry(layer: AdOverlay, output: { width: number; height: number }) {
  return { x: layer.x / 100 * output.width, y: layer.y / 100 * output.height, width: layer.width / 100 * output.width, height: layer.height / 100 * output.height }
}
