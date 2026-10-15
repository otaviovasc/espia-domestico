import { useEffect, useRef, type ReactNode, type KeyboardEvent } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { BrainCircuit, Clapperboard, Send, History, LogOut, Smartphone, Tags, MessagesSquare, Menu, X, ChevronRight } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { ThemeControl } from '@/components/ThemeProvider'
import { BrandLogo } from '@/components/BrandLogo'
import { BrandPattern } from '@/components/BrandPattern'
import './workspace-shell.css'

const navigation = [
  {
    name: 'Publicação',
    items: [
      { to: '/compose', label: 'Nova campanha', icon: Send },
      { to: '/campaigns', label: 'Campanhas', icon: History },
      { to: '/smart-campaigns', label: 'Campanhas inteligentes', icon: BrainCircuit },
      { to: '/ads', label: 'Estúdio de anúncios', icon: Clapperboard },
    ],
  },
  {
    name: 'Acervo',
    items: [
      { to: '/products', label: 'Produtos', icon: Tags },
      { to: '/messages', label: 'Mensagens dos grupos', icon: MessagesSquare },
    ],
  },
  {
    name: 'Conta',
    items: [{ to: '/connection', label: 'Conexão WhatsApp', icon: Smartphone }],
  },
]

function routeLabel(pathname: string) {
  if (pathname === '/logout') return 'Sair da conta'
  if (/^\/campaigns\/[^/]+\/?$/.test(pathname)) return 'Detalhes da campanha'
  return navigation.flatMap((group) => group.items).find((item) => item.to === pathname.replace(/\/$/, ''))?.label ?? 'Página não encontrada'
}

function containDrawerFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select:not([disabled]), [tabindex="0"]')].filter((element) => element.getClientRects().length > 0)
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Navegação principal" className="flex-1 space-y-5 py-6">
      {navigation.map((group) => (
        <div key={group.name}>
          <p className="mb-1.5 px-3 text-xs font-medium text-muted">{group.name}</p>
          <ul className="space-y-1">
            {group.items.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink to={to} onClick={onNavigate} className={({ isActive }) => `workspace-nav-link flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium ${isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-muted hover:text-ink'}`}>
                  <Icon size={18} className="shrink-0" aria-hidden="true" /><span>{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export default function WorkspaceShell({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const drawer = useRef<HTMLDialogElement>(null)
  const main = useRef<HTMLElement>(null)
  const title = routeLabel(pathname)
  const section = pathname === '/logout' ? 'Conta' : navigation.find((group) => group.items.some((item) => pathname === item.to || (item.to === '/campaigns' && pathname.startsWith('/campaigns/'))))?.name

  useEffect(() => {
    document.title = `${title} | Espiã Doméstico`
    const frame = requestAnimationFrame(() => {
      main.current?.scrollTo({ top: 0 })
      main.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [pathname, title])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    const closeOnDesktop = () => { if (desktop.matches) drawer.current?.close() }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  function signOut() {
    // Navigate first so the active route can protect its unsaved work.
    drawer.current?.close()
    void navigate('/logout')
  }

  const account = (
    <div className="space-y-3 border-t-2 border-line pt-4">
      <div className="min-w-0 px-2">
        <p className="truncate text-sm font-medium text-ink">{user?.name}</p>
        <p className="truncate text-xs text-muted" title={user?.email}>{user?.email}</p>
      </div>
      <button type="button" onClick={signOut} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-muted hover:text-ink disabled:opacity-50"><LogOut size={17} aria-hidden="true" />Sair da conta</button>
    </div>
  )

  return (
    <div className="workspace-shell flex h-dvh min-h-0 overflow-hidden bg-canvas text-ink">
      <a href="#main-content" className="workspace-skip-link" onClick={() => main.current?.focus()}>Pular para o conteúdo</a>
      <aside className="workspace-sidebar hidden w-60 shrink-0 flex-col overflow-y-auto bg-surface px-3 py-5 lg:flex">
        <Link to="/campaigns" className="mx-2 inline-flex w-fit rounded-lg" aria-label="Espiã Doméstico, campanhas"><BrandLogo /></Link>
        <Navigation />
        {account}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="workspace-header flex min-h-18 shrink-0 items-center gap-2 bg-surface px-3 lg:gap-6 lg:px-6">
          <button type="button" aria-label="Abrir navegação" aria-haspopup="dialog" aria-controls="workspace-navigation" onClick={() => drawer.current?.showModal()} className="workspace-menu-button flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink lg:hidden"><Menu size={21} aria-hidden="true" /></button>
          <Link to="/campaigns" aria-label="Espiã Doméstico, campanhas" className="flex min-w-0 items-center gap-2 rounded-lg lg:hidden"><BrandLogo compact /><span aria-hidden="true" className="workspace-short-brand">Espiã</span></Link>
          <nav aria-label="Localização" className="hidden min-w-0 flex-1 lg:block">
            <ol className="flex min-w-0 items-center gap-2 text-sm">
              <li><Link to="/campaigns" className="rounded text-muted hover:text-accent">Painel</Link></li>
              {section ? <li className="flex items-center gap-2 text-muted"><ChevronRight size={14} aria-hidden="true" /><span>{section}</span></li> : null}
              <li className="flex min-w-0 items-center gap-2"><ChevronRight size={14} className="shrink-0 text-subtle" aria-hidden="true" />{pathname.startsWith('/campaigns/') ? <Link to="/campaigns" className="text-muted hover:text-accent">Campanhas</Link> : null}{pathname.startsWith('/campaigns/') ? <ChevronRight size={14} className="shrink-0 text-subtle" aria-hidden="true" /> : null}<span aria-current="page" className="truncate font-semibold text-ink">{title}</span></li>
            </ol>
          </nav>
          <BrandPattern variant="header" className="workspace-header-pattern" />
          <ThemeControl compact className="ml-auto shrink-0" />
        </header>
        <main id="main-content" ref={main} tabIndex={-1} aria-label={title} className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 outline-none lg:p-6">{children}</main>
      </div>
      <dialog id="workspace-navigation" ref={drawer} aria-labelledby="workspace-navigation-title" className="workspace-drawer border-r border-line bg-surface text-ink" onKeyDown={containDrawerFocus} onClick={(event) => { if (event.target === event.currentTarget) drawer.current?.close() }}>
        <div className="flex min-h-full flex-col px-3 py-4">
          <div className="flex items-center justify-between gap-2 px-2">
            <h2 id="workspace-navigation-title" className="sr-only">Navegação do painel</h2>
            <BrandLogo />
            <button type="button" autoFocus aria-label="Fechar navegação" onClick={() => drawer.current?.close()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-muted"><X size={20} aria-hidden="true" /></button>
          </div>
          <Navigation onNavigate={() => drawer.current?.close()} />
          {account}
        </div>
      </dialog>
    </div>
  )
}
