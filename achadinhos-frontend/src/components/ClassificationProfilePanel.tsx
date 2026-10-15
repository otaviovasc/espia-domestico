import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Pencil, Plus, Settings2, Trash2, X } from 'lucide-react'
import {
  apiErrorMessage,
  classificationProfileApi,
  type ClassificationProfile,
  type ClassificationProfileInput,
  type ClassificationProfileThresholds,
  type ClassificationProfileWeights,
} from '@/lib/api'
import { Badge, Button, Input, Spinner } from '@/components/ui'

const FALLBACK_DEFAULT: ClassificationProfileInput = {
  name: 'Doméstico',
  nicheDescription: 'Produtos para casa, cozinha, limpeza, organização, conforto, móveis, eletrodomésticos e manutenção doméstica.',
  relevanceInstructions:
    'Considere a utilidade direta do produto para o nicho. Itens apenas usados dentro de casa não são automaticamente domésticos.',
  weights: { relevance: 60, discount: 25, commission: 15 },
  discountCap: 50,
  commissionCap: 20,
  thresholds: {
    aScore: 75,
    aRelevance: 75,
    aDiscount: 15,
    aCommission: 10,
    bScore: 55,
    bRelevance: 50,
    cScore: 35,
    dRelevance: 25,
  },
}

const WEIGHT_FIELDS: Array<{ key: keyof ClassificationProfileWeights; label: string; help: string }> = [
  { key: 'relevance', label: 'Afinidade com o nicho', help: 'Quanto o produto combina com o público descrito.' },
  { key: 'discount', label: 'Desconto', help: 'Importância do desconto na nota final.' },
  { key: 'commission', label: 'Comissão', help: 'Importância da comissão afiliada na nota final.' },
]

const THRESHOLD_FIELDS: Array<{
  key: keyof ClassificationProfileThresholds
  label: string
  help: string
}> = [
  { key: 'aScore', label: 'A: nota mínima', help: 'Nota combinada necessária para entrar em A.' },
  { key: 'aRelevance', label: 'A: afinidade mínima', help: 'Evita que só desconto e comissão elevem um item para A.' },
  { key: 'aDiscount', label: 'A: desconto mínimo', help: 'Desconto comercial mínimo para A.' },
  { key: 'aCommission', label: 'A: comissão mínima', help: 'Comissão afiliada mínima para A.' },
  { key: 'bScore', label: 'B: nota mínima', help: 'Nota combinada necessária para entrar em B.' },
  { key: 'bRelevance', label: 'B: afinidade mínima', help: 'Afinidade mínima necessária para B.' },
  { key: 'cScore', label: 'C: nota mínima', help: 'Nota combinada necessária para C.' },
  { key: 'dRelevance', label: 'D: afinidade abaixo de', help: 'Itens abaixo desta afinidade vão diretamente para D.' },
]

function asInput(profile: ClassificationProfile): ClassificationProfileInput {
  return {
    name: profile.name,
    nicheDescription: profile.nicheDescription,
    relevanceInstructions: profile.relevanceInstructions,
    weights: { ...profile.weights },
    discountCap: profile.discountCap,
    commissionCap: profile.commissionCap,
    thresholds: { ...profile.thresholds },
  }
}

function copyInput(profile: ClassificationProfileInput): ClassificationProfileInput {
  return {
    ...profile,
    weights: { ...profile.weights },
    thresholds: { ...profile.thresholds },
  }
}

function validateProfile(profile: ClassificationProfileInput): string[] {
  const errors: string[] = []
  if (!profile.name.trim()) errors.push('Dê um nome ao perfil.')
  if (!profile.nicheDescription.trim()) errors.push('Descreva o nicho e o público desejado.')
  if (!profile.relevanceInstructions.trim()) errors.push('Explique como avaliar a afinidade dos produtos.')

  const weights = Object.values(profile.weights)
  if (weights.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    errors.push('Cada peso deve ficar entre 0 e 100.')
  }
  const weightTotal = weights.reduce((total, value) => total + value, 0)
  if (Math.abs(weightTotal - 100) > 0.001) errors.push(`Os pesos devem somar 100 (soma atual: ${weightTotal}).`)

  if (!Number.isFinite(profile.discountCap) || profile.discountCap <= 0 || profile.discountCap > 100) {
    errors.push('O teto de desconto deve ficar entre 0,01 e 100%.')
  }
  if (!Number.isFinite(profile.commissionCap) || profile.commissionCap <= 0 || profile.commissionCap > 100) {
    errors.push('O teto de comissão deve ficar entre 0,01 e 100%.')
  }

  const thresholds = Object.values(profile.thresholds)
  if (thresholds.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    errors.push('Todos os limites de categoria devem ficar entre 0 e 100.')
  }
  if (!(profile.thresholds.aScore > profile.thresholds.bScore && profile.thresholds.bScore > profile.thresholds.cScore)) {
    errors.push('As notas mínimas precisam seguir A > B > C.')
  }
  if (!(profile.thresholds.aRelevance > profile.thresholds.bRelevance && profile.thresholds.bRelevance > profile.thresholds.dRelevance)) {
    errors.push('Os limites de afinidade precisam seguir A > B > D.')
  }
  if (profile.thresholds.aDiscount > profile.discountCap) errors.push('O desconto mínimo de A não pode superar o teto de desconto.')
  if (profile.thresholds.aCommission > profile.commissionCap) errors.push('A comissão mínima de A não pode superar o teto de comissão.')
  return errors
}

interface ClassificationProfilePanelProps {
  profiles: ClassificationProfile[]
  selectedId: string
  onSelect: (id: string) => void
  isLoading: boolean
  isError: boolean
  disabled?: boolean
  onRetry: () => void
  onDirtyChange?: (dirty: boolean) => void
}

export function ClassificationProfilePanel({
  profiles,
  selectedId,
  onSelect,
  isLoading,
  isError,
  disabled = false,
  onRetry,
  onDirtyChange,
}: ClassificationProfilePanelProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ClassificationProfileInput | null>(null)
  const [initialForm, setInitialForm] = useState<ClassificationProfileInput | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [requestError, setRequestError] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const defaultProfile = profiles.find((profile) => profile.id === 'default')
  const selectedProfile = profiles.find((profile) => profile.id === selectedId) ?? defaultProfile
  const defaultValues = defaultProfile ? asInput(defaultProfile) : FALLBACK_DEFAULT
  const weightTotal = form ? Object.values(form.weights).reduce((total, value) => total + value, 0) : 0

  const closeForm = () => {
    setForm(null)
    setInitialForm(null)
    setEditingId(null)
    setFormErrors([])
    setRequestError(null)
  }

  const saveProfile = useMutation({
    mutationFn: async ({ id, value }: { id: string | null; value: ClassificationProfileInput }) => (
      id ? classificationProfileApi.update(id, value) : classificationProfileApi.create(value)
    ),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['classification-profiles'] })
      onSelect(saved.id)
      setFeedback(editingId ? 'Perfil atualizado.' : 'Perfil criado e selecionado.')
      closeForm()
    },
    onError: (cause) => setRequestError(apiErrorMessage(cause)),
  })

  const removeProfile = useMutation({
    mutationFn: classificationProfileApi.remove,
    onSuccess: async (_, removedId) => {
      if (selectedId === removedId) onSelect('default')
      setDeleteConfirmId(null)
      setFeedback('Perfil removido.')
      await queryClient.invalidateQueries({ queryKey: ['classification-profiles'] })
    },
    onError: (cause) => setRequestError(apiErrorMessage(cause)),
  })

  const beginCreate = () => {
    const base = selectedProfile ? asInput(selectedProfile) : defaultValues
    const next = { ...copyInput(base), name: '' }
    setForm(next)
    setInitialForm(next)
    setEditingId(null)
    setFormErrors([])
    setRequestError(null)
    setFeedback(null)
  }

  const beginEdit = (profile: ClassificationProfile) => {
    const next = asInput(profile)
    setForm(next)
    setInitialForm(next)
    setEditingId(profile.id)
    setFormErrors([])
    setRequestError(null)
    setFeedback(null)
  }

  const beginDuplicate = (profile: ClassificationProfile) => {
    const next = { ...asInput(profile), name: `Cópia de ${profile.name}` }
    setForm(next)
    setInitialForm(next)
    setEditingId(null)
    setFormErrors([])
    setRequestError(null)
    setFeedback(null)
  }

  const setWeight = (key: keyof ClassificationProfileWeights, value: number) => {
    setForm((current) => current ? { ...current, weights: { ...current.weights, [key]: value } } : current)
  }

  const setThreshold = (key: keyof ClassificationProfileThresholds, value: number) => {
    setForm((current) => current ? { ...current, thresholds: { ...current.thresholds, [key]: value } } : current)
  }

  const dirty = !!form && (saveProfile.isPending || JSON.stringify(form) !== JSON.stringify(initialForm))
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => { onDirtyChange?.(false) }, [onDirtyChange])

  return (
    <section className="rounded-xl border border-line bg-surface-muted p-4" aria-labelledby="classification-profile-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <Settings2 size={18} className="mt-1 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <h3 id="classification-profile-heading" className="font-semibold text-ink">Perfil de classificação</h3>
            <p className="mt-0.5 max-w-2xl text-sm text-muted">Escolha o nicho que define afinidade, pesos comerciais e os limites das categorias A–D.</p>
          </div>
        </div>
        <Button type="button" variant="secondary" onClick={beginCreate} disabled={disabled || isLoading || isError}>
          <Plus size={15} /> Novo perfil
        </Button>
      </div>

      {isLoading ? <div className="mt-4"><Spinner /></div> : isError ? (
        <p role="alert" className="mt-4 text-sm text-danger">Não foi possível carregar os perfis. <button type="button" className="underline" onClick={onRetry}>Tentar novamente</button></p>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div>
            <label htmlFor="classification-profile" className="mb-1 block text-sm font-medium text-ink">Usar na próxima classificação</label>
            <select
              id="classification-profile"
              value={selectedProfile?.id ?? selectedId}
              disabled={disabled || profiles.length === 0}
              onChange={(event) => { onSelect(event.target.value); setFeedback(null) }}
              className="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:bg-surface-muted"
            >
              {profiles.length === 0 && <option value="">Nenhum perfil disponível</option>}
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.builtIn ? ' (padrão)' : ''}</option>)}
            </select>
          </div>
          {selectedProfile && (
            <div className="flex flex-wrap gap-2">
              {!selectedProfile.builtIn && <Button type="button" variant="secondary" disabled={disabled} onClick={() => beginEdit(selectedProfile)}><Pencil size={14} /> Editar</Button>}
              <Button type="button" variant="secondary" disabled={disabled} onClick={() => beginDuplicate(selectedProfile)}><Copy size={14} /> Duplicar</Button>
              {!selectedProfile.builtIn && (deleteConfirmId === selectedProfile.id ? (
                <span className="inline-flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
                  Remover perfil? As avaliações salvas permanecem.
                  <button type="button" className="font-semibold underline" disabled={removeProfile.isPending} onClick={() => removeProfile.mutate(selectedProfile.id)}>Confirmar</button>
                  <button type="button" className="underline" disabled={removeProfile.isPending} onClick={() => setDeleteConfirmId(null)}>Cancelar</button>
                </span>
              ) : <Button type="button" variant="ghost" disabled={disabled} aria-label={`Remover perfil ${selectedProfile.name}`} onClick={() => setDeleteConfirmId(selectedProfile.id)}><Trash2 size={14} /> Remover</Button>)}
            </div>
          )}
        </div>
      )}

      {!isLoading && !isError && profiles.length === 0 && <p className="mt-3 text-sm text-muted">Crie um perfil para definir o público das suas ofertas. <button type="button" className="text-accent underline" onClick={onRetry}>Atualizar perfis</button></p>}

      {selectedProfile && !form && (
        <details className="mt-3 rounded-lg border border-line bg-surface p-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink">Critérios de {selectedProfile.name}</summary>
          <div className="mt-2">
          <div className="flex flex-wrap items-center gap-2"><strong>{selectedProfile.name}</strong>{selectedProfile.builtIn && <Badge tone="violet">Perfil padrão</Badge>}</div>
          <p className="mt-1 text-muted">{selectedProfile.nicheDescription}</p>
          <p className="mt-2 text-xs text-muted">Pesos: afinidade {selectedProfile.weights.relevance}% · desconto {selectedProfile.weights.discount}% · comissão {selectedProfile.weights.commission}%</p>
          <p className="mt-2 text-xs text-muted">{selectedProfile.relevanceInstructions}</p>
          </div>
        </details>
      )}

      {feedback && <p role="status" className="mt-3 text-sm text-success">{feedback}</p>}
      {requestError && !form && <p role="alert" className="mt-3 text-sm text-danger">{requestError}</p>}

      {form && (
        <form
          className="mt-4 rounded-xl border border-line bg-surface p-4"
          onSubmit={(event) => {
            event.preventDefault()
            const normalized = {
              ...form,
              name: form.name.trim(),
              nicheDescription: form.nicheDescription.trim(),
              relevanceInstructions: form.relevanceInstructions.trim(),
            }
            const errors = validateProfile(normalized)
            setFormErrors(errors)
            setRequestError(null)
            if (errors.length === 0) saveProfile.mutate({ id: editingId, value: normalized })
          }}
        >
          <fieldset disabled={saveProfile.isPending || disabled}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div><h4 className="font-semibold">{editingId ? 'Editar perfil' : 'Criar perfil'}</h4><p className="text-xs text-muted">Perfis personalizados ficam disponíveis para os próximos arquivos.</p></div>
            <button type="button" aria-label="Fechar formulário de perfil" className="rounded p-1 text-muted hover:bg-surface-muted" onClick={closeForm}><X size={17} /></button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label htmlFor="profile-name" className="mb-1 block text-sm font-medium text-ink">Nome do perfil</label>
              <Input id="profile-name" autoFocus required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Beleza e cuidados pessoais" />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="profile-niche" className="mb-1 block text-sm font-medium text-ink">Nicho e público</label>
              <textarea id="profile-niche" required maxLength={1_000} value={form.nicheDescription} onChange={(event) => setForm({ ...form, nicheDescription: event.target.value })} placeholder="Quais produtos pertencem ao nicho e para quem as ofertas serão enviadas?" className="min-h-24 w-full rounded-lg border border-line-strong bg-surface text-ink p-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" />
              <p className="mt-1 text-xs text-muted">Seja específico sobre usos, tipos de produto e público. Isso orienta a avaliação do modelo.</p>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="profile-instructions" className="mb-1 block text-sm font-medium text-ink">Critérios de afinidade</label>
              <textarea id="profile-instructions" required maxLength={2_000} value={form.relevanceInstructions} onChange={(event) => setForm({ ...form, relevanceInstructions: event.target.value })} placeholder="Explique o que é muito relevante, parcialmente relevante e fora do nicho." className="min-h-28 w-full rounded-lg border border-line-strong bg-surface text-ink p-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" />
            </div>
          </div>

          <fieldset className="mt-5">
            <legend className="font-medium text-ink">Pesos da nota final</legend>
            <p className="mt-1 text-xs text-muted">Distribua exatamente 100 pontos entre afinidade, desconto e comissão.</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {WEIGHT_FIELDS.map((field) => (
                <div key={field.key}>
                  <label htmlFor={`weight-${field.key}`} className="mb-1 block text-sm font-medium text-ink">{field.label} (%)</label>
                  <Input id={`weight-${field.key}`} type="number" min="0" max="100" step="1" value={form.weights[field.key]} onChange={(event) => setWeight(field.key, Number(event.target.value))} />
                  <p className="mt-1 text-xs text-muted">{field.help}</p>
                </div>
              ))}
            </div>
            <p className={`mt-2 text-sm font-medium ${weightTotal === 100 ? 'text-success' : 'text-warning'}`} aria-live="polite">Soma dos pesos: {weightTotal}/100</p>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="font-medium text-ink">Escala dos sinais comerciais</legend>
            <p className="mt-1 text-xs text-muted">O teto define quando desconto ou comissão já recebem sua pontuação máxima.</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div><label htmlFor="discount-cap" className="mb-1 block text-sm font-medium text-ink">Desconto para pontuação máxima (%)</label><Input id="discount-cap" type="number" min="0.01" max="100" step="0.01" value={form.discountCap} onChange={(event) => setForm({ ...form, discountCap: Number(event.target.value) })} /></div>
              <div><label htmlFor="commission-cap" className="mb-1 block text-sm font-medium text-ink">Comissão para pontuação máxima (%)</label><Input id="commission-cap" type="number" min="0.01" max="100" step="0.01" value={form.commissionCap} onChange={(event) => setForm({ ...form, commissionCap: Number(event.target.value) })} /></div>
            </div>
          </fieldset>

          <details className="mt-5 rounded-lg border border-line p-3">
            <summary className="cursor-pointer font-medium text-ink">Limites avançados das categorias A–D</summary>
            <p className="mt-2 text-xs text-muted">A é a prioridade mais alta. Produtos abaixo do limite de afinidade D são descartados da disputa comercial.</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {THRESHOLD_FIELDS.map((field) => (
                <div key={field.key}>
                  <label htmlFor={`threshold-${field.key}`} className="mb-1 block text-sm font-medium text-ink">{field.label}</label>
                  <Input id={`threshold-${field.key}`} type="number" min="0" max="100" step="1" value={form.thresholds[field.key]} onChange={(event) => setThreshold(field.key, Number(event.target.value))} />
                  <p className="mt-1 text-xs text-muted">{field.help}</p>
                </div>
              ))}
            </div>
          </details>

          {(formErrors.length > 0 || requestError) && (
            <div role="alert" className="mt-4 rounded-lg bg-danger-soft p-3 text-sm text-danger">
              {requestError && <p>{requestError}</p>}
              {formErrors.length > 0 && <ul className="list-disc space-y-1 pl-5">{formErrors.map((message) => <li key={message}>{message}</li>)}</ul>}
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="submit" disabled={saveProfile.isPending}>{saveProfile.isPending ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Criar e usar perfil'}</Button>
            <Button type="button" variant="secondary" disabled={saveProfile.isPending} onClick={() => setForm((current) => current ? { ...copyInput(defaultValues), name: current.name } : current)}>Restaurar critérios padrão</Button>
            <Button type="button" variant="ghost" disabled={saveProfile.isPending} onClick={closeForm}>Cancelar</Button>
          </div>
          </fieldset>
        </form>
      )}
    </section>
  )
}
