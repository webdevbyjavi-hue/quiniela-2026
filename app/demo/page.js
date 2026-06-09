'use client'
import { useState } from 'react'
import '../../app/globals.css'

// ── Mock data ─────────────────────────────────────────────────

// Real UTC kickoff times from the schedule (formatFecha shows them in CDMX)
const MOCK_MATCHES = [
  // Open — no prediction yet   Thu 11 Jun · 1:00 PM CDMX
  {
    id: 1, jornada: 1, grupo: 'A',
    equipo_local: 'México', equipo_visita: 'Sudáfrica',
    fecha_hora: '2026-06-11T19:00:00Z',
    estado: 'pendiente', resultado: null, goles_local: null, goles_visita: null,
  },
  // Open — prediction already made   Thu 11 Jun · 8:00 PM CDMX
  {
    id: 2, jornada: 1, grupo: 'A',
    equipo_local: 'Corea del Sur', equipo_visita: 'República Checa',
    fecha_hora: '2026-06-12T02:00:00Z',
    estado: 'pendiente', resultado: null, goles_local: null, goles_visita: null,
  },
  // Open   Fri 12 Jun · 1:00 PM CDMX
  {
    id: 3, jornada: 1, grupo: 'B',
    equipo_local: 'Canadá', equipo_visita: 'Bosnia y Herzegovina',
    fecha_hora: '2026-06-12T19:00:00Z',
    estado: 'pendiente', resultado: null, goles_local: null, goles_visita: null,
  },
  // Live (demo only)   Fri 12 Jun · 7:00 PM CDMX
  {
    id: 4, jornada: 1, grupo: 'D',
    equipo_local: 'Estados Unidos', equipo_visita: 'Paraguay',
    fecha_hora: '2026-06-13T01:00:00Z',
    estado: 'en_vivo', resultado: null, goles_local: null, goles_visita: null,
  },
  // Finished — correct pick ✓   Sat 13 Jun · 4:00 PM CDMX
  {
    id: 6, jornada: 1, grupo: 'C',
    equipo_local: 'Brasil', equipo_visita: 'Marruecos',
    fecha_hora: '2026-06-13T22:00:00Z',
    estado: 'finalizado', resultado: 'L', goles_local: 2, goles_visita: 0,
  },
  // Finished — wrong pick ✗   Sat 13 Jun · 7:00 PM CDMX
  {
    id: 7, jornada: 1, grupo: 'C',
    equipo_local: 'Haití', equipo_visita: 'Escocia',
    fecha_hora: '2026-06-14T01:00:00Z',
    estado: 'finalizado', resultado: 'V', goles_local: 1, goles_visita: 3,
  },
  // Finished — no prediction made   Sun 14 Jun · 11:00 AM CDMX
  {
    id: 9, jornada: 1, grupo: 'E',
    equipo_local: 'Alemania', equipo_visita: 'Curazao',
    fecha_hora: '2026-06-14T17:00:00Z',
    estado: 'finalizado', resultado: 'L', goles_local: 4, goles_visita: 0,
  },
]

const INITIAL_PREDICTIONS = {
  2: 'V',   // Corea del Sur vs Rep Checa — picked Visita
  6: 'L',   // Brasil vs Marruecos — picked Local (correct ✓)
  7: 'E',   // Haití vs Escocia — picked Empate (wrong ✗)
}

const MOCK_LEADERBOARD = [
  { user_id: 'me',  nombre: 'Tú',            puntos: 8, aciertos: 8, partidos_jugados: 12 },
  { user_id: 'u2',  nombre: 'Ana Torres',     puntos: 10, aciertos: 10, partidos_jugados: 14 },
  { user_id: 'u3',  nombre: 'Carlos Reyes',   puntos: 9, aciertos: 9, partidos_jugados: 13 },
  { user_id: 'u4',  nombre: 'María López',    puntos: 7, aciertos: 7, partidos_jugados: 11 },
  { user_id: 'u5',  nombre: 'Pedro Martínez', puntos: 5, aciertos: 5, partidos_jugados: 10 },
  { user_id: 'u6',  nombre: 'Sofía Gómez',    puntos: 3, aciertos: 3, partidos_jugados: 8 },
]
// Sort descending by puntos
const LEADERBOARD = [...MOCK_LEADERBOARD].sort((a, b) => b.puntos - a.puntos)

// ── Helpers ───────────────────────────────────────────────────

function formatFecha(iso) {
  return new Date(iso).toLocaleString('es-MX', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Mexico_City',
  })
}

function isLocked(match) {
  return new Date() >= new Date(match.fecha_hora) || match.estado !== 'pendiente'
}

// ── Demo app ──────────────────────────────────────────────────

export default function DemoPage() {
  const [view,        setView]        = useState('app')   // 'login' | 'sent' | 'app'
  const [tab,         setTab]         = useState('pronosticos')
  const [jornada,     setJornada]     = useState(1)
  const [predictions, setPredictions] = useState(INITIAL_PREDICTIONS)

  function handlePick(matchId, pick) {
    setPredictions(p => ({ ...p, [matchId]: pick }))
  }

  if (view === 'login') return <DemoLogin onSent={() => setView('sent')} onBack={() => setView('app')} />
  if (view === 'sent')  return <DemoSent onBack={() => setView('login')} />

  const completedCount = Object.keys(predictions).length
  const pct            = Math.round((completedCount / 72) * 100)
  const myEntry        = LEADERBOARD.find(r => r.user_id === 'me')
  const myRank         = LEADERBOARD.findIndex(r => r.user_id === 'me') + 1
  const visibleMatches = MOCK_MATCHES.filter(m => m.jornada === jornada)

  return (
    <>
      {/* Demo banner */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999,
        background: '#7c3aed', color: '#fff',
        fontSize: '.7rem', fontWeight: 700, textAlign: 'center',
        padding: '.3rem',
        letterSpacing: '.04em',
      }}>
        MODO DEMO — datos ficticios · <button onClick={() => setView('login')} style={{ background: 'none', border: 'none', color: '#e9d5ff', textDecoration: 'underline', cursor: 'pointer', fontSize: '.7rem', fontWeight: 700 }}>ver login</button>
      </div>

      <div className="app-shell" style={{ paddingTop: '26px' }}>
        <header className="app-header">
          <div className="app-brand">
            <span className="app-brand-icon">⚽</span>
            <div>
              <div className="app-brand-name">QUINIELA 2026</div>
              <div className="app-brand-sub">Copa Mundial · {completedCount}/72</div>
            </div>
          </div>
          <div className="app-header-end">
            <div className="pts-pill">#{myRank} · {myEntry.puntos}pts</div>
            <button className="btn-signout" onClick={() => setView('login')}>Salir</button>
          </div>
        </header>

        <main className="app-main">
          {tab === 'pronosticos' ? (
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
                {visibleMatches.length === 0
                  ? <div className="empty-state">Sin partidos en esta jornada (demo).</div>
                  : visibleMatches.map(m => (
                    <MatchCard
                      key={m.id}
                      match={m}
                      prediction={predictions[m.id]}
                      onPick={handlePick}
                    />
                  ))
                }
              </div>
            </div>
          ) : (
            <div className="tab-scroll">
              <div className="tabla-title-row">
                <h2 className="tabla-heading">Tabla de posiciones</h2>
              </div>
              <div className="rank-list">
                {LEADERBOARD.map((row, i) => (
                  <div key={row.user_id} className={`rank-row${row.user_id === 'me' ? ' me' : ''}`}>
                    <span className="rank-pos">
                      {i < 3
                        ? ['🥇','🥈','🥉'][i]
                        : <span className="rank-num">{i + 1}</span>
                      }
                    </span>
                    <div className="rank-info">
                      <div className="rank-name">
                        {row.nombre}
                        {row.user_id === 'me' && <span className="tu-chip">tú</span>}
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
              </div>
            </div>
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
    </>
  )
}

// ── Match card (identical to real app) ───────────────────────

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
  if (finished)         cardCls += ' finished'
  else if (locked)      cardCls += ' locked'
  else if (!prediction) cardCls += ' open'

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

// ── Demo login screens ────────────────────────────────────────

function DemoLogin({ onSent, onBack }) {
  const [email,  setEmail]  = useState('')
  const [nombre, setNombre] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    onSent()
  }

  return (
    <div className="login-bg">
      <div className="login-header">
        <div className="login-badge">⚽</div>
        <h1 className="login-title">QUINIELA<br />2026</h1>
        <p className="login-sub">Copa Mundial de Fútbol</p>
      </div>
      <div className="login-card">
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="nombre">Tu nombre</label>
            <input id="nombre" type="text" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej. Juan García" required />
          </div>
          <div className="field">
            <label htmlFor="email">Correo electrónico</label>
            <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com" required inputMode="email" />
          </div>
          <button className="btn-primary" type="submit">Entrar con enlace mágico</button>
        </form>
      </div>
      <div style={{ marginTop: '1.25rem' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: '.8rem', cursor: 'pointer', textDecoration: 'underline' }}>
          ← volver al demo
        </button>
      </div>
    </div>
  )
}

function DemoSent({ onBack }) {
  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-sent-icon">📬</div>
        <h2 className="login-sent-title">Revisa tu correo</h2>
        <p className="login-sent-sub">
          Enviamos un enlace a <strong>tu@correo.com</strong>.<br />
          Da clic en el enlace para entrar — revisa spam también.
        </p>
      </div>
      <div style={{ marginTop: '1.25rem' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: '.8rem', cursor: 'pointer', textDecoration: 'underline' }}>
          ← volver al login
        </button>
      </div>
    </div>
  )
}
