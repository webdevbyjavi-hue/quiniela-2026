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

function isLocked(match) {
  return new Date() >= new Date(match.fecha_hora) || match.estado !== 'pendiente'
}

// ── Root ──────────────────────────────────────────────────────

export default function Home() {
  const [session,     setSession]     = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_ev, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

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

function AppPage({ session }) {
  const userId = session.user.id

  const [tab,         setTab]         = useState('pronosticos')
  const [jornada,     setJornada]     = useState(1)
  const [matches,     setMatches]     = useState([])
  const [predictions, setPredictions] = useState({})
  const [leaderboard, setLeaderboard] = useState([])
  const [dataReady,   setDataReady]   = useState(false)

  const loadLeaderboard = useCallback(async () => {
    const { data } = await supabase.from('leaderboard').select('*')
    if (data) setLeaderboard(data)
  }, [])

  const loadAll = useCallback(async () => {
    const [{ data: mData }, { data: pData }] = await Promise.all([
      supabase.from('matches').select('*').order('fecha_hora'),
      supabase.from('predictions').select('match_id, prediccion').eq('user_id', userId),
    ])
    if (mData) setMatches(mData)
    if (pData) {
      const map = {}
      pData.forEach(p => { map[p.match_id] = p.prediccion })
      setPredictions(map)
    }
    await loadLeaderboard()
    setDataReady(true)
  }, [userId, loadLeaderboard])

  useEffect(() => {
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
  }, [loadAll, loadLeaderboard])

  async function handlePick(matchId, pick) {
    const prev = predictions[matchId]
    setPredictions(p => ({ ...p, [matchId]: pick }))
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

function PronosticosTab({ matches, predictions, jornada, setJornada, completedCount, onPick }) {
  const pct = Math.round((completedCount / 72) * 100)

  return (
    <div className="tab-scroll">
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
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  )
}

// ── Match card ────────────────────────────────────────────────

function MatchCard({ match, prediction, onPick }) {
  const locked   = isLocked(match)
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

          let cls = 'pick-btn'
          if (isSelected) cls += ' sel'
          if (isActual)   cls += ' actual'
          if (isCorrect)  cls += ' correct'

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
