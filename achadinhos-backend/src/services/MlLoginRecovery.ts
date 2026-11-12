import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { injectable, inject } from 'tsyringe'
import type { Page } from 'playwright'
import type { DailyAutomationConfig } from '@/config/dailyAutomation'
import { logger } from '@/utils/logger'
import { MlAuthChallengeService, type MlChallenge } from './MlAuthChallengeService'

export type MlRecoveryStep = 'ORIGIN' | 'PREFLIGHT' | 'LOGIN_CONFIG' | 'IDENTITY' | 'LOGIN_OPTIONS'
  | 'ACCOUNT_PICKER' | 'ALTERNATE_METHOD' | 'EMAIL_OPTION' | 'CODE_INPUT' | 'EMAIL_PROOF'
  | 'EMAIL_CONFIRM' | 'CODE_LAYOUT' | 'CHALLENGE_BEGIN' | 'CODE_WAIT' | 'CODE_SUBMIT' | 'CODE_VERIFY' | 'CHALLENGE_FINISH'

/** Deliberately carries no browser/provider exception, URL, page text or identity. */
export class MlLoginRecoveryError extends Error {
  constructor(public readonly step: MlRecoveryStep, code = 'ML_SESSION_AUTH_REQUIRED') { super(code) }
}

const trusted = (page: Page): boolean => /^https:\/\/(?:[a-z0-9-]+\.)*mercadolivre\.com\.br\//i.test(page.url())
const codeSelector = 'input[autocomplete="one-time-code"], input[name="code"], input#code, input[name="verification_code"], input[maxlength="1"][inputmode="numeric"]'

@injectable()
export class MlLoginRecovery {
  constructor(@inject(MlAuthChallengeService) private readonly challenges: MlAuthChallengeService) {}

  async recover(page: Page, config: DailyAutomationConfig): Promise<boolean> {
    let challenge: MlChallenge | undefined
    let success = false
    let step: MlRecoveryStep = 'ORIGIN'
    try {
      if (!trusted(page)) throw new MlLoginRecoveryError(step)
      step = 'PREFLIGHT'
      await this.challenges.preflight(config)
      step = 'LOGIN_CONFIG'
      const file = process.env.DAILY_BROWSER_STATE_PATH
      if (!file) throw new MlLoginRecoveryError(step)
      const { email } = JSON.parse(await readFile(path.join(path.dirname(file), 'login.json'), 'utf8'))
      if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new MlLoginRecoveryError(step)
      const inputs = page.locator(codeSelector).filter({ visible: true })
      let emailChosen = false
      const visited = new Set<string>()
      // Bounded UI-only flow: identity, remembered account, alternate method, email.
      // No password, QR, SMS, captcha, automatic resend or generic continue clicks.
      for (let transitions = 0; transitions < 8; transitions++) {
        step = 'LOGIN_OPTIONS'
        await page.waitForFunction(() => [...document.querySelectorAll('input,button,a,[role="button"]')].some(node => {
          const element = node as HTMLElement
          const text = node.textContent ?? ''
          return element.getBoundingClientRect().width > 0 && (node.matches('input[name="user_id"], input#user_id, input[type="email"], input[autocomplete="one-time-code"], input[name="code"], input#code, input[name="verification_code"], input[maxlength="1"][inputmode="numeric"]')
            || /e-?mail|continuar como|usar outra conta|entrar com outra conta|tentar de outra forma|outra forma|outro m[eé]todo|outras op[cç][oõ]es|^(?:enviar|receber) (?:um )?c[oó]digo$/i.test(text))
        }), undefined, { timeout: 30_000 })
        step = 'ORIGIN'
        if (!trusted(page)) throw new MlLoginRecoveryError(step)
        if (await inputs.count()) break
        const identity = page.locator('input[name="user_id"], input#user_id, input[type="email"]').first()
        if (await identity.isVisible().catch(() => false) && !visited.has('identity')) {
          step = 'IDENTITY'
          visited.add('identity')
          await identity.fill(email)
          await page.getByRole('button', { name: /^continuar$/i }).first().click({ timeout: 10_000 })
        } else {
          const choices: { step: MlRecoveryStep; name: RegExp }[] = [
            { step: 'EMAIL_OPTION', name: /^(?!.*reenviar)(?:.*(?:enviar|receber|c[oó]digo|usar|continuar).*e-?mail.*|e-?mail)$/i },
            { step: 'ALTERNATE_METHOD', name: /^(?:tentar de outra forma|.*outra forma.*|.*outro m[eé]todo.*|.*outras op[cç][oõ]es.*)$/i },
            // Prefer explicit account identification to an ambiguous remembered account.
            { step: 'ACCOUNT_PICKER', name: /^(?:usar outra conta|entrar com outra conta)$/i },
            { step: 'ACCOUNT_PICKER', name: /^continuar como .+$/i },
          ]
          if (emailChosen) choices.unshift({ step: 'EMAIL_CONFIRM', name: /^(?:enviar|receber) (?:um )?c[oó]digo$/i })
          let clicked = false
          for (const choice of choices) {
            const control = page.getByRole('button', { name: choice.name }).or(page.getByRole('link', { name: choice.name })).filter({ visible: true }).first()
            if (!visited.has(choice.step) && await control.isVisible().catch(() => false)) {
              step = choice.step
              visited.add(step)
              await control.click({ timeout: 10_000 })
              if (step === 'EMAIL_OPTION') emailChosen = true
              clicked = true
              break
            }
          }
          if (!clicked) throw new MlLoginRecoveryError('LOGIN_OPTIONS')
        }
        // Allow the click's client-side transition to settle before choosing again.
        await page.waitForTimeout(750)
      }
      step = 'CODE_INPUT'
      await inputs.first().waitFor({ state: 'visible', timeout: 30_000 })
      step = 'ORIGIN'
      if (!trusted(page)) throw new MlLoginRecoveryError(step)
      step = 'EMAIL_PROOF'
      const text = await page.locator('body').innerText({ timeout: 5000 })
      if (!emailChosen && !/(?:c[oó]digo|enviamos)[\s\S]{0,250}e-?mail|e-?mail[\s\S]{0,250}c[oó]digo/i.test(text)) throw new MlLoginRecoveryError(step)
      step = 'CODE_LAYOUT'
      if (![1, 6].includes(await inputs.count())) throw new MlLoginRecoveryError(step)
      step = 'CHALLENGE_BEGIN'
      challenge = await this.challenges.begin(config)
      step = 'CODE_WAIT'
      while (!page.isClosed() && Date.now() < challenge.expiresAt.getTime()) {
        const code = await this.challenges.take(challenge)
        if (code) {
          step = 'ORIGIN'
          if (!trusted(page)) throw new MlLoginRecoveryError(step)
          step = 'CODE_LAYOUT'
          if (![1, 6].includes(await inputs.count())) throw new MlLoginRecoveryError(step)
          step = 'CODE_SUBMIT'
          if (await inputs.count() === 1) await inputs.first().fill(code)
          else for (let index = 0; index < 6; index++) await inputs.nth(index).fill(code[index])
          const submit = page.getByRole('button', { name: /^(confirmar|verificar|continuar|validar|enviar)$/i }).first()
          if (await submit.isVisible().catch(() => false)) await submit.click({ timeout: 10_000 })
          step = 'CODE_VERIFY'
          await page.waitForSelector('.poly-card', { timeout: 30_000 })
          step = 'ORIGIN'
          if (!trusted(page)) throw new MlLoginRecoveryError(step)
          success = true
          step = 'CHALLENGE_FINISH'
          await this.challenges.finish(challenge, true)
          challenge = undefined
          return true
        }
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
      throw new MlLoginRecoveryError('CODE_WAIT')
    } catch (error) {
      const failure = error instanceof MlLoginRecoveryError ? error : new MlLoginRecoveryError(step,
        step === 'CODE_VERIFY' ? 'ML_SESSION_EMAIL_CODE_REJECTED' : 'ML_SESSION_AUTH_REQUIRED')
      logger.warn({ code: failure.message, step: failure.step }, 'Mercado Livre login recovery failed')
      throw failure
    } finally {
      if (challenge) {
        try { await this.challenges.finish(challenge, success) }
        catch {
          logger.warn({ code: 'ML_SESSION_AUTH_REQUIRED', step: 'CHALLENGE_FINISH' }, 'Mercado Livre challenge finalization failed')
        }
      }
    }
  }
}
