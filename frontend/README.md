# LifeOS (frontend)

Expo / React Native app for LifeOS.

## Develop

```bash
npm ci
npm run start
```

## CI

On every push or PR to `main`, GitHub Actions runs `npm ci`, then **lint** and **Typecheck** (see `.github/workflows/ci.yml`). Lint/typecheck steps use `continue-on-error` until the codebase is clean; **`npm ci` must pass**.

Configure backend URL via `EXPO_PUBLIC_BACKEND_URL` or the in-app setting (see `src/services/api.ts`).
