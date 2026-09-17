import { useState, useCallback, useEffect, useRef } from 'react'
import Layout from './components/Layout'
import MainContent from './components/MainContent'
import Dialogs from './components/dialogs'
import Login from './components/Login'
import { SearchModal, useSearchShortcut } from './components/SearchModal'
import { HelpPanel, useHelpShortcut } from './components/HelpPanel'
import MapExplorerView from './components/MapExplorer/MapExplorerView'
import { useTreeStore } from './stores/treeStore'
import { getNodeUrlParam, parseNodeId } from './utils/nodeUrl'
import { setMapViewUrlParam, clearMapViewUrlParam, isMapViewUrlParamSet } from './utils/mapViewUrl'
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
  const [isMapExplorerOpen, setIsMapExplorerOpen] = useState(() => isMapViewUrlParamSet())
  // GeoHosting's iframe handoff (api/ssoBootstrap.ts) sets this before
  // React ever mounts. If it's absent, we're being used standalone —
  // show the login screen instead of the main app.
  const [isAuthed, setIsAuthed] = useState(() => !!localStorage.getItem('token'))
  const restoreNode = useTreeStore((state) => state.restoreNode)
  // True only when this session itself pushed the history entry that opened
  // the map view (via the Map button) — so "close" knows a same-app entry
  // exists to go back to, versus having landed on ?view=map directly
  // (refresh/bookmark), where back() would leave the app entirely.
  const openedMapViaHistoryRef = useRef(false)

  // Restore selected node + expand parents from URL on initial load
  useEffect(() => {
    applyUrlToTree(restoreNode)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle browser back/forward
  useEffect(() => {
    const onPopState = () => {
      applyUrlToTree(restoreNode)
      setIsMapExplorerOpen(isMapViewUrlParamSet())
      openedMapViaHistoryRef.current = false
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [restoreNode])

  const openMapExplorer = useCallback(() => {
    setMapViewUrlParam()
    openedMapViaHistoryRef.current = true
    setIsMapExplorerOpen(true)
  }, [])

  const closeMapExplorer = useCallback(() => {
    if (openedMapViaHistoryRef.current) {
      // We pushed the entry that opened the map — go back to it instead of
      // clearing the param, so the browser's forward button still works.
      openedMapViaHistoryRef.current = false
      window.history.back()
      return
    }
    // Landed on ?view=map with no in-app history before it (refresh/bookmark) — go home.
    clearMapViewUrlParam()
    setIsMapExplorerOpen(false)
  }, [])

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
        onMapClick={openMapExplorer}
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
      {isMapExplorerOpen && (
        <MapExplorerView onClose={closeMapExplorer} />
      )}
    </>
  )
}

export default App
