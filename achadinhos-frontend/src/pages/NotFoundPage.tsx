import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { MapPinOff } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { ThemeControl } from '@/components/ThemeProvider'

export default function NotFoundPage({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth()
  useEffect(() => { document.title = 'Página não encontrada | Espiã Doméstico' }, [])
  const content = (
    <div className="mx-auto w-full max-w-lg py-12 sm:py-20">
      <MapPinOff size={32} className="mb-5 text-muted" aria-hidden="true" />
      <p className="mb-2 text-sm text-muted">Erro 404</p>
      <h1 className="page-title mb-3">Página não encontrada</h1>
      <p className="max-w-md text-sm leading-6 text-muted">Este endereço não existe no painel. Confira o link ou volte para continuar seu trabalho.</p>
      <Link to={user ? '/campaigns' : '/login'} className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">{user ? 'Voltar ao painel' : 'Ir para o acesso'}</Link>
    </div>
  )
  return embedded ? content : <main className="min-h-dvh bg-canvas px-6 text-ink"><div className="mx-auto flex max-w-lg justify-end pt-5"><ThemeControl /></div>{content}</main>
}
