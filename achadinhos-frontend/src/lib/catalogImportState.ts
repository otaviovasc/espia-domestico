import type { ImportSession } from './importWorkflow'

/** Only a successful save receipt clears an evaluated item, never its selection. */
export function hasUnsavedImportWork({
  session,
  savedIndexes,
  hasInput,
  working = false,
  hasPendingGroups = false,
}: {
  session: Pick<ImportSession, 'items'> | null
  savedIndexes: ReadonlySet<number>
  hasInput: boolean
  working?: boolean
  hasPendingGroups?: boolean
}): boolean {
  if (working || hasPendingGroups) return true
  if (!session?.items.length) return hasInput
  return session.items.some((item) => item.status !== 'classified' || !savedIndexes.has(item.sourceIndex))
}

/** Configuration failures are not something the operator can fix in this workflow. */
export function classificationFeedbackMessage(message?: string): string {
  if (!message) return ''
  return /OPENROUTER_KEY|CATEGORIZATION_UNAVAILABLE/i.test(message)
    ? 'Classificação automática indisponível. Tente novamente mais tarde.'
    : message
}
