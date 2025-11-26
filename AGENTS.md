# Repository Guidelines

## Estructura del proyecto y módulos
- Monorepo con workspaces de npm.
  - `packages/frontend/`: React para la UI del prompt y vista previa de respuestas.
  - `packages/backend/`: Servicio Node.js que arma prompt genérico + prompt guardado + payload recibido y lo envía a OpenAI.
  - `packages/shared/`: Tipos, helpers de prompts y validadores comunes.
  - `scripts/` o `.github/` para tareas de CI y automatizaciones.
- Coloca fixtures y mocks en `packages/**/tests/fixtures/`. Mantén assets de UI dentro de `packages/frontend/public/`.

## Comandos de build, test y desarrollo
- `npm install`: instala dependencias en todos los workspaces (ejecutar en la raíz).
- `npm run dev --workspace packages/frontend`: arranca el front en modo desarrollo.
- `npm run dev --workspace packages/backend`: arranca el simulador API en hot-reload (por defecto en `127.0.0.1:40000`).
- `npm test --workspaces`: ejecuta la batería de pruebas de todos los paquetes.
- `npm run lint --workspaces`: linting unificado con ESLint/Prettier.
- `npm run typecheck --workspaces`: comprueba tipos (TypeScript estricto recomendado).

## Estilo de código y convenciones
- TypeScript por defecto en front y back. Sangría de 2 espacios y líneas ~100 caracteres.
- Nombres: kebab-case para archivos utilitarios, PascalCase para componentes React, camelCase para funciones/variables.
- React: componentes pequeños y centrados; extrae lógica compartida a hooks en `packages/shared/`.
- Ejecuta `npm run lint` antes de subir cambios; evita imports circulares y cualquier `any` innecesario.

## Guía de pruebas
- Framework sugerido: Vitest/Jest; React Testing Library para UI; Supertest/fastify inject para rutas HTTP.
- Nombra los tests `*.test.ts(x)` paralelo al código fuente.
- Prioriza pruebas de ensamblado de prompt, validación de payloads y manejo de errores de OpenAI. Evita mockear en exceso: valida contratos de entrada/salida.
- Incluye ejemplos de requests/responses realistas en fixtures; mantén los snapshots estables.

## Commits y Pull Requests
- Convención: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, etc.), sujeto breve e imperativo.
- Cada PR debe explicar qué cambia, riesgo esperado y evidencia de pruebas (`npm test`, `npm run lint`).
- Adjunta capturas o muestras de request/response cuando cambie la UI o el formato de respuesta.
- Prefiere PRs pequeños y temáticos; no mezcles refactor con features nuevas.

## Seguridad y configuración
- Variables sensibles (p. ej., `OPENAI_API_KEY`) solo en `.env.*` locales; nunca las subas. Documenta las requeridas en README.
- Valida métodos y esquemas de entrada en `packages/backend`; rechaza payloads ambiguos y registra sin exponer datos sensibles.
- Si se guarda el prompt en memoria, considera límites y limpieza para evitar respuestas contaminadas entre sesiones.
