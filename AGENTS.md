# Crux — agent notes

AI hiring platform. Stack: TanStack Start (React) + Vite, Firebase Auth/Firestore/Storage,
Groq + Gemini (AI), Chatterbox (TTS), Resend (email). See `SETUP.md` for running it.

- File-based routing under `src/routes` (`routeTree.gen.ts` is generated — don't edit).
- Server logic in `src/lib/*.server.ts`; shared provider helpers in `src/lib/ai-providers.server.ts`.
- Single data store: **Firestore**. Roles live on `users/{uid}.role` (string).
- Secrets come from `.env` (loaded into `process.env` by `src/lib/load-env.server.ts`). Never commit real keys.
