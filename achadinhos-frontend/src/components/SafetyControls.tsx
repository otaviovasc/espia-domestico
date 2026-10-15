import { useId, useMemo, useState } from 'react'
import { Clock, Zap, Shield, Gauge, Timer } from 'lucide-react'
import type { Safety } from '@/lib/api'
import { Label } from '@/components/ui'

/**
 * Reusable safe-send controls with a human-friendly timer UI:
 *  - min/max interval entered as a value + unit (segundos/minutos)
 *  - quick presets for common pacing profiles
 *  - a live plain-language summary of what the pacing means
 *
 * Used by both the "new campaign" and "edit campaign" screens so the timer UX
 * is identical everywhere.
 */

type Unit = 'seconds' | 'minutes'

/** Pick the friendliest unit to display a given number of seconds. */
function bestUnit(seconds: number): Unit {
  return seconds > 0 && seconds % 60 === 0 && seconds >= 60 ? 'minutes' : 'seconds'
}

function toSeconds(value: number, unit: Unit): number {
  return unit === 'minutes' ? Math.round(value * 60) : Math.round(value)
}

function fromSeconds(seconds: number, unit: Unit): number {
  return unit === 'minutes' ? Math.round((seconds / 60) * 100) / 100 : seconds
}

function humanizeSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s === 0 ? `${m} min` : `${m} min ${s}s`
}

interface Preset {
  key: string
  label: string
  icon: typeof Zap
  min: number
  max: number
  maxPerHour: number
}

const PRESETS: Preset[] = [
  { key: 'fast', label: 'Rápido', icon: Zap, min: 8, max: 25, maxPerHour: 120 },
  { key: 'balanced', label: 'Equilibrado', icon: Gauge, min: 30, max: 90, maxPerHour: 60 },
  { key: 'safe', label: 'Seguro', icon: Shield, min: 180, max: 360, maxPerHour: 20 },
  { key: 'slow', label: 'Lento (grupos)', icon: Timer, min: 1200, max: 1560, maxPerHour: 0 },
]

interface DurationFieldProps {
  label: string
  seconds: number
  onChange: (seconds: number) => void
  min?: number
}

function DurationField({ label, seconds, onChange, min = 1 }: DurationFieldProps) {
  const inputId = useId()
  const [unit, setUnit] = useState<Unit>(() => bestUnit(seconds))
  return (
    <div>
      <Label htmlFor={inputId}>{label}</Label>
      <div className="flex gap-2">
        <input
          id={inputId}
          type="number"
          min={unit === 'minutes' ? 0 : min}
          step={unit === 'minutes' ? 'any' : 1}
          value={fromSeconds(seconds, unit)}
          onChange={(e) => onChange(Math.max(min, toSeconds(Number(e.target.value) || 0, unit)))}
          className="w-full min-w-0 rounded-lg border border-line-strong bg-surface text-ink px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as Unit)}
          className="rounded-lg border border-line-strong bg-surface text-ink px-2 py-2 text-sm outline-none focus:border-accent"
          aria-label={`Unidade: ${label}`}
        >
          <option value="seconds">segundos</option>
          <option value="minutes">minutos</option>
        </select>
      </div>
    </div>
  )
}

export function SafetyControls({
  safety,
  onChange,
}: {
  safety: Safety
  onChange: (next: Safety) => void
}) {
  const controlsId = useId()
  const activePreset = useMemo(
    () =>
      PRESETS.find(
        (p) =>
          p.min === safety.minDelaySeconds &&
          p.max === safety.maxDelaySeconds &&
          p.maxPerHour === safety.maxPerHour,
      )?.key ?? null,
    [safety],
  )

  const invalidRange = safety.maxDelaySeconds < safety.minDelaySeconds

  const summary = useMemo(() => {
    const lo = humanizeSeconds(safety.minDelaySeconds)
    const hi = humanizeSeconds(safety.maxDelaySeconds)
    const cap =
      safety.maxPerHour > 0 ? `no máximo ${safety.maxPerHour} por hora` : 'sem limite por hora'
    const warmup =
      safety.warmupBatchSize > 0
        ? ` A cada ${safety.warmupBatchSize} mensagens, uma pausa maior de ~${humanizeSeconds(
            Math.round(safety.maxDelaySeconds * safety.warmupPauseFactor),
          )}.`
        : ''
    return `Cada mensagem espera entre ${lo} e ${hi}, ${cap}.${warmup}`
  }, [safety])

  return (
    <div className="space-y-4">
      {/* Presets */}
      <div>
        <Label>Perfil de envio</Label>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const Icon = p.icon
            const active = activePreset === p.key
            return (
              <button
                key={p.key}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onChange({
                    ...safety,
                    minDelaySeconds: p.min,
                    maxDelaySeconds: p.max,
                    maxPerHour: p.maxPerHour,
                  })
                }
                className={`inline-flex items-center gap-1.5 min-h-11 rounded-lg border px-3 py-2 text-sm transition ${
                  active
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line text-muted hover:bg-surface-muted'
                }`}
              >
                <Icon size={14} /> {p.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Interval */}
      <div className="grid gap-4 sm:grid-cols-2">
        <DurationField
          label="Intervalo mínimo entre mensagens"
          seconds={safety.minDelaySeconds}
          onChange={(s) => onChange({ ...safety, minDelaySeconds: s })}
        />
        <DurationField
          label="Intervalo máximo entre mensagens"
          seconds={safety.maxDelaySeconds}
          onChange={(s) => onChange({ ...safety, maxDelaySeconds: s })}
        />
      </div>
      {invalidRange && (
        <p role="alert" className="text-sm text-danger">
          O intervalo máximo deve ser maior ou igual ao mínimo.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${controlsId}-hourly`}>Máximo por hora (0 = ilimitado)</Label>
          <input
            type="number"
            id={`${controlsId}-hourly`}
            min={0}
            step={1}
            value={safety.maxPerHour}
            onChange={(e) => onChange({ ...safety, maxPerHour: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            className="w-full min-w-0 rounded-lg border border-line-strong bg-surface text-ink px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <div>
          <Label htmlFor={`${controlsId}-warmup`}>Pausa maior a cada N mensagens (0 = desligada)</Label>
          <input
            type="number"
            id={`${controlsId}-warmup`}
            min={0}
            step={1}
            value={safety.warmupBatchSize}
            onChange={(e) =>
              onChange({ ...safety, warmupBatchSize: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
            }
            className="w-full min-w-0 rounded-lg border border-line-strong bg-surface text-ink px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-accent"
          checked={safety.shuffleGroups}
          onChange={(e) => onChange({ ...safety, shuffleGroups: e.target.checked })}
        />
        Embaralhar ordem dos grupos
      </label>

      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-accent"
          checked={safety.shuffleOffers ?? true}
          onChange={(e) => onChange({ ...safety, shuffleOffers: e.target.checked })}
        />
        Embaralhar ordem dos produtos
      </label>

      {/* Live summary */}
      <div className="flex items-start gap-2 rounded-lg bg-surface-muted p-3 text-sm text-muted">
        <Clock size={16} className="mt-0.5 shrink-0 text-accent" />
        <span>{summary}</span>
      </div>
    </div>
  )
}
