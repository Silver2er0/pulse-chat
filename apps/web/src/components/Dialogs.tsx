import { useEffect, useState, type SubmitEvent } from 'react'
import { ApiError, api } from '../lib/api'
import { useChat } from '../lib/chat'

type Kind = 'browse' | 'create' | 'direct'

const TITLES: Record<Kind, string> = { browse: 'Browse channels', create: 'New channel', direct: 'New message' }

export default function Dialog({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const { loadRooms, select } = useChat()
  const [channels, setChannels] = useState<{ id: string; name: string; _count: { members: number } }[]>([])
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (kind === 'browse') void api.get<typeof channels>('/rooms/public').then(setChannels)
  }, [kind])
  useEffect(() => {
    if (kind === 'direct') void api.get<typeof users>(`/users?q=${encodeURIComponent(q)}`).then(setUsers)
  }, [kind, q])

  const open = async (request: Promise<{ id: string }>) => {
    try {
      const { id } = await request
      await loadRooms()
      await select(id)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong')
    }
  }
  const create = (e: SubmitEvent) => {
    e.preventDefault()
    void open(api.post('/rooms', { name }))
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="presentation">
      <div role="dialog" aria-label={TITLES[kind]} className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{TITLES[kind]}</h2>
          <button className="text-zinc-500" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        {kind === 'create' && (
          <form onSubmit={create} className="space-y-3">
            <input className="input" autoFocus placeholder="e.g. design-team" aria-label="Channel name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-primary w-full">Create channel</button>
          </form>
        )}
        {kind === 'browse' && (
          <ul className="max-h-72 space-y-1 overflow-auto">
            {channels.length === 0 && <li className="text-sm text-zinc-500">You have joined every channel.</li>}
            {channels.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <span>#{c.name} <span className="text-xs text-zinc-500">{c._count.members} members</span></span>
                <button className="btn !py-1" onClick={() => void open(api.post(`/rooms/${c.id}/join`))}>Join</button>
              </li>
            ))}
          </ul>
        )}
        {kind === 'direct' && (
          <>
            <input className="input" autoFocus placeholder="Search people..." aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="max-h-60 overflow-auto">
              {users.map((u) => (
                <li key={u.id}>
                  <button className="w-full rounded-lg p-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => void open(api.post('/rooms/direct', { userId: u.id }))}>
                    {u.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
