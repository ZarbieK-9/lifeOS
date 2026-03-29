# LifeOS

Offline-first AI life management: **Expo / React Native** (`frontend/`) and **Python gRPC** backend (`backend/`) with PostgreSQL.

## Frontend

```bash
cd frontend
npm ci
npm run start
```

## Backend

```bash
cd backend
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/alembic upgrade head
.venv/bin/python -m app.server
```

`DATABASE_URL` (e.g. `postgresql+asyncpg://...`) and `JWT_SECRET` via environment or `.env`. See `backend/app/config.py`.

### Proto / gRPC

After changing `backend/proto/lifeos.proto`, regenerate stubs and the Envoy JSON descriptor:

```bash
cd backend
./generate.sh
```

`backend/proto.pb` is produced next to `backend/envoy.yaml` for gRPC–JSON transcoding. Validate tracked stubs:

```bash
cd backend
./check_generated.sh
```

### Deploy (GitHub Actions)

Push to `main` runs `.github/workflows/deploy.yml` (SSH to your server). Configure repository secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`. On the host, the repo is updated and `backend/scripts/deploy.sh` runs (venv, generate, Alembic, PM2).

## Hey Zarbie (Android)

Dev build with `frontend/plugins/withHeyZarbieAndroid.js`. See `frontend/docs/heyzarbie-android-validation.md`.
