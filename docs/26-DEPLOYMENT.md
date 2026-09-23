# AAMS v2 — Render + Vercel Deployment Runbook

Authoritative, code-verified deployment procedure for THIS deployment target.
Derived from `backend/config/settings/base.py`, `render.yaml`,
`src/services/apiClient.ts`, `vite.config.ts`, and `.env.example`.
If this file conflicts with any older doc, this file wins.

Target: **Render PostgreSQL → Render Django Web Service ← Vercel Vite SPA.**
No Docker, Redis, Celery, S3, or other infrastructure. Empty-database start;
`seed_demo_data` creates the demo dataset.

---

## 1. Architecture

```
Vercel (Vite SPA static: dist/index.html + dist/assets/)
   │  VITE_API_BASE_URL=https://<render-host>/api (baked in at build)
   ▼  HTTPS + Authorization: Token <token> (exact-origin CORS, no wildcard)
Render Web Service (gunicorn config.wsgi:application, DEBUG=false)
   │  WhiteNoise serves /static/; /media/ served by Django static stack
   ▼  DATABASE_URL (Render-provided connection string)
Render PostgreSQL (aams-db)
```

- Health probe: `GET /api/health/` (`AllowAny`; returns `ok`/`degraded` with
  a live `SELECT 1` DB check). Wired as `healthCheckPath` in `render.yaml`.
- Frontend routing is state-based (no React Router): **no SPA rewrites**,
  no `vercel.json` needed.
- Uploads (`.xlsx` staging) are parsed in-process; raw bytes never retained,
  `MEDIA_ROOT` effectively unused (avatars are URLFields). No volume needed.
  Caps: `.xlsx` only, 5 MB, 5000 rows, 500 chars/cell, admin-only endpoints.
- `wsgi.py`/`asgi.py` default to `config.settings.base`; `manage.py` stays
  on `config.settings.development` for local work. `render.yaml` still sets
  `DJANGO_SETTINGS_MODULE` explicitly (belt and braces).

## 2. Render PostgreSQL setup

Dashboard → New → PostgreSQL (`aams-db`, free plan, same region as the web
service). No extensions or server settings required (plain fields +
`JSONField` only). Note the **Internal Database URL** — `render.yaml`
wires it automatically via `fromDatabase: connectionString`. Nothing to
paste manually when using the Blueprint. The app also accepts discrete
`DB_*` variables as a fallback (local dev path); `DATABASE_URL` takes
precedence when set. Never hard-code credentials; never commit them.

## 3. Render Web Service setup

Option A (recommended): New → Blueprint → select this repo (`render.yaml`
declares the `aams-api` web service + `aams-db` database together).

Option B (manual): New → Web Service → Python, pointing at this repo, then
copy the Build/Start commands (§4–§5) and env vars (§6) below by hand.

## 4. Exact Build Command

```
pip install -r backend/requirements/base.txt && python backend/manage.py migrate --noinput && python backend/manage.py collectstatic --noinput
```

Ordering rationale: install → **migrate first** (empty DB gets the full
schema; re-runs are no-ops) → **collectstatic** (populates
`backend/staticfiles/` served by WhiteNoise). All commands run from the
repo root. Never run `runserver` on Render.

## 5. Exact Start Command

```
gunicorn config.wsgi:application --bind 0.0.0.0:$PORT --workers 3 --chdir backend
```

`$PORT` is provided by Render. `--chdir backend` makes `config.*`
importable. 3 sync workers is right-sized for the demo (single-process
LocMemCache throttles stay coherent per worker; add a shared cache only if
you scale beyond one instance).

## 6. Required Render environment variables

| Variable | Value | Notes |
|---|---|---|
| `DJANGO_SETTINGS_MODULE` | `config.settings.base` | explicit prod profile |
| `DJANGO_DEBUG` | `false` | mandatory; without a secret key the app refuses to start |
| `DJANGO_SECRET_KEY` | generated | use Generate in dashboard; 50+ random chars |
| `DJANGO_ALLOWED_HOSTS` | `.onrender.com` (+ custom domain if added) | leading dot covers all Render subdomains |
| `DJANGO_TIME_ZONE` | `UTC` | |
| `DATABASE_URL` | from `aams-db` connectionString | auto-wired by `render.yaml`; overrides `DB_*` |
| `CORS_ALLOWED_ORIGINS` | `https://<your-app>.vercel.app` | **exact** Vercel origin, no wildcard — paste after first Vercel deploy, then redeploy API |
| `CSRF_TRUSTED_ORIGINS` | `https://<your-api>.onrender.com` | required for Django admin POSTs over HTTPS |
| `AAMS_TOKEN_TTL_SECONDS` | `2592000` | 30 days; `0` disables expiry (local-dev only, never prod) |
| `AAMS_SEED_DEMO_DATA` | `false` | demo provisioning only: `true` seeds the demo dataset at build (see §14); set back to `false` afterwards |
| `DJANGO_SECURE_SSL_REDIRECT` | `1` | Render terminates TLS; proxy header is honored |
| `DJANGO_SESSION_COOKIE_SECURE` | `1` | |
| `DJANGO_CSRF_COOKIE_SECURE` | `1` | |
| `DJANGO_SECURE_HSTS_SECONDS` | `31536000` | |
| `DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS` | `1` | |
| `DJANGO_SECURE_HSTS_PRELOAD` | `1` | |

`render.yaml` ships these with `REPLACE_ME_*` placeholders for the two
hostnames that are unknowable until deploy time.

## 7. Vercel project setup

Import this repo → Framework Preset: **Vite** (auto-detected) → Root
Directory: `./` (repo root; `package.json` lives there) → deploy. No
`vercel.json`, no rewrites, no redirects. After the API is live, set the
env var (§9) and redeploy so the new bundle bakes in the API URL.

## 8. Exact Vercel build settings

| Setting | Value |
|---|---|
| Framework Preset | Vite |
| Build Command | `npm run build` (= `vite build`; default — leave as detected) |
| Output Directory | `dist` (default — leave as detected) |
| Install Command | `npm install` (default) |

Non-default settings are not required.

## 9. Required Vercel environment variable

| Variable | Value | Applies to |
|---|---|---|
| `VITE_API_BASE_URL` | `https://<your-api>.onrender.com/api` | Production (include the `/api` path) |

## 10. Connecting Vercel → Render API

1. Deploy Render API + database first (gets `https://<api>.onrender.com`).
2. Verify `https://<api>.onrender.com/api/health/` returns `{"status":"ok",...}`.
3. Deploy Vercel once (any API URL), note the `https://<app>.vercel.app` origin.
4. Set `CORS_ALLOWED_ORIGINS` on Render to that exact origin; redeploy API.
5. Set `VITE_API_BASE_URL` on Vercel to the Render `/api` URL; redeploy web.
6. Sign in on the Vercel URL. (`VITE_*` is baked at build time — changing it
   always requires a Vercel redeploy.)

## 11. CORS/CSRF configuration

All host/origin policy is environment-driven (`base.py`); nothing is
hard-coded: `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` (exact origins,
never `*`), `CSRF_TRUSTED_ORIGINS` (exact `https://` backend origin).
Local development defaults (`localhost`/`127.0.0.1`) apply only when the
vars are unset, so local work is untouched.

## 12. Migration procedure

Automatic: `migrate --noinput` runs in the Render build on every deploy
(safe: additive migrations, no-op when current). Manual fallback via Render
Shell: `python backend/manage.py migrate --noinput` from the repo root.

## 13. Static file procedure

Automatic: `collectstatic --noinput` runs in the Render build; WhiteNoise
(`whitenoise.middleware.WhiteNoiseMiddleware`, directly after
`SecurityMiddleware`) serves `/static/` with `DEBUG=false`. No extra
static host, no storage-backend changes (default staticfiles storage).

## 14. Demo data/account setup

This is **demo provisioning, not production data initialization**. Two paths:

**A. Build-time seeding (no Shell required — Render free plan).**
`render.yaml` declares `AAMS_SEED_DEMO_DATA` defaulting to `"false"`. The
build runs the seed **only** when it is exactly `"true"`:

1. In the Render dashboard set `AAMS_SEED_DEMO_DATA=true` and deploy.
   The build invokes `python backend/manage.py seed_demo_data --quiet
   --noinput` after migrate/collectstatic (`--quiet` keeps the demo
   password out of build logs).
2. Verify the demo logins, then set `AAMS_SEED_DEMO_DATA=false` and
   redeploy to return to the safe default.

**B. Render Shell (paid plans),** repo root, one time after first deploy:

```
python backend/manage.py seed_demo_data
```

The command is idempotent (all `get_or_create`, single atomic transaction;
re-runs create nothing new). **Warning:** every run **resets the demo
admin account's password** to the documented demo password (teacher/student
passwords are set on creation only). Creates semester SEM-S4, sections A/B,
timetable, and accounts admin/`admin`, teacher/`tch-3`, student/`std-1`
(username-based login). Rotate or delete these immediately for any non-demo
use — the password is public in this repo.

## 15. Production verification checklist

- [ ] `https://<api>.onrender.com/api/health/` → `{"status": "ok", "database": "connected", ...}`
- [ ] Admin login on the Vercel URL works (proves CORS + token auth end-to-end)
- [ ] Teacher login sees teacher-only views; student login sees student views
- [ ] Direct cross-role API call with a student token → 403 (server enforcement)
- [ ] Django admin login + any POST works (proves `CSRF_TRUSTED_ORIGINS`)
- [ ] `seed_demo_data` run; demo logins verified; passwords rotated if non-demo
- [ ] Render build log shows migrate + collectstatic succeeding

## 16. Common deployment failures and what they mean

| Symptom | Meaning / fix |
|---|---|
| `ImproperlyConfigured: DJANGO_SECRET_KEY must be set` at boot | `DJANGO_DEBUG=false` without `DJANGO_SECRET_KEY` — set the secret (by design) |
| `DisallowedHost` / 400 on every request | `DJANGO_ALLOWED_HOSTS` missing the Render host — add it |
| Browser CORS error, API reachable directly | `CORS_ALLOWED_ORIGINS` missing the exact Vercel origin (scheme + host, no path) |
| Django admin login loops / 403 on POST | `CSRF_TRUSTED_ORIGINS` missing the exact `https://` backend origin |
| Redirect loop http↔https | `DJANGO_SECURE_SSL_REDIRECT=1` without proxy header — Render sets `X-Forwarded-Proto`; keep the flag at `1` on Render |
| `connection to server failed` at migrate/boot | `DATABASE_URL` not wired — check the `fromDatabase` link / database status |
| Unstyled admin / 404 on `/static/*` | `collectstatic` didn't run or WhiteNoise misordered — build must include it; middleware sits right after `SecurityMiddleware` |
| Frontend calls `127.0.0.1:8000` in production | `VITE_API_BASE_URL` unset at build — set it on Vercel and **redeploy** (baked at build time) |
| `relation does not exist` on first request | migrations never ran — run the §12 manual fallback, then redeploy |
| Demo seed ran on a non-demo database | `AAMS_SEED_DEMO_DATA` left `true` — set `false`, redeploy; reset affected passwords |
