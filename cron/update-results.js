#!/usr/bin/env node
/**
 * Quiniela 2026 — Result updater cron
 *
 * Runs on a schedule (Render Cron Job, e.g. every 10 min during match windows).
 * Fetches final scores from the configured provider and calls set_match_result()
 * on Supabase for any match that just finished.
 *
 * Required env vars (set in Render environment):
 *   SUPABASE_URL               — your project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — service role key (never expose client-side)
 *   PROVIDER                   — 'football-data' (default) | 'api-football'
 *   FOOTBALL_DATA_API_KEY      — X-Auth-Token for football-data.org
 *   API_FOOTBALL_KEY           — X-RapidAPI-Key for api-football (RapidAPI)
 *
 * NOTE: api_fixture_id must be populated in the matches table before this
 * cron can resolve results. See README for population options.
 */

'use strict'

const { createClient } = require('@supabase/supabase-js')

// ── Supabase (service role — bypasses RLS) ────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

// ── Provider interface ────────────────────────────────────────
// Each provider must return: { status: 'FINISHED'|'LIVE'|'OTHER', homeScore, awayScore }

const providers = {
  /**
   * football-data.org free tier
   * Docs: https://www.football-data.org/documentation/quickstart
   * Rate limit: 10 req/min (free). Respects Retry-After on 429.
   */
  'football-data': {
    async getMatch(fixtureId) {
      const res = await fetchWithBackoff(
        `https://api.football-data.org/v4/matches/${fixtureId}`,
        {
          headers: {
            'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY,
          },
        }
      )
      if (!res) return null

      // Validate expected shape before using
      const { status, score } = res
      if (typeof status !== 'string') {
        log('warn', `football-data: unexpected shape for fixture ${fixtureId}`, res)
        return null
      }

      if (status !== 'FINISHED') return { status: 'OTHER' }

      const home = score?.fullTime?.home
      const away = score?.fullTime?.away
      if (home == null || away == null) {
        log('warn', `football-data: missing fullTime scores for fixture ${fixtureId}`)
        return null
      }

      return { status: 'FINISHED', homeScore: home, awayScore: away }
    },
  },

  /**
   * API-Football (via RapidAPI) — swap PROVIDER=api-football to use
   * Docs: https://www.api-football.com/documentation-v3
   */
  'api-football': {
    async getMatch(fixtureId) {
      const res = await fetchWithBackoff(
        `https://v3.football.api-sports.io/fixtures?id=${fixtureId}`,
        {
          headers: {
            'X-RapidAPI-Key':  process.env.API_FOOTBALL_KEY,
            'X-RapidAPI-Host': 'v3.football.api-sports.io',
          },
        }
      )
      if (!res) return null

      const fixture = res?.response?.[0]
      if (!fixture) {
        log('warn', `api-football: no fixture found for id ${fixtureId}`)
        return null
      }

      const shortStatus = fixture?.fixture?.status?.short
      if (shortStatus !== 'FT') return { status: 'OTHER' }

      const home = fixture?.goals?.home
      const away = fixture?.goals?.away
      if (home == null || away == null) {
        log('warn', `api-football: missing goals for fixture ${fixtureId}`)
        return null
      }

      return { status: 'FINISHED', homeScore: home, awayScore: away }
    },
  },
}

// ── HTTP helper with 429 backoff ─────────────────────────────

async function fetchWithBackoff(url, options, attempt = 1) {
  try {
    const response = await fetch(url, options)

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10)
      log('warn', `Rate limited — waiting ${retryAfter}s before retry`)
      await sleep(retryAfter * 1000)
      if (attempt >= 3) { log('error', 'Rate limit retry limit reached'); return null }
      return fetchWithBackoff(url, options, attempt + 1)
    }

    if (!response.ok) {
      log('error', `HTTP ${response.status} for ${url}`)
      return null
    }

    return response.json()
  } catch (err) {
    log('error', `Fetch error for ${url}: ${err.message}`)
    return null
  }
}

// ── Utilities ─────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function log(level, ...args) {
  const ts = new Date().toISOString()
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    `[${ts}] [${level.toUpperCase()}]`, ...args
  )
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  const provider = process.env.PROVIDER || 'football-data'

  if (!providers[provider]) {
    log('error', `Unknown provider "${provider}". Valid options: ${Object.keys(providers).join(', ')}`)
    process.exit(1)
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    log('error', 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  log('info', `Running with provider: ${provider}`)

  // Fetch matches that are not yet finalizado AND have a fixture ID AND kickoff has passed
  const now = new Date().toISOString()
  const { data: matches, error: fetchErr } = await supabase
    .from('matches')
    .select('id, equipo_local, equipo_visita, api_fixture_id, fecha_hora')
    .neq('estado', 'finalizado')
    .not('api_fixture_id', 'is', null)
    .lt('fecha_hora', now)  // only matches whose kickoff has already passed

  if (fetchErr) {
    log('error', 'Failed to fetch matches from Supabase:', fetchErr.message)
    process.exit(1)
  }

  if (!matches || matches.length === 0) {
    log('info', 'No pending matches to check.')
    return
  }

  log('info', `Checking ${matches.length} match(es)…`)

  for (const match of matches) {
    log('info', `  #${match.id} ${match.equipo_local} vs ${match.equipo_visita} (fixture ${match.api_fixture_id})`)

    const result = await providers[provider].getMatch(match.api_fixture_id)

    if (!result) {
      log('warn', `  → No result returned for match #${match.id}, skipping.`)
      continue
    }

    if (result.status !== 'FINISHED') {
      log('info', `  → Status: ${result.status}, not finished yet.`)
      continue
    }

    const { error: rpcErr } = await supabase.rpc('set_match_result', {
      p_match_id:     match.id,
      p_goles_local:  result.homeScore,
      p_goles_visita: result.awayScore,
    })

    if (rpcErr) {
      log('error', `  → Failed to write result for match #${match.id}:`, rpcErr.message)
    } else {
      log('info', `  → ✓ Match #${match.id}: ${result.homeScore}–${result.awayScore}`)
    }

    // Respect free-tier rate limits: 1 request every ~6s = 10 req/min
    if (matches.indexOf(match) < matches.length - 1) {
      await sleep(6500)
    }
  }

  log('info', 'Done.')
}

main().catch(err => {
  log('error', 'Unhandled error:', err)
  process.exit(1)
})
