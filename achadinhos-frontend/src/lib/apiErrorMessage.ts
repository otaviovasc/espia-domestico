import { isAxiosError } from 'axios'

/** Prefer the API's actionable message; translate transport failures for operators. */
export function apiErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const message = (error.response?.data as { error?: { message?: unknown } } | undefined)?.error?.message
    if (typeof message === 'string' && message.trim()) {
      if (message.trim().toLowerCase() === 'validation failed') return 'Revise os campos informados e tente novamente.'
      if (message.trim().toLowerCase() === 'route not found') return 'Este recurso não está disponível no serviço. Atualize a página e tente novamente.'
      return message
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return 'A resposta demorou mais que o esperado. Tente novamente.'
    }
    if (!error.response) return 'Não foi possível conectar ao serviço. Verifique sua conexão e tente novamente.'
    if (error.response.status === 401) return 'Sua sessão expirou. Entre novamente para continuar.'
    if (error.response.status === 403) return 'Sua conta não tem permissão para esta ação.'
    if (error.response.status === 429) return 'Muitas solicitações em pouco tempo. Aguarde um momento e tente novamente.'
    return 'Não foi possível concluir a solicitação. Tente novamente em instantes.'
  }
  return error instanceof Error ? error.message : 'Não foi possível concluir a ação. Tente novamente.'
}
