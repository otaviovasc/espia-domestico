export interface SmartCampaignTiming {
  timezone?: string
  campaignStartTime?: string
  startNow?: boolean
  earlyStart?: { date: string; time: string }
  advancedFromRevision?: number
}

export function explicitSmartStart(
  timing: SmartCampaignTiming | undefined,
  date: string,
  fallback: string,
): string {
  const early = timing?.earlyStart
  return early && early.date === date && /^([01]\d|2[0-3]):[0-5]\d$/.test(early.time)
    ? early.time
    : fallback
}
