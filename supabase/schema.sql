-- ============================================================
-- Quiniela Copa Mundial 2026 — Supabase Schema
-- Run once in the Supabase SQL Editor (Project → SQL Editor → New query)
-- ============================================================

-- ── Tables ───────────────────────────────────────────────────

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.matches (
  id             int  primary key,
  jornada        int  not null check (jornada between 1 and 3),
  grupo          text not null,
  equipo_local   text not null,
  equipo_visita  text not null,
  fecha_hora     timestamptz not null,          -- stored UTC; display in CDMX (UTC-6)
  goles_local    int,
  goles_visita   int,
  resultado      text check (resultado in ('L','E','V')),
  estado         text not null default 'pendiente'
                 check (estado in ('pendiente','en_vivo','finalizado')),
  api_fixture_id int,                           -- provider match ID; populate before cron runs
  updated_at     timestamptz not null default now()
);

create table if not exists public.predictions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  match_id   int  not null references public.matches(id) on delete cascade,
  prediccion text not null check (prediccion in ('L','E','V')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, match_id)
);

create index if not exists idx_predictions_user_id  on public.predictions(user_id);
create index if not exists idx_predictions_match_id on public.predictions(match_id);
create index if not exists idx_matches_estado       on public.matches(estado);

-- ── Realtime ─────────────────────────────────────────────────
-- Required so clients get postgres_changes UPDATE events when the cron
-- flips matches.estado (en_vivo / finalizado) without a page refresh.

alter publication supabase_realtime add table public.matches;

-- ── App config ───────────────────────────────────────────────
-- Single source of truth for the global predictions lock time.
-- Used by both the client and the predictions RLS policies below.

create table if not exists public.app_config (
  key   text primary key,
  value text not null
);

insert into public.app_config (key, value) values
  ('predictions_lock_at', '2026-06-11T17:00:00Z')  -- 11:00 AM Mountain Time (MDT, UTC-6)
on conflict (key) do nothing;

-- ── Leaderboard view ─────────────────────────────────────────

create or replace view public.leaderboard as
select
  p.id                                                                      as user_id,
  p.nombre,
  count(pr.id)                                                              as partidos_jugados,
  count(pr.id) filter (
    where pr.prediccion = m.resultado
      and m.estado = 'finalizado'
  )                                                                         as aciertos,
  count(pr.id) filter (
    where pr.prediccion = m.resultado
      and m.estado = 'finalizado'
  )                                                                         as puntos
from public.profiles p
left join public.predictions pr on pr.user_id = p.id
left join public.matches     m  on m.id       = pr.match_id
group by p.id, p.nombre
order by puntos desc, aciertos desc, p.nombre asc;

-- ── Grants ───────────────────────────────────────────────────

grant select           on public.profiles    to authenticated;
grant insert, update   on public.profiles    to authenticated;
grant select           on public.matches     to authenticated;
grant select           on public.predictions to authenticated;
grant insert, update   on public.predictions to authenticated;
grant select           on public.leaderboard to authenticated;
grant select           on public.app_config  to authenticated;

-- service_role bypasses RLS; grant full access for cron writes
grant all on public.matches     to service_role;
grant all on public.predictions to service_role;
grant all on public.profiles    to service_role;
grant all on public.app_config  to service_role;

-- ── Row Level Security ───────────────────────────────────────

alter table public.profiles    enable row level security;
alter table public.matches     enable row level security;
alter table public.predictions enable row level security;
alter table public.app_config  enable row level security;

-- profiles
create policy "profiles_select"
  on public.profiles for select to authenticated using (true);

create policy "profiles_insert"
  on public.profiles for insert to authenticated with check (auth.uid() = id);

create policy "profiles_update"
  on public.profiles for update to authenticated using (auth.uid() = id);

-- matches — read-only for clients; cron uses service_role which bypasses RLS
create policy "matches_select"
  on public.matches for select to authenticated using (true);

-- app_config — read-only for clients
create policy "app_config_select"
  on public.app_config for select to authenticated using (true);

-- predictions — anyone can see picks after lock
create policy "predictions_select"
  on public.predictions for select to authenticated using (true);

-- predictions — insert only own row, only before kickoff and before the
-- global predictions lock (app_config.predictions_lock_at)
drop policy if exists "predictions_insert" on public.predictions;
create policy "predictions_insert"
  on public.predictions for insert to authenticated
  with check (
    auth.uid() = user_id
    and now() < (select value::timestamptz from public.app_config where key = 'predictions_lock_at')
    and exists (
      select 1 from public.matches m
      where m.id     = match_id
        and now()   < m.fecha_hora
        and m.estado = 'pendiente'
    )
  );

-- predictions — update only own row, only before kickoff and before the
-- global predictions lock (app_config.predictions_lock_at)
drop policy if exists "predictions_update" on public.predictions;
create policy "predictions_update"
  on public.predictions for update to authenticated
  using (
    auth.uid() = user_id
    and now() < (select value::timestamptz from public.app_config where key = 'predictions_lock_at')
    and exists (
      select 1 from public.matches m
      where m.id     = match_id
        and now()   < m.fecha_hora
        and m.estado = 'pendiente'
    )
  )
  with check (
    auth.uid() = user_id
    and now() < (select value::timestamptz from public.app_config where key = 'predictions_lock_at')
    and exists (
      select 1 from public.matches m
      where m.id     = match_id
        and now()   < m.fecha_hora
        and m.estado = 'pendiente'
    )
  );

-- ── Auto-profile trigger ─────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nombre)
  values (
    new.id,
    coalesce(
      trim(new.raw_user_meta_data->>'nombre'),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── set_match_result (called by cron via service_role) ───────

create or replace function public.set_match_result(
  p_match_id     int,
  p_goles_local  int,
  p_goles_visita int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resultado text;
begin
  v_resultado := case
    when p_goles_local > p_goles_visita then 'L'
    when p_goles_local = p_goles_visita then 'E'
    else                                     'V'
  end;

  update public.matches
  set
    goles_local  = p_goles_local,
    goles_visita = p_goles_visita,
    resultado    = v_resultado,
    estado       = 'finalizado',
    updated_at   = now()
  where id = p_match_id;
end;
$$;

-- ── Match seed — 72 group-stage matches ──────────────────────
-- All times stored UTC; original schedule in CDMX (UTC-6), +6 h applied.
-- api_fixture_id left NULL — populate manually or via script before cron runs.

insert into public.matches (id, jornada, grupo, equipo_local, equipo_visita, fecha_hora) values

-- ── Jornada 1 ────────────────────────────────────────────────
-- Grupo A
( 1, 1, 'A', 'México',             'Sudáfrica',            '2026-06-11 19:00:00+00'),
( 2, 1, 'A', 'Corea del Sur',      'República Checa',      '2026-06-12 02:00:00+00'),
-- Grupo B
( 3, 1, 'B', 'Canadá',             'Bosnia y Herzegovina', '2026-06-12 19:00:00+00'),
( 5, 1, 'B', 'Catar',              'Suiza',                '2026-06-13 19:00:00+00'),
-- Grupo C
( 6, 1, 'C', 'Brasil',             'Marruecos',            '2026-06-13 22:00:00+00'),
( 7, 1, 'C', 'Haití',              'Escocia',              '2026-06-14 01:00:00+00'),
-- Grupo D
( 4, 1, 'D', 'Estados Unidos',     'Paraguay',             '2026-06-13 01:00:00+00'),
( 8, 1, 'D', 'Australia',          'Turquía',              '2026-06-14 04:00:00+00'),
-- Grupo E
( 9, 1, 'E', 'Alemania',           'Curazao',              '2026-06-14 17:00:00+00'),
(11, 1, 'E', 'Costa de Marfil',    'Ecuador',              '2026-06-14 23:00:00+00'),
-- Grupo F
(10, 1, 'F', 'Países Bajos',       'Japón',                '2026-06-14 20:00:00+00'),
(12, 1, 'F', 'Suecia',             'Túnez',                '2026-06-15 02:00:00+00'),
-- Grupo G
(14, 1, 'G', 'Bélgica',            'Egipto',               '2026-06-15 19:00:00+00'),
(16, 1, 'G', 'Irán',               'Nueva Zelanda',        '2026-06-16 01:00:00+00'),
-- Grupo H
(13, 1, 'H', 'España',             'Cabo Verde',           '2026-06-15 16:00:00+00'),
(15, 1, 'H', 'Arabia Saudita',     'Uruguay',              '2026-06-15 22:00:00+00'),
-- Grupo I
(17, 1, 'I', 'Francia',            'Senegal',              '2026-06-16 19:00:00+00'),
(18, 1, 'I', 'Iraq',               'Noruega',              '2026-06-16 22:00:00+00'),
-- Grupo J
(19, 1, 'J', 'Argentina',          'Argelia',              '2026-06-17 01:00:00+00'),
(20, 1, 'J', 'Austria',            'Jordania',             '2026-06-17 04:00:00+00'),
-- Grupo K
(21, 1, 'K', 'Portugal',           'Congo RD',             '2026-06-17 17:00:00+00'),
(24, 1, 'K', 'Uzbekistán',         'Colombia',             '2026-06-18 02:00:00+00'),
-- Grupo L
(22, 1, 'L', 'Inglaterra',         'Croacia',              '2026-06-17 20:00:00+00'),
(23, 1, 'L', 'Ghana',              'Panamá',               '2026-06-17 23:00:00+00'),

-- ── Jornada 2 ────────────────────────────────────────────────
-- Grupo A
(25, 2, 'A', 'República Checa',    'Sudáfrica',            '2026-06-18 16:00:00+00'),
(28, 2, 'A', 'México',             'Corea del Sur',        '2026-06-19 01:00:00+00'),
-- Grupo B
(26, 2, 'B', 'Suiza',              'Bosnia y Herzegovina', '2026-06-18 19:00:00+00'),
(27, 2, 'B', 'Canadá',             'Catar',                '2026-06-18 22:00:00+00'),
-- Grupo C
(30, 2, 'C', 'Escocia',            'Marruecos',            '2026-06-19 22:00:00+00'),
(31, 2, 'C', 'Brasil',             'Haití',                '2026-06-20 00:30:00+00'),
-- Grupo D
(29, 2, 'D', 'Estados Unidos',     'Australia',            '2026-06-19 19:00:00+00'),
(32, 2, 'D', 'Turquía',            'Paraguay',             '2026-06-20 03:00:00+00'),
-- Grupo E
(34, 2, 'E', 'Alemania',           'Costa de Marfil',      '2026-06-20 20:00:00+00'),
(35, 2, 'E', 'Ecuador',            'Curazao',              '2026-06-21 00:00:00+00'),
-- Grupo F
(33, 2, 'F', 'Países Bajos',       'Suecia',               '2026-06-20 17:00:00+00'),
(36, 2, 'F', 'Túnez',              'Japón',                '2026-06-21 04:00:00+00'),
-- Grupo G
(38, 2, 'G', 'Bélgica',            'Irán',                 '2026-06-21 19:00:00+00'),
(40, 2, 'G', 'Nueva Zelanda',      'Egipto',               '2026-06-22 01:00:00+00'),
-- Grupo H
(37, 2, 'H', 'España',             'Arabia Saudita',       '2026-06-21 16:00:00+00'),
(39, 2, 'H', 'Uruguay',            'Cabo Verde',           '2026-06-21 22:00:00+00'),
-- Grupo I
(42, 2, 'I', 'Francia',            'Iraq',                 '2026-06-22 21:00:00+00'),
(43, 2, 'I', 'Noruega',            'Senegal',              '2026-06-23 00:00:00+00'),
-- Grupo J
(41, 2, 'J', 'Argentina',          'Austria',              '2026-06-22 17:00:00+00'),
(44, 2, 'J', 'Jordania',           'Argelia',              '2026-06-23 03:00:00+00'),
-- Grupo K
(45, 2, 'K', 'Portugal',           'Uzbekistán',           '2026-06-23 17:00:00+00'),
(48, 2, 'K', 'Colombia',           'Congo RD',             '2026-06-24 02:00:00+00'),
-- Grupo L
(46, 2, 'L', 'Inglaterra',         'Ghana',                '2026-06-23 20:00:00+00'),
(47, 2, 'L', 'Panamá',             'Croacia',              '2026-06-23 23:00:00+00'),

-- ── Jornada 3 (simultaneous pairs) ───────────────────────────
-- Grupo A
(53, 3, 'A', 'República Checa',    'México',               '2026-06-25 01:00:00+00'),
(54, 3, 'A', 'Sudáfrica',          'Corea del Sur',        '2026-06-25 01:00:00+00'),
-- Grupo B
(49, 3, 'B', 'Suiza',              'Canadá',               '2026-06-24 19:00:00+00'),
(50, 3, 'B', 'Bosnia y Herzegovina','Catar',               '2026-06-24 19:00:00+00'),
-- Grupo C
(51, 3, 'C', 'Escocia',            'Brasil',               '2026-06-24 22:00:00+00'),
(52, 3, 'C', 'Marruecos',          'Haití',                '2026-06-24 22:00:00+00'),
-- Grupo D
(59, 3, 'D', 'Turquía',            'Estados Unidos',       '2026-06-26 02:00:00+00'),
(60, 3, 'D', 'Paraguay',           'Australia',            '2026-06-26 02:00:00+00'),
-- Grupo E
(55, 3, 'E', 'Curazao',            'Costa de Marfil',      '2026-06-25 20:00:00+00'),
(56, 3, 'E', 'Ecuador',            'Alemania',             '2026-06-25 20:00:00+00'),
-- Grupo F
(57, 3, 'F', 'Japón',              'Suecia',               '2026-06-25 23:00:00+00'),
(58, 3, 'F', 'Túnez',              'Países Bajos',         '2026-06-25 23:00:00+00'),
-- Grupo G
(65, 3, 'G', 'Egipto',             'Irán',                 '2026-06-27 03:00:00+00'),
(66, 3, 'G', 'Nueva Zelanda',      'Bélgica',              '2026-06-27 03:00:00+00'),
-- Grupo H
(63, 3, 'H', 'Uruguay',            'España',               '2026-06-27 00:00:00+00'),
(64, 3, 'H', 'Cabo Verde',         'Arabia Saudita',       '2026-06-27 00:00:00+00'),
-- Grupo I
(61, 3, 'I', 'Noruega',            'Francia',              '2026-06-26 19:00:00+00'),
(62, 3, 'I', 'Senegal',            'Iraq',                 '2026-06-26 19:00:00+00'),
-- Grupo J
(71, 3, 'J', 'Jordania',           'Argentina',            '2026-06-28 02:00:00+00'),
(72, 3, 'J', 'Argelia',            'Austria',              '2026-06-28 02:00:00+00'),
-- Grupo K
(69, 3, 'K', 'Congo RD',           'Uzbekistán',           '2026-06-27 23:30:00+00'),
(70, 3, 'K', 'Colombia',           'Portugal',             '2026-06-27 23:30:00+00'),
-- Grupo L
(67, 3, 'L', 'Panamá',             'Inglaterra',           '2026-06-27 21:00:00+00'),
(68, 3, 'L', 'Croacia',            'Ghana',                '2026-06-27 21:00:00+00')

on conflict (id) do nothing;
