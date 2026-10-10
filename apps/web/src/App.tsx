import { useEffect, useState } from 'react'
import ChatPane from './components/ChatPane'
import Login from './components/Login'
import Sidebar from './components/Sidebar'
import { useAuth } from './lib/auth'
import { connectSocket, useChat } from './lib/chat'

function Chat() {
  const [menu, setMenu] = useState(false)
  const status = useChat((s) => s.status)

  useEffect(() => {
    connectSocket()
    void useChat.getState().loadRooms()
  }, [])

  return (
    <div className="flex h-dvh flex-col">
      {status !== 'online' && (
        <div role="status" className="bg-amber-500 px-4 py-1 text-center text-sm font-medium text-white">
          {status === 'connecting' ? 'Connecting...' : 'Connection lost. Reconnecting (the free server may be waking up)...'}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className={`${menu ? 'block' : 'hidden'} w-full shrink-0 md:block md:w-72`}>
          <Sidebar onPick={() => setMenu(false)} />
        </div>
        <div className={`${menu ? 'hidden' : 'flex'} min-w-0 flex-1 md:flex`}>
          <ChatPane onMenu={() => setMenu(true)} />
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const loggedIn = useAuth((s) => !!s.accessToken)
  return loggedIn ? <Chat /> : <Login />
}
