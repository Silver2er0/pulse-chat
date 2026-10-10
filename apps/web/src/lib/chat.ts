import { io, type Socket } from 'socket.io-client'
import { create } from 'zustand'
import { api, API_URL, refreshSession } from './api'
import { useAuth } from './auth'

export interface Member {
  id: string
  name: string
  lastReadAt: string
}

export interface Message {
  id: string
  roomId: string
  content: string
  createdAt: string
  sender: { id: string; name: string }
  clientId?: string
  status?: 'sending' | 'failed'
}

export interface Room {
  id: string
  name: string | null
  isDirect: boolean
  members: Member[]
  lastMessage: Message | null
  unread: number
}

interface MessagePage {
  items: Message[]
  nextCursor: string | null
}

interface ChatState {
  status: 'connecting' | 'online' | 'offline'
  rooms: Room[]
  activeId: string | null
  messages: Record<string, Message[]>
  /** `undefined` = history not loaded yet, `null` = reached the start. */
  cursors: Record<string, string | null | undefined>
  online: Record<string, true>
  typing: Record<string, Record<string, true>>
  loadRooms: () => Promise<void>
  select: (id: string) => Promise<void>
  loadOlder: () => Promise<void>
  send: (content: string, clientId?: string) => void
  setTyping: (typing: boolean) => void
}

let socket: Socket | undefined
let hasConnected = false
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()

const me = () => useAuth.getState().user!.id

export const roomTitle = (room: Room) =>
  room.isDirect ? (room.members.find((m) => m.id !== me())?.name ?? 'Direct message') : `#${room.name}`

export const useChat = create<ChatState>()((set, get) => {
  const patchRoom = (id: string, patch: (room: Room) => Partial<Room>) =>
    set((s) => ({ rooms: s.rooms.map((r) => (r.id === id ? { ...r, ...patch(r) } : r)) }))

  const markRead = (roomId: string) => {
    const at = new Date().toISOString()
    patchRoom(roomId, (r) => ({
      unread: 0,
      members: r.members.map((m) => (m.id === me() ? { ...m, lastReadAt: at } : m)),
    }))
    socket?.emit('message:read', { roomId })
  }

  const fetchLatest = async (roomId: string) => {
    const page = await api.get<MessagePage>(`/rooms/${roomId}/messages`)
    set((s) => {
      const pending = (s.messages[roomId] ?? []).filter((m) => m.status)
      const ids = new Set(page.items.map((m) => m.id))
      return {
        messages: { ...s.messages, [roomId]: [...page.items, ...pending.filter((m) => !ids.has(m.id))] },
        cursors: { ...s.cursors, [roomId]: s.cursors[roomId] === undefined ? page.nextCursor : s.cursors[roomId] },
      }
    })
  }

  return {
    status: 'connecting',
    rooms: [],
    activeId: null,
    messages: {},
    cursors: {},
    online: {},
    typing: {},

    async loadRooms() {
      const rooms = await api.get<Room[]>('/rooms')
      // The open conversation is already being read, whatever the server count says.
      const { activeId: open } = get()
      set({ rooms: rooms.map((r) => (r.id === open && !document.hidden ? { ...r, unread: 0 } : r)) })
      const { activeId, select } = get()
      if (!activeId && rooms.length) await select((rooms.find((r) => r.name === 'general') ?? rooms[0]).id)
    },

    async select(id) {
      set({ activeId: id })
      if (get().cursors[id] === undefined) await fetchLatest(id)
      if (get().activeId === id) markRead(id)
    },

    async loadOlder() {
      const { activeId, cursors } = get()
      const cursor = activeId && cursors[activeId]
      if (!activeId || !cursor) return
      const page = await api.get<MessagePage>(`/rooms/${activeId}/messages?cursor=${cursor}`)
      set((s) => ({
        messages: { ...s.messages, [activeId]: [...page.items, ...(s.messages[activeId] ?? [])] },
        cursors: { ...s.cursors, [activeId]: page.nextCursor },
      }))
    },

    send(content, clientId = crypto.randomUUID()) {
      const roomId = get().activeId
      const { user } = useAuth.getState()
      if (!roomId || !user || !content.trim()) return
      const optimistic: Message = {
        id: clientId,
        clientId,
        roomId,
        content: content.trim(),
        createdAt: new Date().toISOString(),
        sender: { id: user.id, name: user.name },
        status: 'sending',
      }
      set((s) => ({
        messages: {
          ...s.messages,
          [roomId]: [...(s.messages[roomId] ?? []).filter((m) => m.id !== clientId), optimistic],
        },
      }))
      const fail = () =>
        set((s) => ({
          messages: {
            ...s.messages,
            [roomId]: s.messages[roomId].map((m) => (m.id === clientId ? { ...m, status: 'failed' as const } : m)),
          },
        }))
      if (!socket?.connected) return fail()
      socket.timeout(8000).emit('message:send', { roomId, content: optimistic.content, clientId }, (err: unknown, ack?: { ok: boolean }) => {
        if (err || !ack?.ok) fail()
      })
    },

    setTyping(typing) {
      const { activeId } = get()
      if (activeId) socket?.emit('typing', { roomId: activeId, typing })
    },
  }
})

export function connectSocket() {
  if (socket) return
  const store = useChat
  socket = io(API_URL, {
    transports: ['websocket'],
    auth: (cb) => cb({ token: useAuth.getState().accessToken }),
  })

  socket.on('connect', () => {
    store.setState({ status: 'online' })
    if (hasConnected) {
      // Catch up on anything missed while offline.
      void store.getState().loadRooms()
      const { activeId } = store.getState()
      if (activeId) void api.get<MessagePage>(`/rooms/${activeId}/messages`).then((page) =>
        store.setState((s) => {
          const ids = new Set(page.items.map((m) => m.id))
          const rest = (s.messages[activeId] ?? []).filter((m) => !ids.has(m.id) && (m.status || m.createdAt > (page.items[0]?.createdAt ?? '')))
          return { messages: { ...s.messages, [activeId]: [...page.items, ...rest] } }
        }),
      )
    }
    hasConnected = true
  })
  socket.on('disconnect', () => store.setState({ status: 'offline' }))
  socket.on('connect_error', () => store.setState({ status: 'offline' }))
  socket.on('auth:error', async () => {
    if (await refreshSession()) socket?.connect()
  })

  socket.on('presence:list', (ids: string[]) => store.setState({ online: Object.fromEntries(ids.map((id) => [id, true])) }))
  socket.on('presence', ({ userId, online }: { userId: string; online: boolean }) =>
    store.setState((s) => {
      const next = { ...s.online }
      if (online) next[userId] = true
      else delete next[userId]
      return { online: next }
    }),
  )

  socket.on('message:new', (m: Message) => {
    const s = store.getState()
    if (!s.rooms.some((r) => r.id === m.roomId)) void s.loadRooms()
    const list = s.messages[m.roomId]
    if (list) {
      const i = list.findIndex((x) => x.id === m.id || (m.clientId && x.id === m.clientId))
      const next = i === -1 ? [...list, m] : list.map((x, j) => (j === i ? m : x))
      store.setState({ messages: { ...s.messages, [m.roomId]: next } })
    }
    const mine = m.sender.id === me()
    const viewing = s.activeId === m.roomId && !document.hidden
    store.setState((st) => ({
      rooms: st.rooms.map((r) =>
        r.id === m.roomId ? { ...r, lastMessage: m, unread: mine || viewing ? r.unread : r.unread + 1 } : r,
      ),
    }))
    if (viewing && !mine) socket?.emit('message:read', { roomId: m.roomId })
    // The sender has obviously stopped typing.
    store.setState((st) => ({ typing: { ...st.typing, [m.roomId]: omit(st.typing[m.roomId], m.sender.id) } }))
  })

  socket.on('typing', ({ roomId, userId, typing }: { roomId: string; userId: string; typing: boolean }) => {
    const key = `${roomId}:${userId}`
    clearTimeout(typingTimers.get(key))
    store.setState((s) => ({
      typing: { ...s.typing, [roomId]: typing ? { ...s.typing[roomId], [userId]: true } : omit(s.typing[roomId], userId) },
    }))
    // Typing stops being reported if the other tab goes quiet or disconnects.
    if (typing) {
      typingTimers.set(key, setTimeout(() => store.setState((s) => ({ typing: { ...s.typing, [roomId]: omit(s.typing[roomId], userId) } })), 4000))
    }
  })

  socket.on('room:read', ({ roomId, userId, at }: { roomId: string; userId: string; at: string }) =>
    store.setState((s) => ({
      rooms: s.rooms.map((r) =>
        r.id === roomId ? { ...r, members: r.members.map((m) => (m.id === userId ? { ...m, lastReadAt: at } : m)) } : r,
      ),
    })),
  )
  socket.on('room:new', () => void store.getState().loadRooms())

  document.addEventListener('visibilitychange', () => {
    const { activeId } = store.getState()
    if (!document.hidden && activeId) socket?.emit('message:read', { roomId: activeId })
  })
}

export function disconnectSocket() {
  socket?.close()
  socket = undefined
  hasConnected = false
  typingTimers.forEach(clearTimeout)
  typingTimers.clear()
  useChat.setState({ status: 'connecting', rooms: [], activeId: null, messages: {}, cursors: {}, online: {}, typing: {} })
}

function omit(obj: Record<string, true> = {}, key: string): Record<string, true> {
  const { [key]: _, ...rest } = obj
  return rest
}
