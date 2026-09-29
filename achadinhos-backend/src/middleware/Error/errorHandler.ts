import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import multer from 'multer'
import { AppError } from './AppError'
import { logger } from '@/utils/logger'

/**
 * Central error handler. Converts AppError, ZodError and unknown errors into a
 * consistent JSON envelope. Never leaks stack traces or internal details in
 * production responses.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    if (err.headers) {
      for (const [key, value] of Object.entries(err.headers)) {
        res.setHeader(key, value)
      }
    }
    if (err.statusCode >= 500) {
      logger.error({ err, code: err.code }, err.message)
    }
    res.status(err.statusCode).json({
      success: false,
      error: { message: err.message, code: err.code, details: err.details },
    })
    return
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: err.flatten(),
      },
    })
    return
  }

  if (err instanceof multer.MulterError) {
    res.status(400).json({
      success: false,
      error: {
        message: err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo excede o limite permitido' : 'Upload inválido',
        code: 'UPLOAD_ERROR',
      },
    })
    return
  }

  logger.error({ err }, 'Unhandled error')
  res.status(500).json({
    success: false,
    error: { message: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' },
  })
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: { message: 'Route not found', code: 'NOT_FOUND' },
  })
}
