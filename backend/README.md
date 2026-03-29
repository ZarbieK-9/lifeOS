# LifeOS backend

Python gRPC API + PostgreSQL. Deploy: `.github/workflows/deploy.yml` (SSH + `scripts/deploy.sh`).

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/alembic upgrade head
.venv/bin/python -m app.server
```

Env: `DATABASE_URL`, `JWT_SECRET`, etc. (`app/config.py`). Proto: `./generate.sh`, check stubs: `./check_generated.sh`.
