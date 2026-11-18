import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { purgeLegacySampleStorageOnce } from './utils/cleanSampleStorage'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './context/ThemeContext'

purgeLegacySampleStorageOnce()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
