// Private operations surface: run through authenticated Railway SSH, never a public HTTP route.
const path = require('node:path')
const { AffiliateSalesState } = require('../dist/services/AffiliateSalesState')
const config = JSON.parse(process.env.DAILY_AUTOMATION_CONFIG || '{}')
if (!process.env.DAILY_BROWSER_STATE_PATH || !Number.isSafeInteger(config.userId) || config.userId < 1) {
  process.stderr.write('SALES_REPORT_CONFIGURATION_REQUIRED\n')
  process.exit(1)
}
const directory = path.join(path.dirname(process.env.DAILY_BROWSER_STATE_PATH), '..', 'affiliate-sales', `account-${config.userId}`)
new AffiliateSalesState(directory, config.userId).report().then(report => process.stdout.write(JSON.stringify(report, null, 2) + '\n'))
  .catch(() => { process.stderr.write('SALES_REPORT_STATE_UNAVAILABLE\n'); process.exitCode = 1 })
