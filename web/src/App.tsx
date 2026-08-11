import { useState, useCallback, useEffect } from 'react'
import Layout from './components/Layout'
import MainContent from './components/MainContent'
import Dialogs from './components/dialogs'
import Login from './components/Login'
import { SearchModal, useSearchShortcut } from './components/SearchModal'
import { HelpPanel, useHelpShortcut } from './components/HelpPanel'
import { useTreeStore } from './stores/treeStore'
import { getNodeUrlParam, parseNodeId } from './utils/nodeUrl'
import type { TreeNode } from './types'

function applyUrlToTree(restoreNode: (node: TreeNode) => void) {
  const param = getNodeUrlParam()
  if (!param) return
  const partial = parseNodeId(param)
  if (partial?.type) {
    restoreNode(partial as TreeNode)
  }
}

function App() {
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  // GeoHosting's iframe handoff (api/ssoBootstrap.ts) sets this before
  // React ever mounts. If it's absent, we're being used standalone —
  // show the login screen instead of the main app.
  const [isAuthed, setIsAuthed] = useState(() => !!localStorage.getItem('token'))
  const restoreNode = useTreeStore((state) => state.restoreNode)

  // Restore selected node + expand parents from URL on initial load
  useEffect(() => {
    applyUrlToTree(restoreNode)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle browser back/forward
  useEffect(() => {
    const onPopState = () => applyUrlToTree(restoreNode)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [restoreNode])

  // Enable Ctrl+K global shortcut
  useSearchShortcut(() => setIsSearchOpen(true))

  // Enable ? global shortcut for help
  const toggleHelp = useCallback(() => setIsHelpOpen(prev => !prev), [])
  useHelpShortcut(toggleHelp)

  if (!isAuthed) {
    return <Login onLogin={() => setIsAuthed(true)} />
  }

  return (
    <>
      <Layout
        onSearchClick={() => setIsSearchOpen(true)}
        onHelpClick={() => setIsHelpOpen(true)}
      >
        <MainContent />
      </Layout>
      <Dialogs />
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />
      <HelpPanel
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />
    </>
  )
}

export default App
