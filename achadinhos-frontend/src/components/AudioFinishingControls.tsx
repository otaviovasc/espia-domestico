import { useId } from 'react'
import { AudioLines } from 'lucide-react'
import { resolveAdAudioFinishing, type AdAudioFinishing } from '../lib/adAudioFinishing.ts'

interface AudioFinishingControlsProps {
  value?: AdAudioFinishing
  onChange: (next: AdAudioFinishing) => void
  disabled?: boolean
}

export function AudioFinishingControls({ value, onChange, disabled = false }: AudioFinishingControlsProps) {
  const settings = resolveAdAudioFinishing(value)
  const id = useId()
  return (
    <details className="rounded-xl border border-line bg-surface text-ink">
      <summary className="min-h-11 cursor-pointer rounded-xl px-3 py-3 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <span className="inline-flex items-center gap-2">
          <AudioLines size={14} aria-hidden="true" />
          Finalizar áudio
          <span className="font-normal text-muted">{settings.normalizeLoudness ? `${settings.targetLufs} LUFS` : 'Original'}</span>
        </span>
      </summary>
      <fieldset disabled={disabled} className="space-y-3 border-t border-line px-3 py-3 disabled:opacity-50">
        <label className="flex min-h-10 items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={settings.normalizeLoudness}
            onChange={(event) => onChange({ ...settings, normalizeLoudness: event.target.checked })}
            aria-describedby={`${id}-help`}
            className="h-4 w-4 accent-accent"
          />
          Equilibrar volume na exportação
        </label>
        <label htmlFor={`${id}-target`} className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink">
          Volume desejado
          <select
            id={`${id}-target`}
            value={settings.targetLufs}
            disabled={!settings.normalizeLoudness}
            onChange={(event) => onChange(resolveAdAudioFinishing({ ...settings, targetLufs: Number(event.target.value) }))}
            className="min-h-10 min-w-0 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
          >
            <option value={-16}>Suave · -16 LUFS</option>
            <option value={-14}>Equilibrado · -14 LUFS</option>
            <option value={-12}>Intenso · -12 LUFS</option>
          </select>
        </label>
        <p id={`${id}-help`} className="text-xs leading-4 text-muted">
          O preview mantém o volume original. Ouça o arquivo exportado para conferir o acabamento. Mídias sem áudio ou silenciadas continuam sem som.
        </p>
      </fieldset>
    </details>
  )
}

export default AudioFinishingControls
