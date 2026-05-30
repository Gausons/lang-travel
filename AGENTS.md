# AGENTS.md

This file gives coding agents the minimum context needed to work safely in this
repository. Keep it short and update it as the project conventions mature.

## Project Overview

`lang-travel` is a local travel-planning agent built with TypeScript.

- Backend/CLI: Node.js + TypeScript in `src/`
- Web UI: static HTML/CSS/JS in `web/`, served by `src/server.ts`
- Mobile app: Expo / React Native in `apps/mobile/`
- Local data: `data/places.json`

The app supports place entry, nearby park search, route planning, map-provider
integration, AI-assisted route optimization, preference chat, and a multi-agent
travel planner.

## Common Commands

Use `pnpm` as the package manager.

```bash
pnpm install
pnpm dev list
pnpm dev:web
pnpm build
pnpm start -- list
pnpm mobile:start
pnpm mobile:ios
pnpm mobile:android
pnpm mobile:typecheck
```

Verification guidance:

- Run `pnpm build` after changing root TypeScript files under `src/`.
- Run `pnpm mobile:typecheck` after changing `apps/mobile/`.
- There is no dedicated unit-test script yet; prefer focused manual checks for
  touched CLI, API, web, or mobile flows.

## Repository Map

- `src/types.ts`: shared domain types.
- `src/store.ts`: local place storage and initialization.
- `src/planner.ts`: core planning logic and chat intent handling.
- `src/server.ts`: HTTP API and static web server.
- `src/map-provider.ts`: provider interface and shared map types.
- `src/map-providers.ts`: provider registration and selection.
- `src/amap.ts`, `src/google-maps.ts`: concrete map providers.
- `src/ai-route-planner.ts`: AI-assisted route ordering.
- `src/preference-chat.ts`: AI preference extraction chat.
- `src/multi-agent.ts`: multi-agent trip, hotel, and budget orchestration.
- `web/`: browser UI assets.
- `apps/mobile/`: Expo mobile client.
- `data/places.json`: persisted user/place data.

## Coding Conventions

- Root TypeScript uses ESM with `moduleResolution: NodeNext`.
- Keep relative imports in `src/**/*.ts` using `.js` extensions, matching the
  existing style.
- Prefer strict TypeScript types and small, explicit helper functions.
- Keep business logic in `src/` reusable by CLI, server, web, and mobile APIs.
- Preserve fallback behavior when adding AI or map-provider integrations.
- Do not introduce secrets into source files, examples, logs, or committed data.
- Treat `data/places.json` as user data. Avoid overwriting it unless the task
  explicitly asks for data changes.

## Environment And Secrets

Root `.env` is intentionally ignored. Use `.env.example` as the public template.

Important variables:

- `MAP_PROVIDER=amap|google`
- `AMAP_KEY`
- `AMAP_JS_KEY`
- `AMAP_SECURITY_JS_CODE`
- `GOOGLE_MAPS_API_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_BASE_URL`
- `LOG_LEVEL`

Mobile local configuration belongs in `apps/mobile/.env.local`, which is also
ignored. Do not expose backend service keys through mobile responses; mobile
config endpoints should only return non-sensitive capability flags.

## Web And API Notes

- `pnpm dev:web` starts the local server, defaulting to port `3000`.
- `src/server.ts` loads root `.env` automatically before creating providers.
- Static assets are served from `web/`.
- API handlers should return JSON with clear status codes and keep useful
  fallback paths when provider or AI calls fail.
- The web map currently uses AMap JS API keys, even when backend provider
  selection is switched to Google.

## Mobile Notes

- Mobile API access is configured with `EXPO_PUBLIC_API_BASE_URL`.
- iOS simulator usually uses `http://127.0.0.1:3000`.
- Android emulator usually uses `http://10.0.2.2:3000`.
- Native map keys are configured with `AMAP_IOS_KEY` and `AMAP_ANDROID_KEY`.
- `ios/`, `android/`, `.expo/`, and mobile local env files are generated or
  local-only and should not be edited casually.

## Change Safety

- Keep changes scoped to the requested area.
- Do not revert unrelated user changes.
- Avoid destructive git or filesystem operations unless explicitly requested.
- If touching external-service behavior, document required env vars and maintain
  graceful degradation when credentials are absent or invalid.
