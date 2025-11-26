# API Ganger – el imitador de APIs con IA y mucha cara dura

API Ganger es un pequeño laboratorio para fingir que tienes una API lista sin haber escrito ni una línea de negocio. Le das un prompt, un endpoint y un payload, y él se inventa el esquema, ejecuta SQL en memoria y te devuelve una respuesta convincente (o se queja si no tiene tu API key).

## Cómo funciona (versión ascensor)
- Guardas un prompt base que describe el sistema (ERP, CRM, nave espacial…).
- Marcas método y ruta objetivo.
- Envías un JSON de ejemplo.
- El backend pide a OpenAI dos cosas: el SQL para preparar tablas y el SQL para responder.
- Se ejecuta todo en SQLite en memoria y te devuelve el select final como respuesta del endpoint.
- Si algo explota, ves el SQL que intentó correr para ajustar el prompt.

## Piezas del tinglado
- `packages/backend/` – Fastify + OpenAI. Monta los prompts, ejecuta SQL en SQLite y expone `/api/*`.
- `packages/frontend/` – React + Vite. UI para editar el prompt, lanzar simulaciones y ver el SQL generado.
- `packages/shared/` – Tipos y constantes compartidas (TypeScript puro).

## Arranque exprés
1) Instala dependencias en la raíz:
   ```bash
   npm install
   ```
2) Prepara variables de entorno:
- Backend (`packages/backend/.env`): `OPENAI_API_KEY=tu_api_key` y opcional `PORT=40000`. Puedes sobrescribir los prompts iniciales con `DEFAULT_GENERIC_PROMPT` y `DEFAULT_STORED_PROMPT`.
- Frontend (`packages/frontend/.env`): `VITE_API_BASE=http://127.0.0.1:40000` (o la URL donde corre el backend).
3) Levanta backend y frontend (dos terminales):
   ```bash
   npm run dev:backend
   npm run dev:frontend
   ```
4) Abre el front (Vite te dirá el puerto, suele ser 5173) y juega con el prompt. El backend escucha en `127.0.0.1:40000` por defecto.

## Endpoints útiles del backend
- `GET /api/health` – Comprueba si el servicio vive y si hay API key cargada.
- `GET /api/prompt` – Obtiene prompt, método y endpoint actuales.
- `POST /api/prompt` – Guarda prompt/método/endpoint. Cuerpo: `{ "prompt": "...", "method": "POST", "endpoint": "/algo" }`.
- `POST /api/simulate` – Simula el endpoint. Cuerpo típico:
  ```json
  {
    "method": "POST",
    "endpoint": "/clients/75",
    "payload": { "customer": { "name": "Ada", "email": "ada@example.com" } }
  }
  ```
  Devuelve prompts generados, SQL ejecutado y la respuesta derivada del último `SELECT`.
- `POST /api/scenario` – Reinicia la base y pide a OpenAI un contexto random (hotel, hospital, ERP, CRM, etc.) con endpoint y payload de ejemplo. Devuelve los campos ya listos para simular.
- `POST /api/reset` – Limpia memoria y reinicia la base en memoria (adiós tablas fantasma).

## Scripts de la monorepo
- `npm run dev` – Backend + frontend a la vez (dos procesos).
- `npm run build` – Compila todos los paquetes.
- `npm test`, `npm run lint`, `npm run typecheck` – Tareas agrupadas para cada workspace.

## Cosas a tener en cuenta
- Sin `OPENAI_API_KEY` no hay magia: la simulación falla porque no puede generar SQL.
- La base es volátil (SQLite en memoria). Reinicia fácil, pero no guarda datos entre sesiones.
- El historial se recorta a las últimas 8 interacciones para que no pese (véase `MAX_HISTORY` en el backend).
- No metas datos sensibles en los prompts ni payloads. Esto es un imitador, no un bóveda.

## ¿Para qué sirve?
- Demos rápidas de contract-first: enseña cómo “respondería” tu API ideal.
- Prototipos de front sin esperar a backend real.
- Juegos de “¿qué pasa si?” ajustando prompts para endurecer validaciones o cambios de esquema.

Listo, ahora ya puedes vacilar de API sin haber escrito la API. 🎭
