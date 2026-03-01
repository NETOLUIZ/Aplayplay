# Aplayplay Frontend

Aplicacao web React + Vite do projeto Aplayplay.

## Requisitos

- Node.js 20+

## Rodar local

1. Instalar dependencias:
`npm install`
2. Configurar ambiente:
`cp .env.example .env` (ou criar manualmente)
3. Rodar:
`npm run dev`

## Build

`npm run build`

## Deploy na Vercel

- Root Directory: `frontend`
- Build Command: `npm run build`
- Output Directory: `dist`
- Variavel obrigatoria:
  - `VITE_API_BASE_URL=https://SEU-BACKEND.onrender.com`

O arquivo `vercel.json` ja inclui rewrite SPA para `index.html`.
