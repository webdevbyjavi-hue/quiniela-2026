'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

function formatFecha(iso) {
  return new Date(iso).toLocaleString('es-MX', {
    weekday: 'short',
    day:     'numeric',
    month:   'short',
    hour:    '2-digit',
    minute:  '2-digit',
    timeZone: 'America/Mexico_City',
  })
}

function isLocked(match, globalLocked) {
  return globalLocked || new Date() >= new Date(match.fecha_hora) || match.estado !== 'pendiente'
}

// ── DEMO MODE (temporary preview, ?demo=1) ──────────────────────

const DEMO_SESSION = { user: { id: 'demo-user' } }

const DEMO_JORNADA_1 = [
  [ 1, 'A', 'México',          'Sudáfrica',            '2026-06-11 19:00:00+00'],
  [ 2, 'A', 'Corea del Sur',   'República Checa',      '2026-06-12 02:00:00+00'],
  [ 3, 'B', 'Canadá',          'Bosnia y Herzegovina', '2026-06-12 19:00:00+00'],
  [ 5, 'B', 'Catar',           'Suiza',                '2026-06-13 19:00:00+00'],
  [ 6, 'C', 'Brasil',          'Marruecos',            '2026-06-13 22:00:00+00'],
  [ 7, 'C', 'Haití',           'Escocia',              '2026-06-14 01:00:00+00'],
  [ 4, 'D', 'Estados Unidos',  'Paraguay',             '2026-06-13 01:00:00+00'],
  [ 8, 'D', 'Australia',       'Turquía',              '2026-06-14 04:00:00+00'],
  [ 9, 'E', 'Alemania',        'Curazao',              '2026-06-14 17:00:00+00'],
  [11, 'E', 'Costa de Marfil', 'Ecuador',              '2026-06-14 23:00:00+00'],
  [10, 'F', 'Países Bajos',    'Japón',                '2026-06-14 20:00:00+00'],
  [12, 'F', 'Suecia',          'Túnez',                '2026-06-15 02:00:00+00'],
  [14, 'G', 'Bélgica',         'Egipto',               '2026-06-15 19:00:00+00'],
  [16, 'G', 'Irán',            'Nueva Zelanda',        '2026-06-16 01:00:00+00'],
  [13, 'H', 'España',          'Cabo Verde',           '2026-06-15 16:00:00+00'],
  [15, 'H', 'Arabia Saudita',  'Uruguay',              '2026-06-15 22:00:00+00'],
  [17, 'I', 'Francia',         'Senegal',              '2026-06-16 19:00:00+00'],
  [18, 'I', 'Iraq',            'Noruega',              '2026-06-16 22:00:00+00'],
  [19, 'J', 'Argentina',       'Argelia',              '2026-06-17 01:00:00+00'],
  [20, 'J', 'Austria',         'Jordania',             '2026-06-17 04:00:00+00'],
  [21, 'K', 'Portugal',        'Congo RD',             '2026-06-17 17:00:00+00'],
  [24, 'K', 'Uzbekistán',      'Colombia',             '2026-06-18 02:00:00+00'],
  [22, 'L', 'Inglaterra',      'Croacia',              '2026-06-17 20:00:00+00'],
  [23, 'L', 'Ghana',           'Panamá',               '2026-06-17 23:00:00+00'],
].map(([id, grupo, local, visita, fecha]) => ({
  id, jornada: 1, grupo,
  equipo_local: local, equipo_visita: visita, fecha_hora: fecha,
  goles_local: null, goles_visita: null, resultado: null, estado: 'pendiente',
}))

// Match 1: finished, user predicted correctly → "✓ +1"
Object.assign(DEMO_JORNADA_1[0], { goles_local: 2, goles_visita: 1, resultado: 'L', estado: 'finalizado' })
// Match 2: finished, user predicted incorrectly
Object.assign(DEMO_JORNADA_1[1], { goles_local: 1, goles_visita: 1, resultado: 'E', estado: 'finalizado' })
// Match 3: in progress
Object.assign(DEMO_JORNADA_1[2], { estado: 'en_vivo' })

const DEMO_DATA = {
  matches: DEMO_JORNADA_1,
  predictions: { 1: 'L', 2: 'V', 3: 'E', 5: 'L', 6: 'V', 7: 'E' },
  lockAt: new Date('2026-06-11T17:00:00Z'),
  leaderboard: [
    { user_id: 'demo-carlos', nombre: 'Carlos Méndez', partidos_jugados: 9, aciertos: 2, puntos: 2 },
    { user_id: 'demo-user',   nombre: 'Tú',            partidos_jugados: 6, aciertos: 1, puntos: 1 },
    { user_id: 'demo-beto',   nombre: 'Beto Ramírez',  partidos_jugados: 7, aciertos: 1, puntos: 1 },
    { user_id: 'demo-ana',    nombre: 'Ana García',    partidos_jugados: 5, aciertos: 0, puntos: 0 },
    { user_id: 'demo-diana',  nombre: 'Diana López',   partidos_jugados: 4, aciertos: 0, puntos: 0 },
  ],
}

// ── Root ──────────────────────────────────────────────────────

export default function Home() {
  const [session,     setSession]     = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  const isDemo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1'

  useEffect(() => {
    if (isDemo) { setAuthLoading(false); return }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_ev, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [isDemo])

  if (isDemo) return <AppPage session={DEMO_SESSION} demoData={DEMO_DATA} />
  if (authLoading) return <Splash />
  if (!session)    return <LoginPage />
  return <AppPage session={session} />
}

// ── Splash ────────────────────────────────────────────────────

function Splash() {
  return (
    <div className="splash">
      <div className="splash-content">
        <span className="splash-ball">⚽</span>
        <div className="splash-title">QUINIELA 2026</div>
      </div>
    </div>
  )
}

// ── Login ─────────────────────────────────────────────────────

function LoginPage() {
  const [mode,     setMode]     = useState('login') // 'login' | 'register'
  const [nombre,   setNombre]   = useState('')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [sent,     setSent]     = useState(false)

  function switchMode(m) {
    setMode(m)
    setError(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (mode === 'register') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { nombre: nombre.trim() || email.split('@')[0] } },
      })
      if (error) { setError(error.message); setLoading(false) }
      else        setSent(true)
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { setError(error.message); setLoading(false) }
    }
  }

  if (sent) {
    return (
      <div className="login-bg">
        <div className="login-card">
          <div className="login-sent-icon">📬</div>
          <h2 className="login-sent-title">Confirma tu correo</h2>
          <p className="login-sent-sub">
            Enviamos un enlace de confirmación a <strong>{email}</strong>.<br />
            Da clic en el enlace para activar tu cuenta — revisa spam también.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="login-bg">
      <div className="login-header">
        <div className="login-badge">⚽</div>
        <h1 className="login-title">QUINIELA<br />2026</h1>
        <p className="login-sub">Copa Mundial de Fútbol</p>
      </div>
      <div className="login-card">
        <div className="login-mode-tabs">
          <button
            type="button"
            className={`login-mode-tab${mode === 'login' ? ' active' : ''}`}
            onClick={() => switchMode('login')}
          >
            Entrar
          </button>
          <button
            type="button"
            className={`login-mode-tab${mode === 'register' ? ' active' : ''}`}
            onClick={() => switchMode('register')}
          >
            Crear cuenta
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="field">
              <label htmlFor="nombre">Tu nombre</label>
              <input
                id="nombre"
                type="text"
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                placeholder="Ej. Juan García"
                required
                autoComplete="name"
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Correo electrónico</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              required
              autoComplete="email"
              inputMode="email"
            />
          </div>
          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'Mínimo 6 caracteres' : ''}
              required
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              minLength={mode === 'register' ? 6 : undefined}
            />
          </div>
          {error && <p className="field-error">{error}</p>}
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading
              ? (mode === 'register' ? 'Creando cuenta…' : 'Entrando…')
              : (mode === 'register' ? 'Crear cuenta' : 'Entrar')
            }
          </button>
        </form>
      </div>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────

function AppPage({ session, demoData }) {
  const userId = session.user.id

  const [tab,         setTab]         = useState('pronosticos')
  const [jornada,     setJornada]     = useState(1)
  const [matches,     setMatches]     = useState(demoData?.matches ?? [])
  const [predictions, setPredictions] = useState(demoData?.predictions ?? {})
  const [leaderboard, setLeaderboard] = useState(demoData?.leaderboard ?? [])
  const [lockAt,      setLockAt]      = useState(demoData?.lockAt ?? null)
  const [dataReady,   setDataReady]   = useState(!!demoData)

  const loadLeaderboard = useCallback(async () => {
    const { data } = await supabase.from('leaderboard').select('*')
    if (data) setLeaderboard(data)
  }, [])

  const loadAll = useCallback(async () => {
    const [{ data: mData }, { data: pData }, { data: cData }] = await Promise.all([
      supabase.from('matches').select('*').order('fecha_hora'),
      supabase.from('predictions').select('match_id, prediccion').eq('user_id', userId),
      supabase.from('app_config').select('value').eq('key', 'predictions_lock_at').maybeSingle(),
    ])
    if (mData) setMatches(mData)
    if (pData) {
      const map = {}
      pData.forEach(p => { map[p.match_id] = p.prediccion })
      setPredictions(map)
    }
    if (cData) setLockAt(new Date(cData.value))
    await loadLeaderboard()
    setDataReady(true)
  }, [userId, loadLeaderboard])

  useEffect(() => {
    if (demoData) return
    loadAll()
    const ch = supabase
      .channel('match-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches' },
        payload => {
          setMatches(prev => prev.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m))
          loadLeaderboard()
        }
      )
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [loadAll, loadLeaderboard, demoData])

  async function handlePick(matchId, pick) {
    const prev = predictions[matchId]
    setPredictions(p => ({ ...p, [matchId]: pick }))
    if (demoData) return
    const { error } = await supabase
      .from('predictions')
      .upsert(
        { user_id: userId, match_id: matchId, prediccion: pick, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,match_id' }
      )
    if (error) {
      setPredictions(p => ({ ...p, [matchId]: prev }))
      alert('No se pudo guardar tu pronóstico: ' + error.message)
    }
  }

  if (!dataReady) return <Splash />

  const globalLocked   = lockAt ? new Date() >= lockAt : false
  const completedCount = Object.keys(predictions).length
  const myEntry        = leaderboard.find(r => r.user_id === userId)
  const myPoints       = myEntry?.puntos ?? 0
  const myRank         = myEntry ? leaderboard.findIndex(r => r.user_id === userId) + 1 : null
  const visibleMatches = matches.filter(m => m.jornada === jornada)

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <span className="app-brand-icon">⚽</span>
          <div>
            <div className="app-brand-name">QUINIELA 2026</div>
            <div className="app-brand-sub">Copa Mundial · {completedCount}/72</div>
          </div>
        </div>
        <div className="app-header-end">
          {myRank && (
            <div className="pts-pill">#{myRank} · {myPoints}pts</div>
          )}
          <button className="btn-signout" onClick={() => supabase.auth.signOut()}>
            Salir
          </button>
        </div>
      </header>

      <main className="app-main">
        {tab === 'pronosticos' ? (
          <PronosticosTab
            matches={visibleMatches}
            predictions={predictions}
            jornada={jornada}
            setJornada={setJornada}
            completedCount={completedCount}
            globalLocked={globalLocked}
            onPick={handlePick}
          />
        ) : (
          <TablaTab leaderboard={leaderboard} userId={userId} />
        )}
      </main>

      <nav className="bottom-nav">
        <button
          className={`nav-btn${tab === 'pronosticos' ? ' active' : ''}`}
          onClick={() => setTab('pronosticos')}
        >
          <span className="nav-icon">📋</span>
          <span className="nav-label">Pronósticos</span>
        </button>
        <button
          className={`nav-btn${tab === 'tabla' ? ' active' : ''}`}
          onClick={() => setTab('tabla')}
        >
          <span className="nav-icon">🏆</span>
          <span className="nav-label">Tabla</span>
        </button>
      </nav>
    </div>
  )
}

// ── Pronósticos tab ───────────────────────────────────────────

function PronosticosTab({ matches, predictions, jornada, setJornada, completedCount, globalLocked, onPick }) {
  const pct = Math.round((completedCount / 72) * 100)

  return (
    <div className="tab-scroll">
      {globalLocked && (
        <div className="lock-banner">
          <span>🔒</span>
          <span>Las predicciones están cerradas</span>
        </div>
      )}

      <div className="progress-bar-wrap">
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-label">
        <span>{completedCount} pronósticos ingresados</span>
        <span>{72 - completedCount} restantes</span>
      </div>

      <div className="jornada-tabs">
        {[1, 2, 3].map(j => (
          <button
            key={j}
            className={`jornada-tab${jornada === j ? ' active' : ''}`}
            onClick={() => setJornada(j)}
          >
            Jornada {j}
          </button>
        ))}
      </div>

      <div className="cards-list">
        {matches.map(m => (
          <MatchCard
            key={m.id}
            match={m}
            prediction={predictions[m.id]}
            globalLocked={globalLocked}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  )
}

// ── Match card ────────────────────────────────────────────────

function MatchCard({ match, prediction, globalLocked, onPick }) {
  const locked   = isLocked(match, globalLocked)
  const finished = match.estado === 'finalizado'
  const live     = match.estado === 'en_vivo'

  const picks = [
    { key: 'L', label: 'Local',  team: match.equipo_local },
    { key: 'E', label: 'Empate', team: 'X' },
    { key: 'V', label: 'Visita', team: match.equipo_visita },
  ]

  let cardCls = 'match-card'
  if (finished)              cardCls += ' finished'
  else if (locked)           cardCls += ' locked'
  else if (!prediction)      cardCls += ' open'

  return (
    <div className={cardCls}>
      <div className="card-meta-row">
        <span className="grp-badge">GRP {match.grupo}</span>
        {live     && <span className="status-live">● EN VIVO</span>}
        {finished && <span className="status-done">Final</span>}
        {locked && !finished && !live && <span className="status-lock">🔒</span>}
        <span className="card-time">{formatFecha(match.fecha_hora)}</span>
      </div>

      {finished ? (
        <div className="teams-score-row">
          <span className="team-txt">{match.equipo_local}</span>
          <span className="score-txt">{match.goles_local} – {match.goles_visita}</span>
          <span className="team-txt">{match.equipo_visita}</span>
        </div>
      ) : (
        <div className="teams-vs-row">
          <span className="team-txt">{match.equipo_local}</span>
          <span className="vs-txt">VS</span>
          <span className="team-txt">{match.equipo_visita}</span>
        </div>
      )}

      <div className="card-divider" />

      <div className="picks-grid">
        {picks.map(({ key, label, team }) => {
          const isSelected = prediction === key
          const isActual   = finished && match.resultado === key
          const isCorrect  = isSelected && isActual
          const isWrong    = isSelected && finished && !isCorrect

          let cls = 'pick-btn'
          if      (isCorrect)  cls += ' correct'
          else if (isWrong)    cls += ' wrong'
          else if (isSelected) cls += ' sel'
          if (isActual && !isCorrect) cls += ' actual'

          return (
            <button
              key={key}
              className={cls}
              disabled={locked}
              onClick={() => !locked && onPick(match.id, key)}
            >
              <span className="pick-type-lbl">{label}</span>
              <span className="pick-team-lbl">{team}</span>
              {isCorrect && <span className="pick-correct-badge">✓ +1</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Tabla tab ─────────────────────────────────────────────────

function TablaTab({ leaderboard, userId }) {
  const medals = ['🥇', '🥈', '🥉']

  return (
    <div className="tab-scroll">
      <div className="tabla-title-row">
        <h2 className="tabla-heading">Tabla de posiciones</h2>
      </div>

      <div className="rank-list">
        {leaderboard.map((row, i) => (
          <div key={row.user_id} className={`rank-row${row.user_id === userId ? ' me' : ''}`}>
            <span className="rank-pos">
              {i < 3
                ? medals[i]
                : <span className="rank-num">{i + 1}</span>
              }
            </span>
            <div className="rank-info">
              <div className="rank-name">
                {row.nombre}
                {row.user_id === userId && <span className="tu-chip">tú</span>}
              </div>
              <div className="rank-detail">
                {row.aciertos} aciertos · {row.partidos_jugados} jugados
              </div>
            </div>
            <div className="rank-pts-wrap">
              <span className="rank-pts">{row.puntos}</span>
              <span className="rank-pts-lbl">pts</span>
            </div>
          </div>
        ))}
        {leaderboard.length === 0 && (
          <div className="empty-state">Aún no hay resultados.</div>
        )}
      </div>
    </div>
  )
}
