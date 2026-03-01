# Aplayplay Backend

API Node.js + Express do projeto Aplayplay.

## Requisitos

- Node.js 20+

## Rodar local

1. Instalar dependencias:
`npm install`
2. Configurar ambiente:
`cp .env.example .env` (ou criar manualmente)
3. Rodar:
`npm run dev`

## Start producao

`npm run start`

## Healthcheck

`GET /api/health`

## Deploy no Render

- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm run start`
- Health Check Path: `/api/health`
- Variaveis recomendadas:
  - `CORS_ORIGIN=https://SEU-FRONT.vercel.app`
  - `ADMIN_EMAIL=admin@aplayplay.com`
  - `ADMIN_PASSWORD=123456`
