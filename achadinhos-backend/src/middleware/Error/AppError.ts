/**
 * Custom application error class. Use the factory functions below for
 * specific HTTP error types.
 */
export class AppError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number = 500,
    public readonly code?: string,
    public readonly details?: Readonly<Record<string, unknown>>,
    public readonly headers?: Readonly<Record<string, string>>,
  ) {
    super(message)
    this.name = 'AppError'
    Error.captureStackTrace(this, this.constructor)
  }
}

export const NotFoundError = (message: string) => new AppError(message, 404, 'NOT_FOUND')
export const BadRequestError = (message: string) => new AppError(message, 400, 'BAD_REQUEST')
export const UnauthorizedError = (message: string) => new AppError(message, 401, 'UNAUTHORIZED')
export const ForbiddenError = (message: string) => new AppError(message, 403, 'FORBIDDEN')
export const ConflictError = (message: string) => new AppError(message, 409, 'CONFLICT')
export const UnprocessableError = (message: string) =>
  new AppError(message, 422, 'UNPROCESSABLE_ENTITY')

export const TooManyRequestsError = (message: string, retryAfterSeconds?: number) => {
  const normalizedRetryAfter =
    retryAfterSeconds === undefined ? undefined : Math.max(1, Math.ceil(retryAfterSeconds))

  return new AppError(
    message,
    429,
    'TOO_MANY_REQUESTS',
    normalizedRetryAfter === undefined ? undefined : { retryAfterSeconds: normalizedRetryAfter },
    normalizedRetryAfter === undefined
      ? undefined
      : { 'Retry-After': String(normalizedRetryAfter) },
  )
}

export const InternalError = (message: string) =>
  new AppError(message, 500, 'INTERNAL_SERVER_ERROR')
