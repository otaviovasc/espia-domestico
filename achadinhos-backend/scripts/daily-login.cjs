// Interactive operator setup, independent of database/AI credentials.
const { chromium } = require('playwright')
const fs = require('node:fs/promises')
const path = require('node:path')
const readline = require('node:readline/promises')

async function main() {
  const statePath = path.resolve(process.env.DAILY_BROWSER_STATE_PATH || 'data/daily-auth/mercadolivre.json')
  const browser = await chromium.launch({ headless: false })
  try {
    const context = await browser.newContext({ locale: 'pt-BR' })
    const page = await context.newPage()
    await page.goto('https://www.mercadolivre.com.br/afiliados/hub')
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout })
    try { await terminal.question('Sign in and wait for affiliate hub product cards, then press Enter here. ') }
    finally { terminal.close() }
    if (!page.url().startsWith('https://www.mercadolivre.com.br/afiliados/hub') || !await page.locator('.poly-card').count()) {
      throw new Error('Authenticated affiliate hub cards were not confirmed; session was not saved.')
    }
    await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 })
    await fs.writeFile(statePath, JSON.stringify(await context.storageState({ indexedDB: true })), { mode: 0o600 })
    await fs.chmod(statePath, 0o600)
    console.log(`Saved private browser session to ${statePath}. Treat this file as a password.`)
  } finally { await browser.close() }
}
main().catch(() => { console.error('Login setup did not complete. Check the browser and retry.'); process.exitCode = 1 })
