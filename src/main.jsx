import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { AuthProvider } from './hooks/useAuth'
import { LogProvider } from './context/LogContext'
import logger from './lib/logger'
import { interceptNetwork } from './lib/networkInterceptor'
import App from './App'
import './index.css'

// Initialize logging infrastructure
logger.interceptConsole()
interceptNetwork()
logger.info('app', 'ZVOO started')

createRoot(document.getElementById('root')).render(
  <HelmetProvider>
    <BrowserRouter>
      <AuthProvider>
        <LogProvider>
          <App />
        </LogProvider>
      </AuthProvider>
    </BrowserRouter>
  </HelmetProvider>
)
