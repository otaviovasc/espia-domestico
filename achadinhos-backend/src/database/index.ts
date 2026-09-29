import { Sequelize } from 'sequelize'
import { env } from '@/config/env'
import { logger } from '@/utils/logger'

const isProduction = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging'

export const sequelize = new Sequelize(env.DATABASE_URL, {
  dialect: 'postgres',
  logging: env.NODE_ENV === 'development' ? (msg) => logger.debug(msg) : false,
  dialectOptions: isProduction
    ? { ssl: { require: true, rejectUnauthorized: false } }
    : {},
  pool: { max: 10, min: 2, acquire: 30000, idle: 10000 },
})

export async function assertDatabaseConnection(): Promise<void> {
  await sequelize.authenticate()
  logger.info('Database connection established')
}
