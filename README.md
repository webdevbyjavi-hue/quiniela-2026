# Quiniela Copa Mundial 2026

Pool de pronósticos 1X2 para los 72 partidos de la fase de grupos. Stack: Next.js (App Router) en Vercel + Supabase (Postgres + Auth) + cron Node.js en Render.

---

## Estructura

```
quiniela-2026/
├── app/
│   ├── layout.js          # HTML shell, metadata
│   ├── page.js            # UI completa (client component)
│   └── globals.css        # Diseño "papeleta"
├── lib/
│   └── supabaseClient.js  # Cliente Supabase (anon key)
├── cron/
│   ├── update-results.js  # Script de actualización de resultados (polling inteligente)
│   └── package.json
├── scripts/
│   └── populate-fixture-ids.js  # Script único: empareja partidos con IDs de football-data.org
├── supabase/
│   └── schema.sql         # Schema + seed de 72 partidos
├── .env.example
└── README.md
```

---

## 1. Supabase — Schema y datos

### Requisitos previos
- Proyecto Supabase creado en [supabase.com](https://supabase.com)
- Copia tu **Project URL** y **anon key** (Settings → API)
- Copia también tu **service_role key** (para el cron)

### Ejecutar el schema

1. Ve a tu proyecto → **SQL Editor** → **New query**
2. Pega el contenido de `supabase/schema.sql`
3. Haz clic en **Run**

Esto crea las tablas, índices, vista `leaderboard`, RLS, trigger de perfil automático, función `set_match_result`, y los 72 partidos de la fase de grupos.

### Habilitar autenticación por magic link

1. Ve a **Authentication → Providers**
2. Asegúrate de que **Email** esté habilitado
3. En **Email Templates**, puedes personalizar el correo del magic link si quieres
4. En **URL Configuration** → **Site URL**, pon la URL de tu app en Vercel (o `http://localhost:3000` para desarrollo local)
5. Agrega también `http://localhost:3000` en **Redirect URLs** para poder probar en local

### Poblar `api_fixture_id` (antes de activar el cron)

El campo `matches.api_fixture_id` mapea cada partido al ID del proveedor de resultados.

`scripts/populate-fixture-ids.js` hace esto automáticamente: con **una sola petición** a
`/v4/competitions/WC/matches`, empareja los 72 partidos de fase de grupos por equipos
(traducidos ES↔EN) + fecha de kickoff, y escribe `api_fixture_id` en Supabase.

```bash
# Vista previa (no escribe nada)
node --env-file=.env.local scripts/populate-fixture-ids.js

# Aplica los cambios a Supabase
node --env-file=.env.local scripts/populate-fixture-ids.js --apply
```

Requiere `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `FOOTBALL_DATA_API_KEY` en `.env.local`.
Solo necesita ejecutarse una vez (ya aplicado para esta instancia).

---

## 2. Variables de entorno

Copia `.env.example` a `.env.local` y llena los valores:

```bash
cp .env.example .env.local
```

| Variable | Dónde obtenerla |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon key |
| `SUPABASE_URL` | igual que arriba (para el cron en Render) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role key |
| `FOOTBALL_DATA_API_KEY` | [football-data.org](https://www.football-data.org/client/register) |
| `API_FOOTBALL_KEY` | RapidAPI → API-Football (solo si `PROVIDER=api-football`) |

> **Importante:** `SUPABASE_SERVICE_ROLE_KEY` solo va en el servidor (Render). Jamás en el cliente ni en `NEXT_PUBLIC_*`.

---

## 3. Desarrollo local

```bash
# Instala dependencias
npm install

# Arranca el servidor de desarrollo
npm run dev
# → http://localhost:3000
```

---

## 4. Deploy en Vercel

1. Importa el repositorio en [vercel.com/new](https://vercel.com/new)
2. Framework: **Next.js** (detectado automáticamente)
3. En **Environment Variables**, agrega:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Haz clic en **Deploy**
5. Una vez desplegado, copia la URL de producción y agrégala como **Redirect URL** en Supabase Authentication → URL Configuration

---

## 5. Deploy del cron en Render

El cron está en `cron/` y es un **Node.js background worker** que Render ejecuta en un horario.

1. Crea una cuenta en [render.com](https://render.com)
2. New → **Cron Job**
3. Conecta el mismo repositorio
4. Configuración:
   | Campo | Valor |
   |---|---|
   | **Name** | `quiniela-cron` |
   | **Root Directory** | `cron` |
   | **Runtime** | Node |
   | **Build Command** | `npm install` |
   | **Start Command** | `node update-results.js` |
   | **Schedule** | `*/5 * * * *` (cada 5 min) |

5. En **Environment Variables**, agrega:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PROVIDER` = `football-data`
   - `FOOTBALL_DATA_API_KEY`

### Polling inteligente

El cron respeta el límite de **10 req/min** del free tier de football-data.org así:

1. Primero consulta Supabase (gratis) por partidos `pendiente`/`en_vivo` con `api_fixture_id`
   y kickoff ya pasado. **Si no hay ninguno, termina sin llamar a la API** — la mayor parte
   del día esto es 0 peticiones.
2. Si hay partidos por revisar, hace **una sola petición bulk** a
   `/v4/competitions/WC/matches?dateFrom=...&dateTo=...` cubriendo el rango de fechas
   necesario, sin importar cuántos partidos estén en juego simultáneamente.
3. Partidos `FINISHED` → `set_match_result()` (registra marcador, calcula `resultado`,
   marca `finalizado`). Partidos `IN_PLAY`/`PAUSED` → marca `estado='en_vivo'` (la UI ya
   muestra el badge "● EN VIVO").
4. Si aun así llega un 429, reintenta con backoff respetando `Retry-After` (hasta 3 intentos).

Con `*/5 * * * *` esto nunca excede ~1 petición cada 5 minutos durante los partidos.

### Cambiar de proveedor

Para usar API-Football en vez de football-data.org:
1. Cambia `PROVIDER=api-football` en Render
2. Agrega `API_FOOTBALL_KEY` con tu clave de RapidAPI
3. Actualiza `api_fixture_id` con los IDs de API-Football (distintos a los de football-data.org)

---

## 6. Resumen de la arquitectura

```
Usuario (móvil)
  │
  ▼
Vercel (Next.js)
  │  lee/escribe predicciones vía anon key
  │  suscripción realtime a cambios en matches
  ▼
Supabase (Postgres + Auth)
  │  service_role key
  ▼
Render Cron (cada 5 min)
  │  si hay partidos pendientes con kickoff pasado:
  │    1 petición bulk a football-data.org (rango de fechas)
  ├─ FINISHED  → set_match_result()  (resultado + leaderboard se recalculan solos)
  └─ IN_PLAY   → estado='en_vivo'
```

---

## Notas

- Los horarios de los partidos están guardados en UTC (se sumaron 6h al horario CDMX). La UI los muestra en `America/Mexico_City` automáticamente.
- RLS evita que un usuario modifique predicciones de otro o las cambie después del kickoff. El cron usa `service_role` que bypassa RLS.
- La tabla de posiciones (`leaderboard`) se actualiza en tiempo real vía Supabase Realtime cuando el cron escribe un resultado.
