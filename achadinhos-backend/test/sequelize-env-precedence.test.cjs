const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

const configPath = path.resolve(__dirname, '../sequelize-config.js')

function loadMigrationConfig(fileContents, injectedDatabaseUrl) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sequelize-env-test-'))
  try {
    if (fileContents !== null) fs.writeFileSync(path.join(directory, '.env'), fileContents)
    const result = spawnSync(process.execPath, ['-e', `
      const config = require(${JSON.stringify(configPath)});
      console.log('RESULT:' + JSON.stringify({ database: config.production.database }));
    `], {
      cwd: directory,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        ...(injectedDatabaseUrl ? { DATABASE_URL: injectedDatabaseUrl } : {}),
      },
      encoding: 'utf8',
      timeout: 5000,
    })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout.split('\n').find((line) => line.startsWith('RESULT:')).slice(7))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('migrations preserve the injected deployment database over a stale .env', () => {
  const result = loadMigrationConfig(
    'DATABASE_URL=postgresql://fixture:fixture@file.invalid/stale_database\n',
    'postgresql://fixture:fixture@injected.invalid/deployment_database',
  )
  assert.equal(result.database, 'deployment_database')
})

test('migrations still load the local .env when no database URL is injected', () => {
  const result = loadMigrationConfig(
    'DATABASE_URL=postgresql://fixture:fixture@file.invalid/local_database\n',
  )
  assert.equal(result.database, 'local_database')
})

test('migrations run from injected variables without a packaged .env', () => {
  const result = loadMigrationConfig(null, 'postgresql://fixture:fixture@injected.invalid/deployment_database')
  assert.equal(result.database, 'deployment_database')
})
