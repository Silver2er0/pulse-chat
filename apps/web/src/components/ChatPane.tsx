import { useEffect, useLayoutEffect, useRef, useState, type SubmitEvent } from 'react'
import { useAuth } from '../lib/auth'
import { roomTitle, useChat, type Message } from '../lib/chat'

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const EMPTY: Message[] = []

export default function ChatPane({ onMenu }: { onMenu: () => void }) {
  const userId = useAuth((s) => s.user!.id)
  const { activeId, rooms, messages, cursors, typing, send, setTyping, loadOlder } = useChat()
  const room = rooms.find((r) => r.id === activeId)
  const list = (activeId && messages[activeId]) || EMPTY
  const [text, setText] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const prevHeight = useRef(0)
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Keep pinned to the newest message, but preserve position when older history is prepended.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (prevHeight.current && !stickToBottom.current) el.scrollTop += el.scrollHeight - prevHeight.current
    else if (stickToBottom.current) el.scrollTop = el.scrollHeight
    prevHeight.current = 0
  }, [list, activeId])
  useEffect(() => {
    stickToBottom.current = true
  }, [activeId])

  const onScroll = () => {
    const el = scroller.current!
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (el.scrollTop < 60 && activeId && cursors[activeId]) {
      prevHeight.current = el.scrollHeight
      void loadOlder()
    }
  }

  const onChange = (value: string) => {
    setText(value)
    setTyping(!!value)
    clearTimeout(idle.current)
    idle.current = setTimeout(() => setTyping(false), 2000)
  }
  const submit = (e: SubmitEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    clearTimeout(idle.current)
    setTyping(false)
    stickToBottom.current = true
    send(text)
    setText('')
  }

  if (!room) return <div className="flex flex-1 items-center justify-center text-zinc-500">Select a conversation</div>

  const typingNames = Object.keys(typing[room.id] ?? {}).map((id) => room.members.find((m) => m.id === id)?.name ?? 'Someone')
  const lastMine = [...list].reverse().find((m) => m.sender.id === userId && !m.status)
  const seenBy = lastMine
    ? room.members.filter((m) => m.id !== userId && m.lastReadAt >= lastMine.createdAt).map((m) => m.name)
    : []

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <button className="md:hidden" onClick={onMenu} aria-label="Open menu">☰</button>
        <div>
          <h2 className="font-semibold">{roomTitle(room)}</h2>
          <p className="text-xs text-zinc-500">{room.members.length} member{room.members.length > 1 ? 's' : ''}</p>
        </div>
      </header>

      <div ref={scroller} onScroll={onScroll} className="flex-1 space-y-1 overflow-y-auto px-4 py-4">
        {activeId && cursors[activeId] === null && list.length > 0 && <p className="pb-2 text-center text-xs text-zinc-500">Beginning of the conversation</p>}
        {list.map((m, i) => {
          const mine = m.sender.id === userId
          const grouped = list[i - 1]?.sender.id === m.sender.id
          return (
            <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'} ${grouped ? '' : 'pt-2'}`}>
              {!grouped && !mine && <span className="mb-0.5 px-1 text-xs font-semibold text-zinc-500">{m.sender.name}</span>}
              <div className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-sm ${mine ? 'bg-emerald-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800'} ${m.status === 'sending' ? 'opacity-60' : ''}`}>
                {m.content}
              </div>
              <span className="px-1 text-[10px] text-zinc-400">
                {m.status === 'failed' ? (
                  <button className="text-red-500 underline" onClick={() => send(m.content, m.id)}>Failed to send. Tap to retry</button>
                ) : m.status === 'sending' ? 'Sending...' : time(m.createdAt)}
              </span>
            </div>
          )
        })}
        {seenBy.length > 0 && <p className="text-right text-[10px] text-zinc-400">Seen{room.isDirect ? '' : ` by ${seenBy.join(', ')}`}</p>}
      </div>

      <div className="h-5 px-4 text-xs italic text-zinc-500" aria-live="polite">
        {typingNames.length > 0 && `${typingNames.join(', ')} ${typingNames.length > 1 ? 'are' : 'is'} typing...`}
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
        <input className="input" placeholder={`Message ${roomTitle(room)}`} aria-label="Message" value={text} onChange={(e) => onChange(e.target.value)} maxLength={2000} autoFocus />
        <button className="btn btn-primary" disabled={!text.trim()}>Send</button>
      </form>
    </section>
  )
}
