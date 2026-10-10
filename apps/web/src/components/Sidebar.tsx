import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { disconnectSocket, roomTitle, useChat, type Room } from '../lib/chat'
import Dialog from './Dialogs'

function Item({ room, onPick }: { room: Room; onPick: () => void }) {
  const { activeId, select, online } = useChat()
  const user = useAuth((s) => s.user)!
  const other = room.isDirect ? room.members.find((m) => m.id !== user.id) : undefined
  return (
    <li>
      <button
        onClick={() => {
          void select(room.id)
          onPick()
        }}
        className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm ${activeId === room.id ? 'bg-emerald-600 text-white' : 'hover:bg-zinc-200/60 dark:hover:bg-zinc-800'}`}
      >
        {other && <span className={`h-2 w-2 shrink-0 rounded-full ${online[other.id] ? 'bg-emerald-400' : 'bg-zinc-400'}`} aria-label={online[other.id] ? 'online' : 'offline'} />}
        <span className={`flex-1 truncate ${room.unread ? 'font-bold' : ''}`}>{roomTitle(room)}</span>
        {room.unread > 0 && <span className="rounded-full bg-red-500 px-1.5 text-xs font-semibold text-white">{room.unread}</span>}
      </button>
    </li>
  )
}

export default function Sidebar({ onPick }: { onPick: () => void }) {
  const rooms = useChat((s) => s.rooms)
  const { user, logout } = useAuth()
  const [dialog, setDialog] = useState<'browse' | 'create' | 'direct' | null>(null)

  const section = (title: string, list: Room[], actions: [string, 'browse' | 'create' | 'direct'][]) => (
    <section>
      <div className="mb-1 flex items-center justify-between px-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
        <span className="flex gap-2 normal-case">
          {actions.map(([label, kind]) => (
            <button key={kind} className="hover:text-emerald-600" onClick={() => setDialog(kind)}>{label}</button>
          ))}
        </span>
      </div>
      <ul>{list.map((r) => <Item key={r.id} room={r} onPick={onPick} />)}</ul>
    </section>
  )

  return (
    <aside className="flex h-full w-full flex-col gap-5 bg-zinc-100 p-3 dark:bg-zinc-900">
      <h1 className="px-3 text-xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400">Pulse</h1>
      <div className="flex-1 space-y-5 overflow-y-auto">
        {section('Channels', rooms.filter((r) => !r.isDirect), [['Browse', 'browse'], ['+ New', 'create']])}
        {section('Direct messages', rooms.filter((r) => r.isDirect), [['+ New', 'direct']])}
      </div>
      <div className="flex items-center justify-between border-t border-zinc-300 px-3 pt-3 text-sm dark:border-zinc-700">
        <span className="truncate font-medium">{user?.name}</span>
        <button className="text-zinc-500 hover:text-red-600" onClick={() => { disconnectSocket(); logout() }}>Log out</button>
      </div>
      {dialog && <Dialog kind={dialog} onClose={() => setDialog(null)} />}
    </aside>
  )
}
