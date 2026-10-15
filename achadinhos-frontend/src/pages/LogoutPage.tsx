import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { Button, Spinner } from '@/components/ui'
import { apiErrorMessage } from '@/lib/api'

export default function LogoutPage() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const request = useRef<Promise<void> | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    // StrictMode re-runs the effect; keep one logout request per attempt.
    request.current ??= logout()
    void request.current.then(() => {
      if (active) void navigate('/login', { replace: true })
    }).catch((reason: unknown) => {
      if (active) setError(apiErrorMessage(reason))
    })
    return () => { active = false }
  }, [attempt, logout, navigate])

  if (!error) return <div role="status" className="flex min-h-[50vh] items-center justify-center gap-3 text-sm text-muted"><Spinner />Saindo da conta…</div>
  return (
    <section className="mx-auto max-w-lg rounded-xl border border-line bg-surface p-6">
      <h1 className="page-title">Não foi possível sair</h1>
      <p role="alert" className="mt-3 text-sm text-danger">{error}</p>
      <p className="mt-2 text-sm leading-6 text-muted">Sua sessão continua ativa. Tente novamente ou volte ao painel.</p>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Button type="button" onClick={() => { request.current = null; setError(null); setAttempt((value) => value + 1) }}>Tentar sair novamente</Button>
        <Link to="/campaigns" className="min-h-11 py-3 text-sm font-medium text-accent underline underline-offset-4">Voltar ao painel</Link>
      </div>
    </section>
  )
}
