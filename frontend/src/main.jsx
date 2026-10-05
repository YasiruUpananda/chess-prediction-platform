import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App.jsx'
import './styles/index.css'
import './styles/designSystem.css'
import './styles/App.css'
import './styles/brand.css'
import { startBrowserVitals } from './lib/browserVitals'

startBrowserVitals().catch(() => {})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
