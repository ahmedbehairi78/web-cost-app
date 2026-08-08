# Local LAN Deployment

## Requirements

- One Windows or Linux machine on the office LAN.
- PostgreSQL 16 or Docker Desktop.
- Node.js 22 if running without Docker.
- Static IP or local DNS name for the server.

## Docker Deployment

```powershell
cd deploy
docker compose -f docker-compose.local.yml up -d --build
```

Then initialize the database:

```powershell
npm run prisma:migrate
npm run local:bootstrap-admin
```

Default bootstrap credentials:

- Email: `admin@local.app`
- Password: `admin12345`

Change the password immediately.

## Manual Deployment

```powershell
npm install
npm run prisma:migrate
npm run local:bootstrap-admin
npm run build
npm run local:build-server
npm run local:start
```

## Backups

Create a daily scheduled task that runs:

```powershell
.\scripts\backup-postgres.ps1
```

Test restore before go-live:

```powershell
.\scripts\restore-postgres.ps1 -BackupFile .\backups\web_cost_app-yyyyMMdd-HHmmss.dump
```

## LAN Security

- Do not expose PostgreSQL outside the server machine.
- Open only the application port to LAN users.
- Use a strong `SESSION_SECRET`.
- Keep a read-only Firebase backup until all reports reconcile.
