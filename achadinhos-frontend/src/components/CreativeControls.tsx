import { memo, useMemo, useRef, useState } from 'react'
import {
  AudioLines,
  ChevronDown,
  ChevronUp,
  Film,
  Flame,
  Gauge,
  Lightbulb,
  Music2,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  WandSparkles,
  Zap,
} from 'lucide-react'
import type {
  AdAsset,
  AdHookConfig,
  AdMusicTrack,
  AdProjectConfig,
  AdVisualEffectsConfig,
  AdVisualEffectsPreset,
} from '@/lib/api'
import {
  DEFAULT_VISUAL_EFFECTS,
  normaliseCreativeConfig,
  VISUAL_EFFECT_PRESETS,
  type VisualPresetDefinition,
} from '@/lib/adCreativeConfig'
import { useAuth } from '@/context/AuthContext'
import EmojiPicker from '@/components/EmojiPicker'

const UUID_TOKEN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi
const LONG_ID_TOKEN = /(?:^|\s)(?:[0-9a-f]{16,}|\d{10,})(?=\s|$)/gi
const OPAQUE_NAME = /^(?=[a-z0-9]{24,}$)(?=.*\d)[a-z0-9]+$/i

function assetDisplayLabel(asset: AdAsset, index: number, noun = 'Clipe'): string {
  const withoutExtension = asset.originalName.replace(/\.[a-z0-9]{1,8}$/i, '')
  const readableName = withoutExtension
    .replace(UUID_TOKEN, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(LONG_ID_TOKEN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const hasReadableWord = /[a-z\u00c0-\u024f]{2,}/i.test(readableName) && !OPAQUE_NAME.test(readableName)
  return hasReadableWord ? `${noun} ${index + 1} · ${readableName}` : `${noun} ${index + 1}`
}

const EFFECT_CONTROLS: Array<{
  key: Exclude<keyof AdVisualEffectsConfig, 'preset'>
  label: string
  hint: string
  min: number
  max: number
  step: number
  format: (value: number) => string
}> = [
  { key: 'brightness', label: 'Brilho', hint: 'Clareia ou escurece', min: -1, max: 1, step: 0.01, format: signedPercent },
  { key: 'contrast', label: 'Contraste', hint: 'Separa luz e sombra', min: 0.5, max: 2, step: 0.01, format: multiplier },
  { key: 'saturation', label: 'Saturação', hint: 'Intensidade das cores', min: 0, max: 3, step: 0.01, format: multiplier },
  { key: 'sharpness', label: 'Nitidez', hint: 'Realça contornos do produto', min: 0, max: 2, step: 0.01, format: percentOfTwo },
  { key: 'temperature', label: 'Temperatura', hint: 'Frio para quente', min: -1, max: 1, step: 0.01, format: signedPercent },
  { key: 'vignette', label: 'Vinheta', hint: 'Escurece as bordas', min: 0, max: 1, step: 0.01, format: percent },
  { key: 'grain', label: 'Grão', hint: 'Textura orgânica', min: 0, max: 1, step: 0.01, format: percent },
  { key: 'glow', label: 'Glow', hint: 'Luz suave nas áreas claras', min: 0, max: 1, step: 0.01, format: percent },
]

const HOOK_EXAMPLES = [
  'Espera: olha o preço disso',
  'Eu não esperava que funcionasse tão bem',
  'O detalhe que mudou minha rotina',
  'Antes de comprar, você precisa ver isso',
  'O resultado aparece em segundos',
]

type CreativeRecipe = {
  id: string
  label: string
  description: string
  preset: AdVisualEffectsPreset
  hookText: string
  hookSeconds: number
  timingSeconds: number
  transition: Pick<AdProjectConfig['transition'], 'preset' | 'durationSeconds' | 'sfx' | 'sfxVolume'>
}

const CREATIVE_RECIPES: CreativeRecipe[] = [
  {
    id: 'flash-offer',
    label: 'Oferta em 3 segundos',
    description: 'Gancho curto, cortes rápidos e cor forte para preço.',
    preset: 'vivid',
    hookText: 'Espera: olha o preço disso',
    hookSeconds: 1.1,
    timingSeconds: 1.25,
    transition: { preset: 'zoom', durationSeconds: 0.22, sfx: 'pop', sfxVolume: 0.16 },
  },
  {
    id: 'ugc-demo',
    label: 'Demonstração UGC',
    description: 'Abertura pessoal e ritmo direto para mostrar o uso.',
    preset: 'warm-ugc',
    hookText: 'Eu não esperava que funcionasse tão bem',
    hookSeconds: 1.5,
    timingSeconds: 1.6,
    transition: { preset: 'cut', durationSeconds: 0.18, sfx: 'click', sfxVolume: 0.12 },
  },
  {
    id: 'before-after',
    label: 'Antes e depois',
    description: 'Mais clareza visual para comparação e prova do produto.',
    preset: 'clean-product',
    hookText: 'O resultado aparece em segundos',
    hookSeconds: 1.4,
    timingSeconds: 1.8,
    transition: { preset: 'fade', durationSeconds: 0.32, sfx: 'whoosh', sfxVolume: 0.14 },
  },
  {
    id: 'premium-detail',
    label: 'Detalhe premium',
    description: 'Ritmo calmo para acabamento, textura e desejo.',
    preset: 'cinematic',
    hookText: 'Um detalhe que muda tudo',
    hookSeconds: 2,
    timingSeconds: 2.4,
    transition: { preset: 'dissolve', durationSeconds: 0.55, sfx: 'whoosh', sfxVolume: 0.1 },
  },
]

const SAVED_PRESETS_KEY = 'ad-creative-presets-v1'
const MAX_HOOK_TEXT_LENGTH = 120

type SavedCreativePreset = {
  id: string
  name: string
  visualEffects: AdVisualEffectsConfig
  hook: Pick<AdHookConfig, 'enabled' | 'durationSeconds' | 'text'>
  timing: AdProjectConfig['timing']
  transition: AdProjectConfig['transition']
}

function readSavedPresets(storageKey: string): SavedCreativePreset[] {
  if (typeof window === 'undefined') return []
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]') as unknown
    if (!Array.isArray(value)) return []
    return value.filter((item): item is SavedCreativePreset => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Record<string, unknown>
      return typeof candidate.id === 'string' &&
        typeof candidate.name === 'string' &&
        Boolean(candidate.visualEffects && typeof candidate.visualEffects === 'object') &&
        Boolean(candidate.hook && typeof candidate.hook === 'object') &&
        Boolean(candidate.timing && typeof candidate.timing === 'object') &&
        Boolean(candidate.transition && typeof candidate.transition === 'object')
    }).slice(0, 12)
  } catch {
    return []
  }
}

function writeSavedPresets(storageKey: string, presets: SavedCreativePreset[]) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(presets.slice(0, 12)))
  } catch {
    // The controls still work when browser storage is unavailable or full.
  }
}

function signedPercent(value: number): string {
  const amount = Math.round(value * 100)
  return `${amount > 0 ? '+' : ''}${amount}%`
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function percentOfTwo(value: number): string {
  return `${Math.round((value / 2) * 100)}%`
}

function multiplier(value: number): string {
  return `${value.toFixed(2)}×`
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function seconds(value: number): string {
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}s`
}

interface CreativeControlsProps {
  config: AdProjectConfig
  assets?: AdAsset[]
  onChange: (config: AdProjectConfig) => void
}

function CreativeControls({ config, assets = [], onChange }: CreativeControlsProps) {
  const { user } = useAuth()
  const savedPresetsKey = `${SAVED_PRESETS_KEY}:${user?.uuid ?? 'local'}`
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [savingPreset, setSavingPreset] = useState(false)
  const [savedPresets, setSavedPresets] = useState<SavedCreativePreset[]>(() => readSavedPresets(savedPresetsKey))
  const hookTextRef = useRef<HTMLTextAreaElement>(null)
  const normalized = normaliseCreativeConfig(config)
  const clips = useMemo(() => assets.filter((asset) => asset.kind === 'clip'), [assets])
  const music = useMemo(() => assets.filter((asset) => asset.kind === 'music'), [assets])
  const musicById = useMemo(() => new Map(music.map((asset) => [asset.id, asset])), [music])
  const clipLabelById = useMemo(
    () => new Map(clips.map((asset, index) => [asset.id, assetDisplayLabel(asset, index)])),
    [clips],
  )
  const musicLabelById = useMemo(
    () => new Map(music.map((asset, index) => [asset.id, assetDisplayLabel(asset, index, 'Música')])),
    [music],
  )
  const tracks = normalized.musicTracks

  function setEffects(next: AdVisualEffectsConfig) {
    onChange({ ...normalized, colorPreset: 'none', visualEffects: next })
  }

  function patchEffect(key: Exclude<keyof AdVisualEffectsConfig, 'preset'>, value: number) {
    setEffects({ ...normalized.visualEffects, preset: 'custom', [key]: value })
  }

  function patchHook(patch: Partial<AdHookConfig>) {
    onChange({ ...normalized, hook: { ...normalized.hook, ...patch } })
  }

  function insertHookEmoji(emoji: string) {
    const textarea = hookTextRef.current
    const start = textarea?.selectionStart ?? normalized.hook.text.length
    const end = textarea?.selectionEnd ?? start
    const nextText = `${normalized.hook.text.slice(0, start)}${emoji}${normalized.hook.text.slice(end)}`
    if (nextText.length > MAX_HOOK_TEXT_LENGTH) return

    patchHook({ text: nextText })
    window.requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }

  function applyRecipe(recipe: CreativeRecipe) {
    const preferredClipId = clips.some((clip) => clip.id === normalized.hook.clipAssetId)
      ? normalized.hook.clipAssetId
      : normalized.selectedClipIds.find((assetId) => clips.some((clip) => clip.id === assetId))
        ?? clips[0]?.id
        ?? null
    onChange({
      ...normalized,
      colorPreset: 'none',
      visualEffects: { ...VISUAL_EFFECT_PRESETS[recipe.preset].values },
      hook: {
        enabled: preferredClipId !== null,
        clipAssetId: preferredClipId,
        durationSeconds: recipe.hookSeconds,
        text: recipe.hookText,
      },
      timing: { mode: 'fixed', seconds: recipe.timingSeconds },
      transition: { ...recipe.transition },
    })
  }

  function applySavedPreset(preset: SavedCreativePreset) {
    const preferredClipId = normalized.selectedClipIds.find((assetId) => clips.some((clip) => clip.id === assetId))
      ?? clips[0]?.id
      ?? null
    onChange({
      ...normalized,
      colorPreset: 'none',
      visualEffects: { ...preset.visualEffects },
      hook: {
        ...preset.hook,
        enabled: preset.hook.enabled && preferredClipId !== null,
        clipAssetId: preferredClipId,
      },
      timing: { ...preset.timing },
      transition: { ...preset.transition },
    })
  }

  function saveCurrentPreset() {
    const name = presetName.trim()
    if (!name) return
    const nextPresetNumber = savedPresets.reduce((highest, preset) => {
      const match = /^preset-(\d+)$/.exec(preset.id)
      return Math.max(highest, match ? Number(match[1]) : 0)
    }, 0) + 1
    const saved: SavedCreativePreset = {
      id: `preset-${nextPresetNumber}`,
      name: name.slice(0, 48),
      visualEffects: { ...normalized.visualEffects },
      hook: {
        enabled: normalized.hook.enabled,
        durationSeconds: normalized.hook.durationSeconds,
        text: normalized.hook.text,
      },
      timing: { ...normalized.timing },
      transition: { ...normalized.transition },
    }
    const next = [saved, ...savedPresets].slice(0, 12)
    setSavedPresets(next)
    writeSavedPresets(savedPresetsKey, next)
    setPresetName('')
    setSavingPreset(false)
  }

  function removeSavedPreset(presetId: string) {
    const next = savedPresets.filter((preset) => preset.id !== presetId)
    setSavedPresets(next)
    writeSavedPresets(savedPresetsKey, next)
  }

  function addTrack() {
    if (tracks.length >= 8 || music.length === 0) return
    const unused = music.find((asset) => !tracks.some((track) => track.assetId === asset.id)) ?? music[0]
    const startSeconds = tracks.reduce((latest, track) => Math.max(latest, track.endSeconds ?? 0), 0)
    const next: AdMusicTrack = {
      assetId: unused.id,
      volume: 0.75,
      startSeconds: Math.min(startSeconds, Math.max(0, normalized.output.durationSeconds - 0.25)),
      endSeconds: null,
      sourceStartSeconds: 0,
      fadeInSeconds: 0.25,
      fadeOutSeconds: 0.5,
    }
    onChange({ ...normalized, musicAssetId: null, musicTracks: [...tracks, next] })
  }

  function patchTrack(index: number, patch: Partial<AdMusicTrack>) {
    const nextTracks = tracks.map((track, trackIndex) => {
      if (trackIndex !== index) return track
      const next = { ...track, ...patch }
      next.startSeconds = clamp(next.startSeconds, 0, Math.max(0, normalized.output.durationSeconds - 0.25))
      next.sourceStartSeconds = clamp(next.sourceStartSeconds, 0, 3600)
      next.volume = clamp(next.volume, 0, 1)
      next.fadeInSeconds = clamp(next.fadeInSeconds, 0, 5)
      next.fadeOutSeconds = clamp(next.fadeOutSeconds, 0, 5)
      if (next.endSeconds !== null) {
        next.endSeconds = clamp(next.endSeconds, next.startSeconds + 0.25, normalized.output.durationSeconds)
      }
      return next
    })
    onChange({ ...normalized, musicAssetId: null, musicTracks: nextTracks })
  }

  function removeTrack(index: number) {
    onChange({ ...normalized, musicAssetId: null, musicTracks: tracks.filter((_, trackIndex) => trackIndex !== index) })
  }

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900"><WandSparkles size={16} className="text-violet-600" /> Começar de um modelo</h3>
          <p className="mt-1 text-xs leading-5 text-zinc-500">Aplique ritmo, transição, acabamento e gancho; depois ajuste cada parte.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {CREATIVE_RECIPES.map((recipe, index) => (
            <button key={recipe.id} type="button" onClick={() => applyRecipe(recipe)} className="group rounded-xl border border-zinc-200 bg-white p-3 text-left hover:border-violet-300 hover:bg-violet-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
              <span className="flex items-center gap-2 text-xs font-semibold text-zinc-800">{index === 0 ? <Zap size={13} className="text-orange-500" /> : index === 1 ? <Film size={13} className="text-violet-600" /> : <Sparkles size={13} className="text-violet-600" />}{recipe.label}</span>
              <span className="mt-1 block text-[11px] leading-4 text-zinc-600">{recipe.description}</span>
              <span className="mt-2 block text-[11px] font-semibold text-violet-700">Aplicar modelo</span>
            </button>
          ))}
        </div>
        {savedPresets.length > 0 ? (
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] font-semibold text-zinc-600">Seus modelos neste navegador</p>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {savedPresets.map((preset) => (
                <span key={preset.id} className="flex shrink-0 items-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
                  <button type="button" onClick={() => applySavedPreset(preset)} className="px-2.5 py-1.5 text-[11px] font-semibold text-zinc-700 hover:bg-violet-50 hover:text-violet-700">{preset.name}</button>
                  <button type="button" onClick={() => removeSavedPreset(preset.id)} className="border-l border-zinc-200 p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600" aria-label={`Excluir modelo ${preset.name}`}><Trash2 size={11} /></button>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {savingPreset ? (
          <div className="mt-3 flex gap-2 rounded-xl bg-zinc-50 p-2">
            <input autoFocus maxLength={48} value={presetName} onChange={(event) => setPresetName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveCurrentPreset(); if (event.key === 'Escape') setSavingPreset(false) }} placeholder="Nome do modelo" className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-violet-500" />
            <button type="button" onClick={saveCurrentPreset} disabled={!presetName.trim()} className="rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:bg-violet-300">Salvar</button>
            <button type="button" onClick={() => setSavingPreset(false)} className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-zinc-500 hover:bg-zinc-200">Cancelar</button>
          </div>
        ) : (
          <button type="button" onClick={() => setSavingPreset(true)} className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-violet-700 hover:text-violet-900"><Save size={12} /> Salvar ajustes como modelo</button>
        )}
        <p className="mt-1.5 text-[11px] leading-4 text-zinc-500">Modelos salvos guardam estilo, ritmo e gancho. Clipes e músicas não são copiados.</p>
      </section>

      <section className="border-t border-zinc-100 pt-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900"><Sparkles size={16} className="text-violet-600" /> Acabamento visual</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">Escolha uma base e refine só o que precisar.</p>
          </div>
          <button type="button" onClick={() => setEffects({ ...DEFAULT_VISUAL_EFFECTS })} className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-violet-700 hover:text-violet-900"><RotateCcw size={12} /> Restaurar</button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(Object.entries(VISUAL_EFFECT_PRESETS) as Array<[AdVisualEffectsPreset, VisualPresetDefinition]>)
            .filter(([id]) => id !== 'custom')
            .map(([id, preset]) => (
              <button
                key={id}
                type="button"
                aria-pressed={normalized.visualEffects.preset === id}
                onClick={() => setEffects({ ...preset.values })}
                className={`rounded-xl border p-3 text-left transition ${normalized.visualEffects.preset === id ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-200' : 'border-zinc-200 bg-white hover:border-violet-300'}`}
              >
                <span className="block text-xs font-semibold text-zinc-800">{preset.label}</span>
                <span className="mt-1 block text-[11px] leading-4 text-zinc-600">{preset.description}</span>
              </button>
            ))}
        </div>
        <button type="button" onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen} className="mt-3 flex w-full items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100">
          <span className="flex items-center gap-2"><Gauge size={14} /> Ajustes finos {normalized.visualEffects.preset === 'custom' ? <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700">Personalizado</span> : null}</span>
          {advancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {advancedOpen ? (
          <div className="mt-3 grid gap-x-4 gap-y-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 sm:grid-cols-2">
            {EFFECT_CONTROLS.map((control) => (
              <label key={control.key} className="text-[11px] font-medium text-zinc-600" title={control.hint}>
                <span className="flex items-center justify-between gap-2"><span>{control.label}</span><span className="tabular-nums text-zinc-500">{control.format(normalized.visualEffects[control.key])}</span></span>
                <input type="range" min={control.min} max={control.max} step={control.step} value={normalized.visualEffects[control.key]} onChange={(event) => patchEffect(control.key, Number(event.target.value))} className="mt-1.5 w-full accent-violet-600" />
              </label>
            ))}
          </div>
        ) : null}
      </section>

      <section className="border-t border-zinc-100 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900"><Flame size={16} className="text-orange-500" /> Gancho de abertura</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">Reserve os primeiros {normalized.hook.durationSeconds.toFixed(1)}s para a cena e frase mais fortes.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={normalized.hook.enabled}
            aria-label={normalized.hook.enabled ? 'Desativar gancho de abertura' : 'Ativar gancho de abertura'}
            disabled={clips.length === 0}
            onClick={() => patchHook({ enabled: !normalized.hook.enabled, clipAssetId: normalized.hook.clipAssetId ?? normalized.selectedClipIds[0] ?? clips[0]?.id ?? null })}
            className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-45 ${normalized.hook.enabled ? 'bg-violet-600' : 'bg-zinc-300'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition ${normalized.hook.enabled ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>
        {normalized.hook.enabled ? (
          <div className="mt-3 space-y-3 rounded-xl border border-orange-100 bg-orange-50/40 p-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
              <label className="text-[11px] font-medium text-zinc-600">Clipe do gancho
                <select value={normalized.hook.clipAssetId ?? ''} onChange={(event) => patchHook({ clipAssetId: event.target.value ? Number(event.target.value) : null })} className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 text-xs outline-none focus:border-violet-500">
                  <option value="">Escolher clipe</option>
                  {clips.map((clip) => (
                    <option key={clip.id} value={clip.id}>
                      {clipLabelById.get(clip.id) ?? 'Clipe'} · {seconds(clip.durationSeconds)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] font-medium text-zinc-600">Duração
                <span className="relative mt-1 block"><input type="number" min={0.5} max={5} step={0.1} value={normalized.hook.durationSeconds} onChange={(event) => patchHook({ durationSeconds: clamp(Number(event.target.value), 0.5, 5) })} className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 pr-7 text-xs outline-none focus:border-violet-500" /><span className="absolute right-2 top-2 text-xs text-zinc-400">s</span></span>
              </label>
            </div>
            <div className="text-[11px] font-medium text-zinc-600">
              <label htmlFor="ad-hook-text">Texto do gancho</label>
              <textarea id="ad-hook-text" ref={hookTextRef} maxLength={MAX_HOOK_TEXT_LENGTH} rows={2} value={normalized.hook.text} onChange={(event) => patchHook({ text: event.target.value })} placeholder="Ex.: Espera: olha o preço disso" className="mt-1 w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
              <span className="mt-1 flex items-start justify-between gap-2">
                <EmojiPicker onSelect={insertHookEmoji} ariaLabel="Adicionar emoji ao texto do gancho" />
                <span className="pt-1 text-[11px] text-zinc-500">{normalized.hook.text.length}/{MAX_HOOK_TEXT_LENGTH}</span>
              </span>
            </div>
            <div>
              <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-zinc-600"><Lightbulb size={11} /> Modelos de abertura</p>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {HOOK_EXAMPLES.map((example) => <button key={example} type="button" onClick={() => patchHook({ text: example })} className="shrink-0 rounded-full border border-orange-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:border-orange-400">{example}</button>)}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="border-t border-zinc-100 pt-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900"><Music2 size={16} className="text-fuchsia-600" /> Trilha em camadas</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">Combine até 8 faixas. Sobreposições são mixadas.</p>
          </div>
          <button type="button" onClick={addTrack} disabled={music.length === 0 || tracks.length >= 8} className="flex shrink-0 items-center gap-1 rounded-lg bg-fuchsia-50 px-2.5 py-1.5 text-[11px] font-semibold text-fuchsia-700 hover:bg-fuchsia-100 disabled:cursor-not-allowed disabled:opacity-40"><Plus size={12} /> Faixa</button>
        </div>
        {music.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-5 text-center"><AudioLines size={20} className="mx-auto text-zinc-400" /><p className="mt-2 text-xs font-medium text-zinc-700">Envie músicas para montar a trilha</p><p className="mt-1 text-[11px] text-zinc-500">Use apenas áudio que você tem direito de anunciar.</p></div>
        ) : tracks.length === 0 ? (
          <button type="button" onClick={addTrack} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-fuchsia-200 bg-fuchsia-50/40 px-4 py-5 text-xs font-semibold text-fuchsia-700 hover:bg-fuchsia-50"><Plus size={14} /> Adicionar primeira faixa</button>
        ) : (
          <div className="space-y-2">
            <div className="relative h-8 overflow-hidden rounded-lg bg-zinc-100" aria-label="Linha do tempo das músicas">
              {tracks.map((track, index) => {
                const start = (track.startSeconds / normalized.output.durationSeconds) * 100
                const end = ((track.endSeconds ?? normalized.output.durationSeconds) / normalized.output.durationSeconds) * 100
                return <span key={`timeline-${index}`} className={`absolute h-2 rounded-full ${['bg-fuchsia-500', 'bg-violet-500', 'bg-sky-500', 'bg-emerald-500'][index % 4]}`} style={{ left: `${start}%`, top: `${5 + (index % 3) * 7}px`, width: `${Math.max(1, end - start)}%` }} title={`${musicLabelById.get(track.assetId) ?? 'Faixa'}: ${seconds(track.startSeconds)} até ${track.endSeconds === null ? 'o fim' : seconds(track.endSeconds)}`} />
              })}
            </div>
            {tracks.map((track, index) => {
              const asset = musicById.get(track.assetId)
              return (
                <div key={`music-track-${index}`} className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-fuchsia-100 text-xs font-bold text-fuchsia-700">{index + 1}</span>
                    <select value={track.assetId} onChange={(event) => patchTrack(index, { assetId: Number(event.target.value), sourceStartSeconds: 0 })} className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-violet-500">
                      {music.map((item) => <option key={item.id} value={item.id}>{musicLabelById.get(item.id) ?? 'Música'}</option>)}
                    </select>
                    <button type="button" onClick={() => removeTrack(index)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600" aria-label={`Remover faixa ${index + 1}`}><Trash2 size={14} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <label className="text-[11px] font-medium text-zinc-700">Entra em
                      <span className="relative mt-1 block"><input type="number" min={0} max={Math.max(0, normalized.output.durationSeconds - 0.25)} step={0.1} value={track.startSeconds} onChange={(event) => patchTrack(index, { startSeconds: Number(event.target.value) })} className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 pr-6 text-xs outline-none focus:border-violet-500" /><span className="absolute right-2 top-1.5 text-xs text-zinc-400">s</span></span>
                    </label>
                    <label className="text-[11px] font-medium text-zinc-700">Sai em
                      <span className="relative mt-1 block"><input type="number" min={track.startSeconds + 0.25} max={normalized.output.durationSeconds} step={0.1} placeholder="Fim" value={track.endSeconds ?? ''} onChange={(event) => patchTrack(index, { endSeconds: event.target.value === '' ? null : Number(event.target.value) })} className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 pr-6 text-xs outline-none focus:border-violet-500" /><span className="absolute right-2 top-1.5 text-xs text-zinc-400">s</span></span>
                    </label>
                    <label className="text-[11px] font-medium text-zinc-700">Começa na música
                      <span className="relative mt-1 block"><input type="number" min={0} max={Math.min(3600, asset?.durationSeconds ?? 3600)} step={0.1} value={track.sourceStartSeconds} onChange={(event) => patchTrack(index, { sourceStartSeconds: Number(event.target.value) })} className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 pr-6 text-xs outline-none focus:border-violet-500" /><span className="absolute right-2 top-1.5 text-xs text-zinc-400">s</span></span>
                    </label>
                    <label className="text-[11px] font-medium text-zinc-700">Volume <span className="float-right tabular-nums text-zinc-500">{percent(track.volume)}</span>
                      <input type="range" min={0} max={1} step={0.01} value={track.volume} onChange={(event) => patchTrack(index, { volume: Number(event.target.value) })} className="mt-2.5 w-full accent-fuchsia-600" />
                    </label>
                    <label className="text-[11px] font-medium text-zinc-700">Fade de entrada
                      <span className="relative mt-1 block"><input type="number" min={0} max={5} step={0.1} value={track.fadeInSeconds} onChange={(event) => patchTrack(index, { fadeInSeconds: Number(event.target.value) })} className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 pr-6 text-xs outline-none focus:border-violet-500" /><span className="absolute right-2 top-1.5 text-xs text-zinc-400">s</span></span>
                    </label>
                    <label className="text-[11px] font-medium text-zinc-700">Fade de saída
                      <span className="relative mt-1 block"><input type="number" min={0} max={5} step={0.1} value={track.fadeOutSeconds} onChange={(event) => patchTrack(index, { fadeOutSeconds: Number(event.target.value) })} className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 pr-6 text-xs outline-none focus:border-violet-500" /><span className="absolute right-2 top-1.5 text-xs text-zinc-400">s</span></span>
                    </label>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

    </div>
  )
}

export default memo(CreativeControls)
