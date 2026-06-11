#!/usr/bin/env node
/**
 * Quiniela 2026 — Result updater cron
 *
 * Runs on a schedule (GitHub Actions, e.g. every 5 min).
 *
 * Smart polling strategy:
 *   1. Ask Supabase which matches are still pending, have an
 *      api_fixture_id, and whose kickoff has already passed.
 *   2. If there are none, exit immediately — zero API requests.
 *   3. Otherwise make ONE bulk request covering the date range of those
 *      matches (instead of one request per match), respecting the
 *      football-data.org free tier limit of 10 req/min.
 *   4. FINISHED matches -> set_match_result(). IN_PLAY/PAUSED matches ->
 *      mark estado='en_vivo' (no extra requests, same response).
 *
 * Required env vars (set as GitHub repo secrets):
 *   SUPABASE_URL               — your project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — service role key (never expose client-side)
 *   PROVIDER                   — 'football-data' (default) | 'api-football'
 *   FOOTBALL_DATA_API_KEY      — X-Auth-Token for football-data.org
 *   API_FOOTBALL_KEY           — X-RapidAPI-Key for api-football (RapidAPI)
 *
 * NOTE: api_fixture_id must be populated in the matches table before this
 * cron can resolve results. See scripts/populate-fixture-ids.js.
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
// Each provider must return a Map<api_fixture_id, { status: 'FINISHED'|'LIVE'|'OTHER', homeScore, awayScore }>

const providers = {
  /**
   * football-data.org free tier
   * Docs: https://www.football-data.org/documentation/quickstart
   * Rate limit: 10 req/min (free). One request covers the whole date range.
   */
  'football-data': {
    async getResults(pending) {
      const { dateFrom, dateTo } = dateRange(pending)
      const res = await fetchWithBackoff(
        `https://api.football-data.org/v4/competitions/WC/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
        { headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY } }
      )
      if (!res) return new Map()

      const map = new Map()
      for (const m of res.matches || []) {
        map.set(m.id, {
          status:    classifyStatus('football-data', m.status),
          homeScore: m.score?.fullTime?.home,
          awayScore: m.score?.fullTime?.away,
        })
      }
      return map
    },
  },

  /**
   * API-Football (via RapidAPI) — swap PROVIDER=api-football to use
   * Docs: https://www.api-football.com/documentation-v3
   * Bulk lookup: /fixtures?ids=1-2-3 (up to 20 IDs per request)
   */
  'api-football': {
    async getResults(pending) {
      const map = new Map()
      const ids = pending.map(m => m.api_fixture_id)

      for (let i = 0; i < ids.length; i += 20) {
        const chunk = ids.slice(i, i + 20)
        const res = await fetchWithBackoff(
          `https://v3.football.api-sports.io/fixtures?ids=${chunk.join('-')}`,
          {
            headers: {
              'X-RapidAPI-Key':  process.env.API_FOOTBALL_KEY,
              'X-RapidAPI-Host': 'v3.football.api-sports.io',
            },
          }
        )
        if (!res) continue

        for (const fixture of res.response || []) {
          const id = fixture?.fixture?.id
          if (id == null) continue
          map.set(id, {
            status:    classifyStatus('api-football', fixture?.fixture?.status?.short),
            homeScore: fixture?.goals?.home,
            awayScore: fixture?.goals?.away,
          })
        }

        if (i + 20 < ids.length) await sleep(1000)
      }
      return map
    },
  },
}

// ── Status classification ────────────────────────────────────

function classifyStatus(provider, rawStatus) {
  if (provider === 'football-data') {
    if (rawStatus === 'FINISHED') return 'FINISHED'
    if (rawStatus === 'IN_PLAY' || rawStatus === 'PAUSED') return 'LIVE'
    if (rawStatus === 'SCHEDULED' || rawStatus === 'TIMED') return 'NOT_STARTED'
    return 'OTHER'
  }
  // api-football short codes
  if (['FT', 'AET', 'PEN'].includes(rawStatus)) return 'FINISHED'
  if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'].includes(rawStatus)) return 'LIVE'
  if (['NS', 'TBD'].includes(rawStatus)) return 'NOT_STARTED'
  return 'OTHER'
}

// ── Date range helper ────────────────────────────────────────
// Covers the kickoff dates of all pending matches, with a 1-day buffer on
// each side to avoid UTC date-boundary edge cases.

function dateRange(pending) {
  const dates = pending.map(m => new Date(m.fecha_hora).toISOString().slice(0, 10))
  const min = dates.reduce((a, b) => (a < b ? a : b))
  const max = dates.reduce((a, b) => (a > b ? a : b))
  return { dateFrom: addDays(min, -1), dateTo: addDays(max, 1) }
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
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

  // Matches that are not yet finalizado AND have a fixture ID AND kickoff has passed
  const now = new Date().toISOString()
  const { data: pending, error: fetchErr } = await supabase
    .from('matches')
    .select('id, equipo_local, equipo_visita, api_fixture_id, fecha_hora, estado')
    .neq('estado', 'finalizado')
    .not('api_fixture_id', 'is', null)
    .lt('fecha_hora', now)

  if (fetchErr) {
    log('error', 'Failed to fetch matches from Supabase:', fetchErr.message)
    process.exit(1)
  }

  if (!pending || pending.length === 0) {
    log('info', 'No pending matches — skipping API call.')
    return
  }

  log('info', `Checking ${pending.length} match(es) with a single bulk request…`)
  const results = await providers[provider].getResults(pending)

  for (const match of pending) {
    const result = results.get(match.api_fixture_id)
    if (!result) {
      log('warn', `  → No data for match #${match.id} (fixture ${match.api_fixture_id})`)
      continue
    }

    if (result.status === 'FINISHED') {
      if (result.homeScore == null || result.awayScore == null) {
        log('warn', `  → Match #${match.id} reported FINISHED but missing scores, skipping.`)
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
        log('info', `  → ✓ Match #${match.id} ${match.equipo_local} vs ${match.equipo_visita}: ${result.homeScore}–${result.awayScore}`)
      }
    } else if (result.status === 'LIVE' || result.status === 'NOT_STARTED') {
      // `pending` already filters fecha_hora < now, so a NOT_STARTED match
      // here has kicked off but the provider hasn't flipped to IN_PLAY yet
      // (observed lag of several hours on football-data's free tier).
      // Treat it as live so the UI badge isn't stuck on "pendiente".
      if (match.estado !== 'en_vivo') {
        const { error: updErr } = await supabase
          .from('matches')
          .update({ estado: 'en_vivo', updated_at: new Date().toISOString() })
          .eq('id', match.id)

        if (updErr) {
          log('error', `  → Failed to mark match #${match.id} as en_vivo:`, updErr.message)
        } else {
          log('info', `  → ● Match #${match.id} ${match.equipo_local} vs ${match.equipo_visita} is live`)
        }
      }
    } else {
      log('info', `  → Match #${match.id}: status ${result.status}, not finished yet.`)
    }
  }

  log('info', 'Done.')
}

if (require.main === module) {
  main().catch(err => {
    log('error', 'Unhandled error:', err)
    process.exit(1)
  })
}

module.exports = { providers, classifyStatus, dateRange }
