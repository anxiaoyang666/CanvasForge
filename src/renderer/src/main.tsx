import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installBrowserCanvasForgeAPI } from './browser-api'
import './styles.css'

installBrowserCanvasForgeAPI()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
