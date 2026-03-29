# LifeOS (frontend)

Expo / React Native app for LifeOS.

## Develop

```bash
npm ci
npm run start
```

## CI

In the **LifeOS** repo (monorepo root), pushes/PRs to `main` that touch `frontend/` run **Frontend CI** (see `../.github/workflows/frontend-ci.yml`). If you split this folder into its own repo, add a copy of that workflow under `.github/workflows/` at the new root.

Configure backend URL via `EXPO_PUBLIC_BACKEND_URL` or the in-app setting (see `src/services/api.ts`).
