import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom'
import { Clapperboard, Send, History, LogOut, Smartphone, Tags } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Spinner } from '@/components/ui'
import LoginPage from '@/pages/LoginPage'
import ConnectionPage from '@/pages/ConnectionPage'
import ComposePage from '@/pages/ComposePage'
import ProductCatalogPage from '@/pages/ProductCatalogPage'
import CampaignsPage from '@/pages/CampaignsPage'
import CampaignDetailPage from '@/pages/CampaignDetailPage'
import { lazy, Suspense, type ReactNode } from 'react'

const AdLibraryPage = lazy(() => import('@/pages/AdLibraryPage'))

function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const navItem =
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition'
  const active = 'bg-violet-600 text-white'
  const idle = 'text-zinc-600 hover:bg-zinc-100'

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b border-zinc-200 bg-white p-3 lg:w-60 lg:border-b-0 lg:border-r lg:p-4">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-lg">
            🛍️
          </div>
          <div>
            <div className="text-sm font-bold leading-tight">Achadinhos</div>
            <div className="text-xs text-zinc-400">Ofertas no WhatsApp</div>
          </div>
        </div>

        <nav className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:flex lg:flex-col">
          <NavLink to="/connection" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>
            <Smartphone size={18} /> Conexão
          </NavLink>
          <NavLink to="/compose" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>
            <Send size={18} /> Nova campanha
          </NavLink>
          <NavLink to="/products" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>
            <Tags size={18} /> Produtos
          </NavLink>
          <NavLink to="/campaigns" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>
            <History size={18} /> Campanhas
          </NavLink>
          <NavLink to="/ads" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>
            <Clapperboard size={18} /> Anúncios
          </NavLink>
        </nav>

        <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-3 lg:mt-auto lg:block">
          <div className="px-2 text-xs text-zinc-500 lg:mb-2">
            {user?.name}
            <div className="hidden text-zinc-400 sm:block">{user?.email}</div>
          </div>
          <button
            onClick={async () => {
              await logout()
              navigate('/login')
            }}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 lg:w-full"
          >
            <LogOut size={16} /> Sair
          </button>
        </div>
      </aside>
      <main className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-8">{children}</main>
    </div>
  )
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return <Shell>{children}</Shell>
}

export default function App() {
  const { user, loading } = useAuth()
  return (
    <Routes>
      <Route
        path="/login"
        element={loading ? null : user ? <Navigate to="/connection" replace /> : <LoginPage />}
      />
      <Route path="/connection" element={<Protected><ConnectionPage /></Protected>} />
      <Route path="/compose" element={<Protected><ComposePage /></Protected>} />
      <Route path="/products" element={<Protected><ProductCatalogPage /></Protected>} />
      <Route path="/campaigns" element={<Protected><CampaignsPage /></Protected>} />
      <Route path="/campaigns/:id" element={<Protected><CampaignDetailPage /></Protected>} />
      <Route
        path="/ads"
        element={(
          <Protected>
            <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center"><Spinner /></div>}>
              <AdLibraryPage />
            </Suspense>
          </Protected>
        )}
      />
      <Route path="*" element={<Navigate to="/connection" replace />} />
    </Routes>
  )
}
