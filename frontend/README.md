# LifeOS (frontend)

Expo / React Native app for LifeOS.

## Develop

```bash
npm ci
npm run start
```

## CI

Pushes/PRs to `main` run `.github/workflows/ci.yml` (install, lint, typecheck).

Configure backend URL via `EXPO_PUBLIC_BACKEND_URL` or the in-app setting (see `src/services/api.ts`).
