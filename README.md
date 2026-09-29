# Roblox Dev AI

Roblox Dev AI is a focused AI assistant for Roblox Studio and Luau development. It provides coding help, debugging guidance, original game concepts, and locally saved conversations through a responsive chat workspace.

## Features

- Roblox-specific chat with server-side Groq requests
- Luau-first answers with placement, setup, testing, and common-problem guidance
- Code Debugger mode for pasted scripts
- Game Idea Generator mode for original concepts
- Markdown rendering with syntax-highlighted, copyable code blocks
- Regenerate, stop, copy, and clear conversation controls
- Local conversation history with search, rename, delete, and new chat
- Responsive mobile drawer and touch-friendly controls
- Server-side input validation, timeout handling, and basic rate limiting

## Stack

- React, TypeScript, Vite, Tailwind CSS
- Express 5 API server
- OpenAPI contract with generated React Query and Zod helpers
- Groq Chat Completions API
- Browser localStorage for MVP conversation persistence

## Local setup

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env`.
3. Set `GROQ_API_KEY` to a Groq API key. Keep it server-side; never prefix it with `VITE_`.
4. Optionally change `GROQ_MODEL` to another model supported by Groq.
5. Start the API and frontend with the configured Replit workflows, or run:

   ```bash
   pnpm --filter @workspace/api-server run dev
   pnpm --filter @workspace/roblox-dev-ai run dev
   ```

The frontend calls `/api/chat` through the shared project routing. If no key is configured, the UI shows a safe service-unavailable message rather than exposing server details.

## Deploying to Vercel

The React frontend builds with:

```bash
pnpm --filter @workspace/roblox-dev-ai run build
```

For a Vercel deployment, configure the frontend as the Vite project and expose the Express chat handler as a serverless function or deploy the API service alongside the frontend behind `/api`. Add these environment variables in the Vercel project settings:

```text
GROQ_API_KEY=your_key_here
GROQ_MODEL=llama-3.3-70b-versatile
```

Do not commit `.env` or place `GROQ_API_KEY` in browser-exposed variables.

## Project structure

- `artifacts/roblox-dev-ai` — React/Vite frontend
- `artifacts/api-server/src/routes/chat.ts` — validated Groq chat endpoint and Roblox system prompt
- `lib/api-spec/openapi.yaml` — API source of truth
- `lib/api-client-react` — generated frontend hooks
- `lib/api-zod` — generated server schemas

## Future improvements

- Optional authentication and synced conversations
- Persistent conversation storage
- Streaming responses through a serverless-compatible transport
- Usage analytics and per-user quotas
- Roblox Studio plugin integration