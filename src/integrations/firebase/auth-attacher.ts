import { createMiddleware } from '@tanstack/react-start'
import { auth } from './client'

// Global client `functionMiddleware` registered in `src/start.ts`. It attaches the
// signed-in user's Firebase ID token as a Bearer token to every serverFn RPC so the
// server-side `requireFirebaseAuth` middleware can verify it. Without this, the browser
// never sends a token and every authenticated server function returns 401.
export const attachFirebaseAuth = createMiddleware({ type: 'function' }).client(
  async ({ next }) => {
    const user = auth.currentUser
    const token = user ? await user.getIdToken() : null
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  },
)
