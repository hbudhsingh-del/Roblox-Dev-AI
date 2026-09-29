# Roblox Dev AI

Roblox Dev AI is a focused AI assistant for Roblox Studio, Luau scripting, debugging, game design, and optimization.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `GROQ_API_KEY` — server-side Groq API key
- Optional env: `GROQ_MODEL` — Groq model name, defaults to `openai/gpt-oss-120b`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/roblox-dev-ai` — React/Vite chat workspace
- `artifacts/api-server/src/routes/chat.ts` — Groq API route and system prompt
- `lib/api-spec/openapi.yaml` — source-of-truth API contract
- `lib/api-client-react` — generated React Query client
- `lib/api-zod` — generated Zod schemas

## Architecture decisions

- Conversations are stored in browser localStorage for the initial MVP, keeping the app usable without authentication.
- All Groq calls are server-side through `/api/chat`; the browser never receives the API key.
- The API contract is OpenAPI-first and generates both frontend hooks and server validation schemas.
- The chat endpoint uses bounded history, request timeouts, and a small in-memory rate limit for basic abuse protection.

## Product

- Roblox-focused chat with Markdown and Luau code blocks
- Code Debugger mode with structured troubleshooting guidance
- Game Idea Generator mode
- Local conversation search, rename, delete, and continuation
- Responsive dark developer-tool interface

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
