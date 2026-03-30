import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import ErrorBoundary from './components/ErrorBoundary'
import Navbar from './components/Navbar'
import { ToastProvider } from './components/Toast'
import PWAManager from './components/PWAManager'
import Landing from './pages/Landing'
import LandingV2 from './pages/LandingV2'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Lobby from './pages/Lobby'
import Game from './pages/Game'
import Practice from './pages/Practice'
import Admin from './pages/Admin'
import Onboarding from './pages/Onboarding'
import NotFound from './pages/NotFound'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: '52px', height: '52px', borderRadius: '18px',
          background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '22px',
          animation: 'pulse-glow 1.5s ease-in-out infinite',
        }}>↩</div>
      </div>
    )
  }
  return user ? children : <Navigate to="/login" />
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth()
  const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: '52px', height: '52px', borderRadius: '18px',
          background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '22px',
          animation: 'pulse-glow 1.5s ease-in-out infinite',
        }}>↩</div>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" />
  if (ADMIN_EMAILS.length > 0 && !ADMIN_EMAILS.includes(user.email)) {
    return <Navigate to="/lobby" />
  }
  return children
}

export default function App() {
  return (
    <ErrorBoundary>
    <ToastProvider>
    <div style={{ minHeight: '100vh', background: '#0A0A1A' }}>
      <Navbar />
      <PWAManager />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/landing" element={<LandingV2 />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/lobby" element={<ProtectedRoute><Lobby /></ProtectedRoute>} />
        <Route path="/game/:id" element={<ProtectedRoute><Game /></ProtectedRoute>} />
        <Route path="/practice" element={<ProtectedRoute><Practice /></ProtectedRoute>} />
        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
        <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
    </ToastProvider>
    </ErrorBoundary>
  )
}
