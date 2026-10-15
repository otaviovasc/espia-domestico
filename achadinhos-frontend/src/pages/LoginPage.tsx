import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button, Input, Label } from '@/components/ui'
import { ThemeControl } from '@/components/ThemeProvider'
import { BrandLogo } from '@/components/BrandLogo'
import { BrandPattern } from '@/components/BrandPattern'
import '@/components/workspace-shell.css'
import { apiErrorMessage } from '@/lib/api'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const errorRef = useRef<HTMLParagraphElement>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { document.title = 'Acessar o painel | Espiã Doméstico' }, [])
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)
    try {
      await login(email, password)
      navigate('/campaigns', { replace: true })
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page flex min-h-dvh flex-col bg-canvas px-5 py-5 text-ink">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4"><BrandLogo /><ThemeControl compact /></header>
      <div className="login-layout">
        <div className="login-art" aria-hidden="true"><BrandPattern variant="poster" className="login-poster" /><BrandPattern variant="header" className="login-mobile-pattern" /></div>
        <section aria-labelledby="login-title" className="login-panel rounded-2xl border-2 border-line-strong bg-surface p-6 sm:p-8">
          <h1 id="login-title" className="page-title mb-2">Acessar o painel</h1>
          <p className="mb-6 text-sm leading-6 text-muted">Entre para organizar seus produtos e publicar ofertas.</p>
          <form onSubmit={onSubmit} className="space-y-4" aria-busy={loading}>
            <div>
              <Label htmlFor="login-email">E-mail</Label>
              <Input id="login-email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" autoComplete="username" autoCapitalize="none" spellCheck={false} required disabled={loading} className="min-h-11" />
            </div>
            <div>
              <Label htmlFor="login-password">Senha</Label>
              <div className="relative">
                <Input id="login-password" name="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required disabled={loading} className="min-h-11 pr-12" />
                <button type="button" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
              </div>
            </div>
            {error ? <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm leading-5 text-danger outline-none">{error}</p> : null}
            <Button type="submit" disabled={loading} className="min-h-11 w-full">{loading ? 'Entrando…' : 'Entrar'}</Button>
          </form>
        </section>
      </div>
    </main>
  )
}
