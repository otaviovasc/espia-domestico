import assert from 'node:assert/strict'
import test from 'node:test'
import { apiErrorMessage } from '../src/lib/apiErrorMessage.ts'

const failure = (status, data, code) => ({ isAxiosError: true, message: 'Request failed', code, ...(status ? { response: { status, data } } : {}) })

test('preserves actionable API errors such as validation and revision conflicts', () => {
  const message = 'Este projeto foi alterado em outra aba. Recarregue a versão salva.'
  assert.equal(apiErrorMessage(failure(409, { error: { message } })), message)
  assert.equal(apiErrorMessage(failure(400, { error: { message: 'Validation failed' } })), 'Revise os campos informados e tente novamente.')
  assert.match(apiErrorMessage(failure(404, { error: { message: 'Route not found' } })), /recurso não está disponível/)
})

test('proxy errors and malformed server messages have an actionable Portuguese fallback', () => {
  for (const data of ['Bad Gateway', undefined, { error: { message: 123 } }]) {
    assert.equal(apiErrorMessage(failure(502, data)), 'Não foi possível concluir a solicitação. Tente novamente em instantes.')
  }
})

test('distinguishes network, timeout, session and rate-limit recovery', () => {
  assert.match(apiErrorMessage(failure()), /Verifique sua conexão/)
  assert.match(apiErrorMessage(failure(undefined, undefined, 'ECONNABORTED')), /demorou/)
  assert.match(apiErrorMessage(failure(401)), /Entre novamente/)
  assert.match(apiErrorMessage(failure(403)), /permissão/)
  assert.match(apiErrorMessage(failure(429)), /Aguarde/)
})
