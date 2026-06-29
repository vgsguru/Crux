# Crux — Setup & Operations

Crux is an AI hiring platform: recruiters post jobs and review AI-scored
applicants; applicants apply with a resume + 1-minute intro video + AI interview;
a social feed carries job posts and applicant project showcases.

**Stack:** TanStack Start (React) · Firebase Auth + Firestore + Storage ·
Groq / Gemini (AI) · Chatterbox (TTS) · Resend (email). Standard Vite + TanStack
Start build (no Lovable). Runs locally with `npm run dev` on http://localhost:3000.

---

## 1. Environment

Copy `.env.example` → `.env` and fill in values. Required groups:

- **Firebase client** (`VITE_FIREBASE_*`) — from your Firebase project settings.
- **Firebase Admin** — set **`FIREBASE_SERVICE_ACCOUNT`** to the full service-account
  JSON (single line), or `GOOGLE_APPLICATION_CREDENTIALS` to its file path. Required
  for server functions to read/write Firestore & Storage. (Not needed when deployed
  on Google Cloud / Firebase Hosting, where ambient credentials are used.)
- **AI**: `GROQ_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_API_KEY` (poster images).
- **Email**: `RESEND_API_KEY`.

> ⚠️ **Rotate the keys** that were previously committed in `apikeys.txt` / `.env`
> (Gemini, Groq, NVIDIA, Resend). They are exposed and should be considered leaked.
> `.env` and `apikeys.txt` are now gitignored.

## 2. Deploy Firestore indexes, rules, and Storage rules

The app's queries need composite indexes, and the default locked security rules
must be replaced or all client reads/writes fail.

```bash
npm i -g firebase-tools
firebase login
firebase use <your-project-id>     # creates/updates .firebaserc
firebase deploy --only firestore:indexes,firestore:rules,storage
```

- `firestore.indexes.json` — 14 composite indexes (feed, pipeline, templates, …).
- `firestore.rules` — pragmatic auth-scoped rules. **Review the counter-update and
  recruiter-application-read paths before production** (marked with TODO).
- `storage.rules` — size/owner-scoped upload rules.

## 3. Run (localhost)

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (client + node server)
```

## TTS (live-interview voice) — Chatterbox

Optional. Run a Chatterbox TTS server (e.g. the OpenAI-compatible `chatterbox-tts-api`
wrapper) and point `CHATTERBOX_API_URL` at it (default `http://localhost:4123/v1/audio/speech`).
Without a reachable endpoint the interview just shows questions on-screen and skips audio.

Seed demo accounts (recruiter + applicant) by calling the `seedDemoAccounts`
server function (e.g. from a temporary button) — credentials are in
`src/lib/seed.server.ts`.

---

## Data model (Firestore collections)

`users` (role + name) · `profiles` (public profile, embedding) · `companies` ·
`jobs` · `posts` (feed: `kind` = job|showcase) · `post_likes` / `post_comments` /
`post_shares` · `applications` · `interviews` · `notifications` · `saved_jobs` ·
`question_bank` · `interview_templates` · `interview_template_questions` ·
`message_templates` · `application_messages` · `company_verifications` · `role_audit`.

Roles live on **`users/{uid}.role`** as a single string (`admin|recruiter|applicant`).

## Known follow-ups

- **TTS for live interview**: needs a running Chatterbox endpoint (`CHATTERBOX_API_URL`);
  otherwise the interview falls back to on-screen questions.
- **Security-rule hardening**: counter increments are currently allowed on any post
  by any signed-in user; recruiter application reads use `get()` lookups.
- **`role_audit`** is now read from Firestore but no code writes audit rows yet.
- **Trust & safety**: see "Avoiding fake companies / job posts" below — recommended
  before opening signups publicly.
