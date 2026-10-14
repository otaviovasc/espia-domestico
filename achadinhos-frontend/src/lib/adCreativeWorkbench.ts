import type { AdAsset, AdClipEdit, AdOverlay, AdProject, AdProjectConfig } from './api.ts'

export const MAX_RECIPE_BYTES = 1024 * 1024
export const STORYBOARD_GOALS = [
  { id: 'showcase', name: 'Apresentar produto', description: 'Produto inteiro, cortes suaves e cenas de 2,5 s.' },
  { id: 'comparison', name: 'Comparar produtos', description: 'Enquadramento inteiro e tempo para ler cada detalhe.' },
  { id: 'offer', name: 'Destacar oferta', description: 'Abertura curta e cortes diretos com os textos existentes.' },
] as const
export type StoryboardGoal = typeof STORYBOARD_GOALS[number]['id']

/** Changes presentation only. Product facts, asset references and audio are retained. */
export function stageStoryboard(config: AdProjectConfig, goal: StoryboardGoal, addCta = false): AdProjectConfig {
  const next = structuredClone(config)
  const comparison = goal === 'comparison'
  next.framing = { ...next.framing, mode: comparison ? 'contain-solid' : 'contain-blur' }
  next.timing = { mode: 'fixed', seconds: goal === 'offer' ? 1.5 : comparison ? 4 : 2.5 }
  next.transition = { ...next.transition, preset: goal === 'offer' ? 'cut' : 'dissolve', durationSeconds: comparison ? 0.5 : 0.35 }
  next.textStyle = { ...next.textStyle, positionY: comparison ? 75 : 70 }
  if (next.carousel) next.carousel.slides = next.carousel.slides.map(slide => ({
    ...slide,
    durationSeconds: goal === 'offer' ? 4 : comparison ? 7 : 5,
    textStyle: { ...(slide.textStyle ?? next.textStyle), positionY: comparison ? 75 : 70 },
  }))
  if (goal === 'offer' && next.kind !== 'carousel' && next.selectedClipIds.length) {
    next.hook = { ...next.hook, enabled: true, clipAssetId: next.hook.clipAssetId ?? next.selectedClipIds[0], durationSeconds: 1.5, text: next.hook.text || next.texts[0] || '' }
    // Existing long product facts remain in texts; the opening overlay has its own limit.
    if (next.hook.text.length > 120) next.hook.text = config.hook.text
  }
  if (addCta) {
    const cta = 'Veja os detalhes no link.'
    if (next.kind === 'carousel') {
      const slides = next.carousel?.slides ?? []
      const slide = slides[slides.length - 1]
      if (!slide) throw new Error('Adicione slides antes de inserir a chamada final.')
      const text = slide.text ? `${slide.text}\n${cta}` : cta
      if (text.length > 280) throw new Error('O último slide não tem espaço para a chamada. Seus textos foram preservados.')
      slide.text = text
    } else {
      const layers = next.overlays ?? []
      if (layers.length >= 8) throw new Error('O projeto já tem 8 camadas. Remova uma camada antes de adicionar a chamada; seus textos foram preservados.')
      const usedIds = new Set(layers.map(layer => layer.id.trim()))
      let layerId = 'recipe-cta'
      for (let suffix = 2; usedIds.has(layerId); suffix += 1) layerId = `recipe-cta-${suffix}`
      // Composition overlays render throughout the video, independently of the rotating text pool.
      next.overlays = [...layers, overlay({
        id: layerId, name: 'Chamada em todas as cenas', type: 'text', text: cta,
        x: 8, y: 60, width: 76, height: 10, opacity: 1, hidden: false,
        fontSize: 48, color: '#FFFFFF', backgroundColor: '#18181B',
      })]
    }
  }
  return next
}

type Plain = Record<string, unknown>
function object(value: unknown, keys: string[], label: string): Plain {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: objeto inválido.`)
  const result = value as Plain
  if (Object.keys(result).some(key => !keys.includes(key))) throw new Error(`${label}: campo desconhecido.`)
  return result
}
function number(value: unknown, min: number, max: number, label: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${label}: número fora do limite.`)
  return value
}
function text(value: unknown, max: number, label: string, min = 0): string {
  if (typeof value !== 'string' || value.length > max || value.trim().length < min) throw new Error(`${label}: texto inválido.`)
  return value
}
function choice<T extends string | number>(value: unknown, choices: readonly T[], label: string): T {
  if (!choices.includes(value as T)) throw new Error(`${label}: opção inválida.`)
  return value as T
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}: valor inválido.`)
  return value
}
function array<T>(value: unknown, max: number, parse: (item: unknown) => T, label: string, min = 0): T[] {
  if (!Array.isArray(value) || value.length > max || value.length < min) throw new Error(`${label}: quantidade inválida.`)
  return value.map(parse)
}
const id = (value: unknown) => number(value, 1, Number.MAX_SAFE_INTEGER, 'Referência de mídia', true)
const nullableId = (value: unknown) => value === null ? null : id(value)
const nullableNumber = (value: unknown, min: number, max: number, label: string) => value === null ? null : number(value, min, max, label)
function color(value: unknown): string {
  const result = text(value, 7, 'Cor')
  if (!/^#[0-9a-f]{6}$/i.test(result)) throw new Error('Cor inválida.')
  return result
}
function textStyle(value: unknown): AdProjectConfig['textStyle'] {
  const p = object(value, ['fontSize', 'positionY', 'fontColor', 'borderColor', 'borderWidth'], 'Estilo do texto')
  return { fontSize: number(p.fontSize, 36, 140, 'Fonte', true), positionY: number(p.positionY, 15, 85, 'Posição do texto', true), fontColor: color(p.fontColor), borderColor: color(p.borderColor), borderWidth: number(p.borderWidth, 0, 12, 'Contorno', true) }
}
function clipEdit(value: unknown): AdClipEdit {
  const p = object(value, ['trimStart', 'trimEnd', 'speed', 'framingOverride', 'focusX', 'focusY', 'zoom', 'volume', 'motion'], 'Ajuste de mídia')
  const result: AdClipEdit = {
    trimStart: number(p.trimStart, 0, 3600, 'Início do recorte'), trimEnd: nullableNumber(p.trimEnd, 0, 3600, 'Fim do recorte'),
    speed: choice(p.speed, [0.5, 0.75, 1, 1.25, 1.5, 2] as const, 'Velocidade'), framingOverride: bool(p.framingOverride, 'Enquadramento'),
    focusX: number(p.focusX, 0, 100, 'Foco X', true), focusY: number(p.focusY, 0, 100, 'Foco Y', true), zoom: number(p.zoom, 1, 3, 'Zoom'),
    ...(p.volume === undefined ? {} : { volume: number(p.volume, 0, 1, 'Volume') }),
    ...(p.motion === undefined ? {} : { motion: choice(p.motion, ['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right'] as const, 'Movimento') }),
  }
  if (result.trimEnd !== null && result.trimEnd - result.trimStart < 0.25) throw new Error('Recorte precisa de ao menos 0,25 s.')
  return result
}

function overlay(value: unknown): AdOverlay {
  const p = object(value, ['id', 'name', 'type', 'x', 'y', 'width', 'height', 'opacity', 'hidden', 'text', 'color', 'fontSize', 'backgroundColor', 'shape', 'assetId', 'fit'], 'Camada')
  const type = choice(p.type, ['text', 'shape', 'image'] as const, 'Tipo de camada')
  const normalizedId = typeof p.id === 'string' ? p.id.trim() : p.id
  const common = { id: text(normalizedId, 64, 'Identificador da camada', 1), name: text(p.name, 80, 'Nome da camada'), x: number(p.x, 0, 100, 'Posição X'), y: number(p.y, 0, 100, 'Posição Y'), width: number(p.width, 1, 100, 'Largura da camada'), height: number(p.height, 1, 100, 'Altura da camada'), opacity: number(p.opacity, 0, 1, 'Opacidade'), hidden: bool(p.hidden, 'Visibilidade') }
  const commonKeys = ['id', 'name', 'type', 'x', 'y', 'width', 'height', 'opacity', 'hidden']
  if (type === 'text') {
    object(p, [...commonKeys, 'text', 'color', 'fontSize', 'backgroundColor'], 'Camada de texto')
    return { ...common, type, text: text(p.text, 280, 'Texto da camada'), color: color(p.color), fontSize: number(p.fontSize, 12, 200, 'Fonte da camada', true), backgroundColor: color(p.backgroundColor) }
  }
  if (type === 'shape') {
    object(p, [...commonKeys, 'shape', 'color'], 'Camada de forma')
    return { ...common, type, shape: choice(p.shape, ['rectangle', 'ellipse'] as const, 'Forma'), color: color(p.color) }
  }
  object(p, [...commonKeys, 'assetId', 'fit'], 'Camada de imagem')
  return { ...common, type, assetId: id(p.assetId), fit: choice(p.fit, ['contain', 'cover'] as const, 'Enquadramento da camada') }
}

/** Enumerates every supported field; never casts an imported JSON object to a config. */
export function validateRecipeConfig(value: unknown): AdProjectConfig {
  const p = object(value, ['kind', 'carousel', 'variationCount', 'texts', 'selectedClipIds', 'clipEdits', 'musicAssetId', 'musicVolume', 'musicTracks', 'timing', 'transition', 'output', 'framing', 'colorPreset', 'visualEffects', 'hook', 'textStyle', 'overlays', 'audioFinishing'], 'Configuração')
  const output = object(p.output, ['width', 'height', 'durationSeconds', 'fps'], 'Saída')
  const framing = object(p.framing, ['mode', 'focusX', 'focusY', 'backgroundColor'], 'Enquadramento')
  const transition = object(p.transition, ['preset', 'durationSeconds', 'sfx', 'sfxVolume'], 'Transição')
  const effects = object(p.visualEffects, ['preset', 'brightness', 'contrast', 'saturation', 'sharpness', 'temperature', 'vignette', 'grain', 'glow'], 'Efeitos')
  const hook = object(p.hook, ['enabled', 'clipAssetId', 'durationSeconds', 'text'], 'Abertura')
  const timing = object(p.timing, ['mode', 'seconds'], 'Ritmo')
  const edits = object(p.clipEdits, Object.keys((p.clipEdits && typeof p.clipEdits === 'object') ? p.clipEdits : {}), 'Ajustes')
  const selectedClipIds = array(p.selectedClipIds, 50, id, 'Mídias selecionadas')
  if (new Set(selectedClipIds).size !== selectedClipIds.length) throw new Error('Mídias selecionadas repetidas.')
  const kind = choice(p.kind ?? 'video', ['video', 'carousel'] as const, 'Tipo')
  const overlays = array(p.overlays ?? [], 8, overlay, 'Camadas')
  if (new Set(overlays.map(layer => layer.id)).size !== overlays.length) throw new Error('Identificadores de camada repetidos.')
  const audio = object(p.audioFinishing ?? { normalizeLoudness: false, targetLufs: -14 }, ['normalizeLoudness', 'targetLufs'], 'Finalização do áudio')
  const config: AdProjectConfig = {
    kind, overlays,
    audioFinishing: { normalizeLoudness: bool(audio.normalizeLoudness, 'Normalização de volume'), targetLufs: choice(audio.targetLufs, [-16, -14, -12] as const, 'Volume alvo') },
    variationCount: number(p.variationCount, 1, 20, 'Variações', true),
    texts: array(p.texts, 20, item => text(item, 280, 'Texto', 1), 'Textos', kind === 'carousel' ? 0 : 1), selectedClipIds,
    clipEdits: Object.fromEntries(Object.entries(edits).map(([key, value]) => {
      if (!/^[1-9]\d*$/.test(key) || !selectedClipIds.includes(id(Number(key)))) throw new Error('Ajuste de mídia fora da seleção.')
      return [key, clipEdit(value)]
    })),
    musicAssetId: nullableId(p.musicAssetId), musicVolume: number(p.musicVolume, 0, 1, 'Volume da música'),
    musicTracks: array(p.musicTracks, 8, item => {
      const track = object(item, ['assetId', 'volume', 'startSeconds', 'endSeconds', 'sourceStartSeconds', 'fadeInSeconds', 'fadeOutSeconds'], 'Faixa')
      return { assetId: id(track.assetId), volume: number(track.volume, 0, 1, 'Volume'), startSeconds: number(track.startSeconds, 0, 60, 'Início'), endSeconds: nullableNumber(track.endSeconds, 0, 60, 'Fim'), sourceStartSeconds: number(track.sourceStartSeconds, 0, 3600, 'Início na fonte'), fadeInSeconds: number(track.fadeInSeconds, 0, 5, 'Fade inicial'), fadeOutSeconds: number(track.fadeOutSeconds, 0, 5, 'Fade final') }
    }, 'Faixas'),
    timing: choice(timing.mode, ['fixed', 'beat'] as const, 'Ritmo') === 'beat' ? { mode: 'beat' } : { mode: 'fixed', seconds: number(timing.seconds, 0.5, 15, 'Tempo de cena') },
    transition: { preset: choice(transition.preset, ['cut', 'fade', 'dissolve', 'slide-left', 'slide-up', 'zoom'] as const, 'Transição'), durationSeconds: number(transition.durationSeconds, 0.1, 1.5, 'Tempo da transição'), sfx: choice(transition.sfx, ['none', 'whoosh', 'pop', 'click'] as const, 'Som da transição'), sfxVolume: number(transition.sfxVolume, 0, 0.5, 'Volume da transição') },
    output: { width: number(output.width, 360, 2160, 'Largura', true), height: number(output.height, 640, 3840, 'Altura', true), durationSeconds: number(output.durationSeconds, 3, 60, 'Duração'), fps: choice(output.fps, [24, 25, 30] as const, 'FPS') },
    framing: { mode: choice(framing.mode, ['cover', 'contain-blur', 'contain-solid'] as const, 'Enquadramento'), focusX: number(framing.focusX, 0, 100, 'Foco X', true), focusY: number(framing.focusY, 0, 100, 'Foco Y', true), backgroundColor: color(framing.backgroundColor) },
    colorPreset: choice(p.colorPreset, ['natural', 'vibrant', 'warm', 'cool', 'none'] as const, 'Cor'),
    visualEffects: { preset: choice(effects.preset, ['natural', 'clean-product', 'warm-ugc', 'vivid', 'cinematic', 'custom'] as const, 'Efeito'), brightness: number(effects.brightness, -1, 1, 'Brilho'), contrast: number(effects.contrast, 0.5, 2, 'Contraste'), saturation: number(effects.saturation, 0, 3, 'Saturação'), sharpness: number(effects.sharpness, 0, 2, 'Nitidez'), temperature: number(effects.temperature, -1, 1, 'Temperatura'), vignette: number(effects.vignette, 0, 1, 'Vinheta'), grain: number(effects.grain, 0, 1, 'Grão'), glow: number(effects.glow, 0, 1, 'Glow') },
    hook: { enabled: bool(hook.enabled, 'Abertura'), clipAssetId: nullableId(hook.clipAssetId), durationSeconds: number(hook.durationSeconds, 0.5, 5, 'Duração da abertura'), text: text(hook.text, 120, 'Texto da abertura') },
    textStyle: textStyle(p.textStyle),
  }
  if (p.carousel !== undefined) {
    const carousel = object(p.carousel, ['slides', 'caption'], 'Carrossel')
    config.carousel = { caption: text(carousel.caption, 2200, 'Legenda'), slides: array(carousel.slides, 20, item => {
      const slide = object(item, ['assetId', 'text', 'durationSeconds', 'edit', 'textStyle'], 'Slide')
      return { assetId: id(slide.assetId), text: text(slide.text, 280, 'Texto do slide'), durationSeconds: number(slide.durationSeconds, 3, 60, 'Tempo do slide'), ...(slide.edit === undefined ? {} : { edit: clipEdit(slide.edit) }), ...(slide.textStyle === undefined ? {} : { textStyle: textStyle(slide.textStyle) }) }
    }, 'Slides') }
  }
  if (config.output.width % 2 || config.output.height % 2) throw new Error('A saída precisa de dimensões pares.')
  if (config.kind === 'carousel' && (config.output.width !== 1080 || ![1080, 1350].includes(config.output.height))) throw new Error('O carrossel precisa de 1080×1080 ou 1080×1350.')
  if (config.hook.clipAssetId !== null && !selectedClipIds.includes(config.hook.clipAssetId)) throw new Error('A mídia de abertura precisa estar selecionada.')
  for (const track of config.musicTracks) {
    const end = track.endSeconds ?? config.output.durationSeconds
    if (end > config.output.durationSeconds || track.startSeconds >= end || end - track.startSeconds < 0.1 || track.fadeInSeconds + track.fadeOutSeconds > end - track.startSeconds + 0.01) throw new Error('Intervalo da música inválido.')
  }
  return config
}

export interface RecipeMedia {
  key: number
  filename: string
  kind: AdAsset['kind']
  width: number | null
  height: number | null
  durationSeconds: number
}
export interface CreativeRecipePackage {
  format: 'espia-creative-recipe'
  version: 1
  name: string
  media: RecipeMedia[]
  config: AdProjectConfig
}
export interface RecipeReview {
  recipe: CreativeRecipePackage
  config: AdProjectConfig | null
  matches: { media: RecipeMedia; asset: AdAsset | null; issue: 'missing' | 'ambiguous' | null }[]
}
function basename(value: string): string { const parts = value.split(/[\\/]/); return parts[parts.length - 1] ?? '' }
function references(config: AdProjectConfig): number[] {
  return [...new Set([...config.selectedClipIds, ...(config.carousel?.slides.map(slide => slide.assetId) ?? []), ...config.musicTracks.map(track => track.assetId), ...(config.musicAssetId === null ? [] : [config.musicAssetId]), ...(config.hook.clipAssetId === null ? [] : [config.hook.clipAssetId]), ...(config.overlays?.flatMap(layer => layer.type === 'image' ? [layer.assetId] : []) ?? [])])]
}
function remap(config: AdProjectConfig, mapping: Map<number, number>): AdProjectConfig {
  const mapped = (key: number) => {
    const value = mapping.get(key)
    if (value === undefined) throw new Error('Referência de mídia fora do manifesto.')
    return value
  }
  return { ...config, selectedClipIds: config.selectedClipIds.map(mapped), clipEdits: Object.fromEntries(Object.entries(config.clipEdits).map(([key, edit]) => [String(mapped(Number(key))), edit])), musicAssetId: config.musicAssetId === null ? null : mapped(config.musicAssetId), musicTracks: config.musicTracks.map(track => ({ ...track, assetId: mapped(track.assetId) })), hook: { ...config.hook, clipAssetId: config.hook.clipAssetId === null ? null : mapped(config.hook.clipAssetId) }, overlays: config.overlays?.map(layer => layer.type === 'image' ? { ...layer, assetId: mapped(layer.assetId) } : layer), ...(config.carousel ? { carousel: { ...config.carousel, slides: config.carousel.slides.map(slide => ({ ...slide, assetId: mapped(slide.assetId) })) } } : {}) }
}
export function exportCreativeRecipe(project: Pick<AdProject, 'name' | 'assets'>, current: AdProjectConfig): CreativeRecipePackage {
  // Only supported plain config fields are exported. Account/product IDs and URLs on assets are omitted.
  const { productIds: _products, ...plain } = current
  void _products
  const config = validateRecipeConfig(plain)
  const refs = references(config)
  const mapping = new Map(refs.map((assetId, index) => [assetId, index + 1]))
  const media = refs.map(assetId => {
    const asset = project.assets.find(asset => asset.id === assetId)
    if (!asset) throw new Error('Uma mídia do projeto não está disponível.')
    return { key: mapping.get(assetId)!, filename: basename(asset.originalName), kind: asset.kind, width: asset.width, height: asset.height, durationSeconds: asset.durationSeconds }
  })
  const recipe: CreativeRecipePackage = { format: 'espia-creative-recipe', version: 1, name: project.name, media, config: remap(config, mapping) }
  // Export cannot silently produce an ambiguous or internally inconsistent package.
  const checked = parseCreativeRecipe(JSON.stringify(recipe))
  if (checked.media.some((entry, index) => checked.media.some((other, i) => i !== index && entry.filename === other.filename && entry.kind === other.kind))) throw new Error('Renomeie arquivos com o mesmo nome e tipo antes de exportar a receita.')
  return checked
}
export function parseCreativeRecipe(raw: string): CreativeRecipePackage {
  if (new TextEncoder().encode(raw).byteLength > MAX_RECIPE_BYTES) throw new Error('A receita deve ter até 1 MB.')
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('Arquivo JSON inválido.') }
  const p = object(value, ['format', 'version', 'name', 'media', 'config'], 'Receita')
  if (p.format !== 'espia-creative-recipe' || p.version !== 1) throw new Error('Formato ou versão de receita não suportado.')
  const config = validateRecipeConfig(p.config)
  const media = array(p.media, 100, item => {
    const m = object(item, ['key', 'filename', 'kind', 'width', 'height', 'durationSeconds'], 'Manifesto')
    const filename = text(m.filename, 255, 'Nome da mídia', 1)
    if (filename !== basename(filename) || Array.from(filename).some(char => char.charCodeAt(0) < 32)) throw new Error('Use apenas o nome do arquivo no manifesto.')
    return { key: id(m.key), filename, kind: choice(m.kind, ['image', 'clip', 'music'] as const, 'Tipo de mídia'), width: nullableNumber(m.width, 1, 40000, 'Largura da mídia'), height: nullableNumber(m.height, 1, 40000, 'Altura da mídia'), durationSeconds: number(m.durationSeconds, 0, 600, 'Duração da mídia') }
  }, 'Manifesto')
  if (new Set(media.map(entry => entry.key)).size !== media.length) throw new Error('Chaves repetidas no manifesto.')
  if (media.some((entry, index) => media.some((other, i) => i !== index && entry.filename === other.filename && entry.kind === other.kind))) throw new Error('Nomes de mídia ambíguos no manifesto.')
  const refs = references(config)
  if (refs.some(key => !media.some(entry => entry.key === key)) || media.some(entry => !refs.includes(entry.key))) throw new Error('Referência de mídia fora do manifesto.')
  const visualIds = new Set([...config.selectedClipIds, ...(config.carousel?.slides.map(slide => slide.assetId) ?? [])])
  const musicIds = new Set([...config.musicTracks.map(track => track.assetId), ...(config.musicAssetId === null ? [] : [config.musicAssetId])])
  const imageIds = new Set(config.overlays?.flatMap(layer => layer.type === 'image' ? [layer.assetId] : []) ?? [])
  for (const entry of media) {
    if ((visualIds.has(entry.key) && entry.kind === 'music') || (musicIds.has(entry.key) && entry.kind !== 'music') || (imageIds.has(entry.key) && entry.kind !== 'image')) throw new Error('Tipo de mídia incompatível com a referência.')
  }
  return { format: 'espia-creative-recipe', version: 1, name: text(p.name, 120, 'Nome', 1), media, config }
}
export function reviewCreativeRecipe(recipe: CreativeRecipePackage, assets: AdAsset[], current: AdProjectConfig): RecipeReview {
  // Revalidate programmatically supplied packages as well as files.
  recipe = parseCreativeRecipe(JSON.stringify(recipe))
  const matches = recipe.media.map(media => {
    const named = assets.filter(asset => basename(asset.originalName) === media.filename && asset.kind === media.kind)
    // Duplicate names remain ambiguous even if metadata could distinguish them.
    if (named.length > 1) return { media, asset: null, issue: 'ambiguous' as const }
    const asset = named[0]
    if (!asset || asset.width !== media.width || asset.height !== media.height || Math.abs(asset.durationSeconds - media.durationSeconds) > 0.05) return { media, asset: null, issue: 'missing' as const }
    return { media, asset, issue: null }
  })
  if (matches.some(match => match.issue)) return { recipe, config: null, matches }
  const config = { ...remap(recipe.config, new Map(matches.map(match => [match.media.key, match.asset!.id]))), productIds: [...(current.productIds ?? [])] }
  // Recrops and music offsets must still fit the actual matched files.
  for (const asset of assets) {
    const edits = [config.clipEdits[String(asset.id)], ...(config.carousel?.slides.filter(slide => slide.assetId === asset.id).map(slide => slide.edit) ?? [])]
    for (const edit of edits) if (asset.kind === 'clip' && edit && ((edit.trimEnd ?? asset.durationSeconds) > asset.durationSeconds + 0.05 || (edit.trimEnd ?? asset.durationSeconds) - edit.trimStart < 0.25)) throw new Error('O recorte importado não cabe na mídia atual.')
    if (config.musicTracks.some(track => track.assetId === asset.id && track.sourceStartSeconds >= asset.durationSeconds - 0.05)) throw new Error('O início da música importada não cabe na mídia atual.')
  }
  return { recipe, config, matches }
}
