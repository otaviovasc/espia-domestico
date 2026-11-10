import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { injectable, inject } from 'tsyringe'
import type { Page } from 'playwright'
import type { DailyAutomationConfig } from '@/config/dailyAutomation'
import { MlAuthChallengeService, type MlChallenge } from './MlAuthChallengeService'

@injectable()
export class MlLoginRecovery {
  constructor(@inject(MlAuthChallengeService) private readonly challenges: MlAuthChallengeService) {}

  async recover(page: Page, config: DailyAutomationConfig): Promise<boolean> {
    let challenge: MlChallenge | undefined
    let success = false
    try {
      if (!/^https:\/\/(?:[a-z0-9-]+\.)*mercadolivre\.com\.br\//i.test(page.url())) return false
      await this.challenges.preflight(config)
      const file = process.env.DAILY_BROWSER_STATE_PATH
      if (!file) return false
      const { email } = JSON.parse(await readFile(path.join(path.dirname(file), 'login.json'), 'utf8'))
      if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false
      const identity = page.locator('input[name="user_id"], input#user_id, input[type="email"]').first()
      if (await identity.isVisible().catch(() => false)) {
        await identity.fill(email)
        await page.getByRole('button', { name: /^continuar$/i }).first().click({ timeout: 5000 })
      }
      const selector = 'input[autocomplete="one-time-code"], input[name="code"], input#code, input[name="verification_code"], input[maxlength="1"][inputmode="numeric"]'
      const emailButton = page.getByRole('button', { name: /e-?mail/i }).first()
      await page.waitForFunction(() => [...document.querySelectorAll('input,button')].some(node => {
        const element = node as HTMLElement
        return element.getBoundingClientRect().width > 0 && (node.matches('input[autocomplete="one-time-code"], input[name="code"], input#code, input[name="verification_code"], input[maxlength="1"][inputmode="numeric"]') || node.tagName === 'BUTTON' && /e-?mail/i.test(node.textContent ?? ''))
      }), undefined, { timeout: 10_000 })
      let emailChosen = false
      const inputs = page.locator(selector).filter({ visible: true })
      if (!await inputs.count() && await emailButton.isVisible().catch(() => false)) {
        await emailButton.click({ timeout: 5000 })
        emailChosen = true
      }
      await inputs.first().waitFor({ state: 'visible', timeout: 10_000 })
      if (!/^https:\/\/(?:[a-z0-9-]+\.)*mercadolivre\.com\.br\//i.test(page.url())) return false
      const text = await page.locator('body').innerText({ timeout: 2000 })
      if (!emailChosen && !/(?:c[oó]digo|enviamos)[\s\S]{0,250}e-?mail|e-?mail[\s\S]{0,250}c[oó]digo/i.test(text)) return false
      if (![1, 6].includes(await inputs.count())) return false
      // Only now is there a real email-code input attached to this exact browser.
      challenge = await this.challenges.begin(config)
      while (!page.isClosed() && Date.now() < challenge.expiresAt.getTime()) {
        const code = await this.challenges.take(challenge)
        if (code) {
          if (!/^https:\/\/(?:[a-z0-9-]+\.)*mercadolivre\.com\.br\//i.test(page.url())) return false
          if (await inputs.count() === 1) await inputs.first().fill(code)
          else for (let index = 0; index < 6; index++) await inputs.nth(index).fill(code[index])
          const submit = page.getByRole('button', { name: /^(confirmar|verificar|continuar|validar|enviar)$/i }).first()
          if (await submit.isVisible().catch(() => false)) await submit.click({ timeout: 5000 })
          try { await page.waitForSelector('.poly-card', { timeout: 15_000 }); success = true }
          catch { throw new Error('ML_SESSION_EMAIL_CODE_REJECTED') }
          return success
        }
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
      return false
    } finally { if (challenge) await this.challenges.finish(challenge, success) }
  }
}
