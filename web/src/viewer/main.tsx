import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { Viewer } from './Viewer.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Viewer />
  </StrictMode>,
)
