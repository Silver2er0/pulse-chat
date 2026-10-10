import { useState, type SubmitEvent } from 'react'
import { ApiError, api } from '../lib/api'
import { useAuth, type Session } from '../lib/auth'

const DEMO = ['alice', 'bob', 'carol'] as const

export default function Login() {
  const setSession = useAuth((s) => s.setSession)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (body: object, path = mode) => {
    setBusy(true)
    setError('')
    try {
      setSession(await api.post<Session>(`/auth/${path}`, body))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Cannot reach the server. It may be waking up; try again in a moment.')
    } finally {
      setBusy(false)
    }
  }
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  })
  const onSubmit = (e: SubmitEvent) => {
    e.preventDefault()
    void submit(mode === 'login' ? { email: form.email, password: form.password } : form)
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-100 p-4 dark:from-zinc-950 dark:to-emerald-950">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400">Pulse</h1>
          <p className="text-sm text-zinc-500">Real-time chat over WebSockets</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {mode === 'register' && <input className="input" placeholder="Name" aria-label="Name" required minLength={2} {...field('name')} />}
          <input className="input" type="email" placeholder="Email" aria-label="Email" required {...field('email')} />
          <input className="input" type="password" placeholder="Password" aria-label="Password" required minLength={mode === 'register' ? 8 : 1} {...field('password')} />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button className="btn btn-primary w-full" disabled={busy}>{mode === 'login' ? 'Log in' : 'Create account'}</button>
          <button type="button" className="w-full text-center text-sm text-zinc-500 underline" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Create an account' : 'I already have an account'}
          </button>
        </form>
        <div className="rounded-xl border border-zinc-200 bg-white/70 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900/70">
          <p className="mb-2 font-medium">Try it: open two tabs and sign in as two different users</p>
          <div className="flex gap-2">
            {DEMO.map((name) => (
              <button key={name} type="button" className="btn flex-1 !py-1 capitalize" disabled={busy} onClick={() => submit({ email: `${name}@pulse.dev`, password: 'Demo123!' }, 'login')}>
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
