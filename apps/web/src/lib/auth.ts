import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface User {
  id: string
  name: string
  email: string
}

export interface Session {
  user: User
  accessToken: string
  refreshToken: string
}

interface AuthState extends Partial<Session> {
  setSession: (session: Session) => void
  logout: () => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      setSession: ({ user, accessToken, refreshToken }) => set({ user, accessToken, refreshToken }),
      logout: () => set({ user: undefined, accessToken: undefined, refreshToken: undefined }),
    }),
    // sessionStorage keeps each browser tab signed in as its own user, which makes the two-tab demo work.
    { name: 'pulse-auth', storage: createJSONStorage(() => sessionStorage) },
  ),
)
