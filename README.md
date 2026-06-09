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
│   ├── update-results.js  # Script de actualización de resultados
│   └── package.json
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

El campo `matches.api_fixture_id` mapea cada partido al ID del proveedor de resultados. Hay dos opciones:

**Opción A (recomendada) — manual:**
1. Regístrate en [football-data.org](https://www.football-data.org/client/register) (free tier, no necesitas tarjeta)
2. Busca los fixtures del Mundial 2026 (`competition=WC`) y anota el ID de cada partido
3. Ejecuta en Supabase SQL Editor:
   ```sql
   UPDATE public.matches SET api_fixture_id = 12345 WHERE id = 1;
   -- Repite para los 72 partidos
   ```

**Opción B — fuzzy match automático:**
Próximamente: script que consulta al proveedor y empareja por equipos + fecha.

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
   | **Schedule** | `*/10 * * * *` (cada 10 min) |

5. En **Environment Variables**, agrega:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PROVIDER` = `football-data`
   - `FOOTBALL_DATA_API_KEY`

> El cron solo actúa sobre partidos cuyo kickoff ya pasó y que tengan `api_fixture_id` poblado. No escribe resultados parciales — solo cuando el proveedor reporta el partido como `FINISHED`.

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
Render Cron (cada 10 min)
  │  consulta football-data.org
  └─ llama set_match_result() cuando un partido termina
```

---

## Notas

- Los horarios de los partidos están guardados en UTC (se sumaron 6h al horario CDMX). La UI los muestra en `America/Mexico_City` automáticamente.
- RLS evita que un usuario modifique predicciones de otro o las cambie después del kickoff. El cron usa `service_role` que bypassa RLS.
- La tabla de posiciones (`leaderboard`) se actualiza en tiempo real vía Supabase Realtime cuando el cron escribe un resultado.
