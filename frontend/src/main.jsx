import React from 'react'
import './index.css'
import './i18n'
// T113 — Pre-import every mutation hook that registers a rollback so
// the registry is populated before the user can reach the discard
// path on PendingBadge / ConflictModal.
import './offline/registerRollbackHooks'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
