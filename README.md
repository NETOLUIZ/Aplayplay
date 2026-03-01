# MeuApp - Frontend + Backend

Projeto organizado com separacao entre frontend e backend.

## Estrutura

- `frontend/`: aplicacao React (Vite)
- `backend/`: API Node.js com Express

## Como rodar local

1. Instale dependencias do frontend:
`npm --prefix frontend install`
2. Instale dependencias do backend:
`npm --prefix backend install`
3. Rode o frontend (porta do Vite, ex. 5173):
`npm run dev:frontend`
4. Em outro terminal, rode o backend (porta 3001):
`npm run dev:backend`

## Endpoint de health

- `GET http://localhost:3001/api/health`

## Variaveis de ambiente

Backend (`backend/.env.example`):
- `PORT=3001`
- `CORS_ORIGIN=http://localhost:5173`
- `ADMIN_EMAIL=admin@aplayplay.com`
- `ADMIN_PASSWORD=123456`

Frontend (`frontend/.env.example`):
- `VITE_API_BASE_URL=http://localhost:3001`

## Deploy Render + Vercel

### Backend no Render
1. Conecte o repositorio no Render.
2. Use o `render.yaml` da raiz.
3. Defina variaveis: `CORS_ORIGIN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
4. Healthcheck: `/api/health`.

### Frontend na Vercel
1. Crie projeto apontando para a pasta `frontend`.
2. Build command: `npm run build`.
3. Output directory: `dist`.
4. Defina `VITE_API_BASE_URL` com a URL publica do backend no Render.
5. O arquivo `frontend/vercel.json` ja faz rewrite SPA para `index.html`.

## API funcional (demo)

- `POST /api/auth/admin/login`
- `POST /api/auth/logout`
- `GET /api/admin/me`
- `GET /api/admin/drivers`
- `PATCH /api/admin/drivers/:id`
- `GET /api/admin/passengers`
- `PATCH /api/admin/passengers/:id/status`
- `DELETE /api/admin/passengers/:id`
- `POST /api/drivers/signup`
- `POST /api/drivers/login`
- `GET /api/drivers/:slug/public`
- `POST /api/passengers/signup`
- `POST /api/passengers/login`
- `POST /api/rides`
- `GET /api/rides`
- `PATCH /api/rides/:id/status`
- `GET /api/chat/:rideId/messages`
- `POST /api/chat/:rideId/messages`
