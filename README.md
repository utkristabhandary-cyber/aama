# AAMS — Academic Attendance Management System

Web-based attendance management system: Django REST Framework backend + React (Vite) frontend.
**Web-only** — no mobile/desktop client (Phase 2 removed them).

## Repository layout

```
aams-—-academic-attendance-management-system/
├── backend/          Django + DRF REST API (see backend/README.md)
├── src/              Vite + React 19 web frontend
├── docs/             Living documentation set (see docs/README.md)
└── .env.example      Copy to .env and fill in your own values
```

## Quick start

### Backend

```bash
py -m pip install -r backend/requirements/development.txt
py backend/manage.py migrate
py backend/manage.py seed_demo_data
py backend/manage.py runserver
```

Configuration comes from `.env` at the repository root (git-ignored; template in
`.env.example`). See `backend/README.md` for demo accounts, API overview, and rules.

### Frontend

```bash
npm install
npm run dev         # http://localhost:3000 (Vite, proxies /api to the backend)
npm run lint        # tsc --noEmit
npm run build       # esbuild production bundle
```

## Documentation

The authoritative docs set is in [docs/](docs/README.md): system status, architecture,
requirements, per-module design, database schema, API reference, security audit, known
issues, implementation gaps, and the implementation-roadmap (audit-matrix).
Historical phase reports and removed-architecture docs are preserved under `docs/archive/`.

## Notes

- `.env` contains real dev credentials and is git-ignored — keep it out of any VCS history.
- Every screen is server-backed or honestly read-only; the legacy frontend localStorage
  mock store was removed (Phase G). Promotion execution and settings editing have no backend
  API yet and are intentionally disabled/read-only — see `docs/07-ADMIN-MODULE.md` and
  `docs/23-IMPLEMENTATION-GAPS.md`.