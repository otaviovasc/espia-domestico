/**
 * Sequelize CLI configuration (migrations).
 * Reads DATABASE_URL from the environment to avoid coupling to the app config.
 */
require('dotenv').config({ override: true })

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required')
  process.exit(1)
}

function parseDbUrl(url) {
  const parsed = new URL(url)
  return {
    username: parsed.username,
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1),
    host: parsed.hostname,
    port: parseInt(parsed.port, 10) || 5432,
  }
}

const dbConfig = parseDbUrl(DATABASE_URL)
const nodeEnv = process.env.NODE_ENV || 'development'
const isProduction = nodeEnv === 'production' || nodeEnv === 'staging'

const baseConfig = {
  ...dbConfig,
  dialect: 'postgres',
  logging: false,
}

const sslConfig = {
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  },
}

module.exports = {
  development: baseConfig,
  test: baseConfig,
  staging: { ...baseConfig, ...sslConfig },
  production: { ...baseConfig, ...sslConfig },
}
