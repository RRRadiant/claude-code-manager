import { useEffect } from 'react'

import { MainLayout } from './components/layout/MainLayout'
import { useEnvironmentStore } from './stores/environmentStore'

function App(): React.ReactElement {
  const subscribe = useEnvironmentStore((s) => s.subscribe)

  // Wire the installer event streams once, at the app root, so progress keeps
  // accumulating even if the user navigates away from the environment panel
  // mid-install. The backend pushes; nothing here polls.
  useEffect(() => subscribe(), [subscribe])

  return <MainLayout />
}

export default App
