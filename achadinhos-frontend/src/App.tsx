import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom'
import { Send, History, LogOut, Smartphone } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Spinner } from '@/components/ui'
import LoginPage from '@/pages/LoginPage'
import ConnectionPage from '@/pages/ConnectionPage'
import ComposePage from '@/pages/ComposePage'
import CampaignsPage from '@/pages/CampaignsPage'
import CampaignDetailPage from '@/pages/CampaignDetailPage'
import type { ReactNode } from 'react'

function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const navItem =
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition'
  const active = 'bg-violet-600 text-white'
  const idle = 'text-zinc-600 hover:bg-zinc-100'

  return (
    <div className="flex h-full">
      <aside className="flex w-60 flex-col border-r border-zinc-200 bg-white p-4">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-lg">
            🛍️
          </div>
          <div>
            <div className="text-sm font-bold leading-tight">Achadinhos</div>
            <div className="text-xs text-zinc-400">Ofertas no WhatsApp</div>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          <NavLink to="/connection" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>
            <Smartphone size={18} /> Conexão
          </NavLink>
          <NavLink to="/compose" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>
            <Send size={18} /> Nova campanha
          </NavLink>
          <NavLink to="/campaigns" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>
            <History size={18} /> Campanhas
          </NavLink>
        </nav>

        <div className="mt-auto border-t border-zinc-100 pt-3">
          <div className="mb-2 px-2 text-xs text-zinc-500">
            {user?.name}
            <div className="text-zinc-400">{user?.email}</div>
          </div>
          <button
            onClick={async () => {
              await logout()
              navigate('/login')
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100"
          >
            <LogOut size={16} /> Sair
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
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
      <Route path="/campaigns" element={<Protected><CampaignsPage /></Protected>} />
      <Route path="/campaigns/:id" element={<Protected><CampaignDetailPage /></Protected>} />
      <Route path="*" element={<Navigate to="/connection" replace />} />
    </Routes>
  )
}
