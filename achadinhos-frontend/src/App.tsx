import { lazy, Suspense } from 'react'
import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { Spinner } from '@/components/ui'
import WorkspaceShell from '@/components/WorkspaceShell'
import LoginPage from '@/pages/LoginPage'
import NotFoundPage from '@/pages/NotFoundPage'
import LogoutPage from '@/pages/LogoutPage'
const ConnectionPage = lazy(() => import('@/pages/ConnectionPage'))
const ComposePage = lazy(() => import('@/pages/ComposePage'))
const CampaignsPage = lazy(() => import('@/pages/CampaignsPage'))
const CampaignDetailPage = lazy(() => import('@/pages/CampaignDetailPage'))

const AdLibraryPage = lazy(() => import('@/pages/AdLibraryPage'))
const ProductCatalogPage = lazy(() => import('@/pages/ProductCatalogPage'))
const GroupMessagesPage = lazy(() => import('@/pages/GroupMessagesPage'))
const SmartCampaignsPage = lazy(() => import('@/pages/SmartCampaignsPage'))

function LoadingPage() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center gap-3 text-sm text-muted" role="status">
      <Spinner /> Carregando…
    </div>
  )
}

function ProtectedWorkspace() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingPage />
  if (!user) return <Navigate to="/login" replace />
  return <WorkspaceShell><Suspense fallback={<LoadingPage />}><Outlet /></Suspense></WorkspaceShell>
}

function UnknownRoute() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingPage />
  return user ? <WorkspaceShell><NotFoundPage embedded /></WorkspaceShell> : <NotFoundPage />
}

function LoginRoute() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingPage />
  return user ? <Navigate to="/campaigns" replace /> : <LoginPage />
}

const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/campaigns" replace /> },
  { path: '/login', element: <LoginRoute /> },
  {
    element: <ProtectedWorkspace />,
    children: [
      { path: '/connection', element: <ConnectionPage /> },
      { path: '/logout', element: <LogoutPage /> },
      { path: '/compose', element: <ComposePage /> },
      { path: '/messages', element: <GroupMessagesPage /> },
      { path: '/products', element: <ProductCatalogPage /> },
      { path: '/campaigns', element: <CampaignsPage /> },
      { path: '/campaigns/:id', element: <CampaignDetailPage /> },
      { path: '/ads', element: <AdLibraryPage /> },
      { path: '/smart-campaigns', element: <SmartCampaignsPage /> },
    ],
  },
  { path: '*', element: <UnknownRoute /> },
], { basename: '/painel' })

export default function App() {
  return <RouterProvider router={router} />
}
