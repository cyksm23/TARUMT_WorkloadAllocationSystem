# PHP API — core service

Raw PDO + PostgreSQL. No ORM. Laravel-style folder layout only — no framework.

## Run

```bash
composer install
php -S localhost:8000 -t public
```

Health check: `curl http://localhost:8000/api/health`
Expected: `{"status": "ok", "service": "php-api"}`

## Configuration

`.env` (see `.env.example`): DB credentials + `CORS_ORIGIN`.

## Planned layout

| Folder | Purpose |
|---|---|
| routes/ | route table |
| controllers/ | request handlers per resource |
| services/ | business rules (submission, approval workflow, history) |
| repositories/ | raw PDO + SQL per table |
| middleware/ | auth (JWT), CORS, role checks |
| validators/ | input validation |
| config/ | PDO factory, .env loader |
