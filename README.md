# Remote Play Friends — starter project

This is a starter monorepo for a private remote-play web app:

- **Web**: Next.js UI for login, library, rooms, player, stats
- **API**: Node/Express backend for auth, library, invites, sessions
- **DB**: Prisma schema for PostgreSQL
- **Realtime**: Socket.IO events for presence/chat/input signaling

## What this starter includes

- A working **UI mock** for:
  - library
  - create/invite room
  - player window
  - chat panel
  - stats cards
- A small **Express API** with example endpoints
- A **Prisma schema** you can expand
- Clean folder structure for a real implementation

## Important note

This starter is designed for **games you are legally allowed to run and share in your own environment**.  
It does **not** include DRM bypass, Steam cracking, or protected-game circumvention.

## Suggested stack

- Frontend: Next.js + Tailwind
- Backend: Express or NestJS
- DB: PostgreSQL + Prisma
- Realtime: Socket.IO
- Streaming: WebRTC / LiveKit / Janus
- Host agent: Windows service or desktop app

## Run locally

### Web
```bash
cd apps/web
npm install
npm run dev
```

### API
```bash
cd apps/api
npm install
npm run dev
```

### Database
1. Create PostgreSQL database
2. Copy `.env.example` to `.env`
3. Run Prisma migration

```bash
npx prisma migrate dev --name init
npx prisma generate
```

## Next steps

1. Replace mock data with real auth
2. Add invite links and room permissions
3. Connect Socket.IO for realtime room state
4. Add WebRTC streaming for the VM game window
5. Add host agent to capture and forward the selected window
