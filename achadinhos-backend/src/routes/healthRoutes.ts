import { Router } from 'express'
import { sequelize } from '@/database'

const healthRoutes = Router()

healthRoutes.get('/', async (_req, res) => {
  let db = 'ok'
  try {
    await sequelize.authenticate()
  } catch {
    db = 'down'
  }
  res.json({ status: 'ok', db, time: new Date().toISOString() })
})

export { healthRoutes }
