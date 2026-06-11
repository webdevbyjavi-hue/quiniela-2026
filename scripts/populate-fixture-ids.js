#!/usr/bin/env node
/**
 * Quiniela 2026 — Populate matches.api_fixture_id
 *
 * One-time script: fetches the FIFA World Cup 2026 group-stage fixtures
 * from football-data.org (single request) and matches them against the
 * 72 rows in public.matches by translated team name + kickoff time, then
 * writes matches.api_fixture_id.
 *
 * Usage:
 *   node --env-file=.env.local scripts/populate-fixture-ids.js          # dry run (no writes)
 *   node --env-file=.env.local scripts/populate-fixture-ids.js --apply  # writes to Supabase
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FOOTBALL_DATA_API_KEY
 */

'use strict'

const { createClient } = require('@supabase/supabase-js')

// football-data.org English name -> our Spanish name (matches.equipo_local/equipo_visita)
const TEAM_NAME_ES = {
  'Mexico':                'México',
  'South Africa':          'Sudáfrica',
  'South Korea':           'Corea del Sur',
  'Czechia':               'República Checa',
  'Canada':                'Canadá',
  'Bosnia-Herzegovina':    'Bosnia y Herzegovina',
  'Qatar':                 'Catar',
  'Switzerland':           'Suiza',
  'Brazil':                'Brasil',
  'Morocco':               'Marruecos',
  'Haiti':                 'Haití',
  'Scotland':              'Escocia',
  'United States':         'Estados Unidos',
  'Paraguay':              'Paraguay',
  'Australia':             'Australia',
  'Turkey':                'Turquía',
  'Germany':               'Alemania',
  'Curaçao':               'Curazao',
  'Ivory Coast':           'Costa de Marfil',
  'Ecuador':               'Ecuador',
  'Netherlands':           'Países Bajos',
  'Japan':                 'Japón',
  'Sweden':                'Suecia',
  'Tunisia':               'Túnez',
  'Belgium':               'Bélgica',
  'Egypt':                 'Egipto',
  'Iran':                  'Irán',
  'New Zealand':           'Nueva Zelanda',
  'Spain':                 'España',
  'Cape Verde Islands':    'Cabo Verde',
  'Saudi Arabia':          'Arabia Saudita',
  'Uruguay':               'Uruguay',
  'France':                'Francia',
  'Senegal':               'Senegal',
  'Iraq':                  'Iraq',
  'Norway':                'Noruega',
  'Argentina':             'Argentina',
  'Algeria':               'Argelia',
  'Austria':               'Austria',
  'Jordan':                'Jordania',
  'Portugal':              'Portugal',
  'Congo DR':              'Congo RD',
  'Uzbekistan':            'Uzbekistán',
  'Colombia':              'Colombia',
  'England':               'Inglaterra',
  'Croatia':               'Croacia',
  'Ghana':                 'Ghana',
  'Panama':                'Panamá',
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

async function main() {
  const apply = process.argv.includes('--apply')

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.FOOTBALL_DATA_API_KEY) {
    console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or FOOTBALL_DATA_API_KEY')
    process.exit(1)
  }

  // 1. Fetch group-stage fixtures (single request)
  const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches?stage=GROUP_STAGE', {
    headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY },
  })
  if (!res.ok) {
    console.error(`football-data.org error: HTTP ${res.status}`)
    process.exit(1)
  }
  const { matches: apiMatches } = await res.json()
  console.log(`Fetched ${apiMatches.length} group-stage fixtures from football-data.org`)

  // Build lookup: "EquipoLocal|EquipoVisita|isoKickoff" -> api fixture id
  const apiLookup = new Map()
  for (const m of apiMatches) {
    const home = TEAM_NAME_ES[m.homeTeam.name]
    const away = TEAM_NAME_ES[m.awayTeam.name]
    if (!home || !away) {
      console.warn(`  ! No translation for "${m.homeTeam.name}" or "${m.awayTeam.name}" — skipping fixture ${m.id}`)
      continue
    }
    const key = `${home}|${away}|${new Date(m.utcDate).toISOString()}`
    apiLookup.set(key, m.id)
  }

  // 2. Fetch local matches
  const { data: localMatches, error } = await supabase
    .from('matches')
    .select('id, equipo_local, equipo_visita, fecha_hora, api_fixture_id')
    .order('id')

  if (error) {
    console.error('Failed to fetch matches from Supabase:', error.message)
    process.exit(1)
  }

  // 3. Match and report
  const updates = []
  const unmatched = []

  for (const m of localMatches) {
    const key = `${m.equipo_local}|${m.equipo_visita}|${new Date(m.fecha_hora).toISOString()}`
    const fixtureId = apiLookup.get(key)
    if (fixtureId == null) {
      unmatched.push(m)
      continue
    }
    if (m.api_fixture_id !== fixtureId) {
      updates.push({ id: m.id, fixtureId, label: `${m.equipo_local} vs ${m.equipo_visita}` })
    }
  }

  console.log(`\nMatched: ${updates.length + (localMatches.length - unmatched.length - updates.length)}/${localMatches.length}`)
  console.log(`To update: ${updates.length}`)
  for (const u of updates) {
    console.log(`  #${u.id} ${u.label} -> api_fixture_id=${u.fixtureId}`)
  }

  if (unmatched.length > 0) {
    console.log(`\nUnmatched (${unmatched.length}) — needs manual review:`)
    for (const m of unmatched) {
      console.log(`  #${m.id} ${m.equipo_local} vs ${m.equipo_visita} @ ${m.fecha_hora}`)
    }
  }

  if (!apply) {
    console.log('\nDry run — no changes written. Re-run with --apply to write to Supabase.')
    return
  }

  if (updates.length === 0) {
    console.log('\nNothing to write.')
    return
  }

  console.log('\nApplying updates...')
  for (const u of updates) {
    const { error: updErr } = await supabase
      .from('matches')
      .update({ api_fixture_id: u.fixtureId })
      .eq('id', u.id)
    if (updErr) {
      console.error(`  ! Failed to update #${u.id}:`, updErr.message)
    } else {
      console.log(`  ✓ #${u.id} -> ${u.fixtureId}`)
    }
  }
  console.log('Done.')
}

main().catch(err => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
