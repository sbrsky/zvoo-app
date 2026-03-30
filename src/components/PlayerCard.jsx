export default function PlayerCard({ player, isHost, isOnline = false, isCurrentUser = false }) {
  const accentColor = isHost ? '#7C3AED' : '#06B6D4'
  const accentLight = isHost ? '#A78BFA' : '#67E8F9'

  if (!player) {
    return (
      <div style={{
        padding: '28px 20px',
        borderRadius: '20px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px dashed rgba(255,255,255,0.12)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
        opacity: 0.6,
      }}>
        <div style={{
          width: '56px', height: '56px', borderRadius: '50%',
          border: '2px dashed rgba(255,255,255,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '20px', color: 'rgba(255,255,255,0.25)',
        }}>+</div>
        <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
          {isHost ? 'Место хоста' : 'Ожидание гостя...'}
        </span>
        <div style={{
          fontSize: '11px', fontWeight: 600, padding: '3px 12px', borderRadius: '100px',
          background: `rgba(${isHost ? '124,58,237' : '6,182,212'},0.12)`,
          color: accentLight,
        }}>
          {isHost ? '👑 Хост' : '🎮 Гость'}
        </div>
      </div>
    )
  }

  return (
    <div style={{
      padding: '24px 20px',
      borderRadius: '20px',
      background: isCurrentUser
        ? `linear-gradient(135deg, rgba(${isHost ? '124,58,237' : '6,182,212'},0.12), rgba(${isHost ? '6,182,212' : '124,58,237'},0.05))`
        : 'rgba(255,255,255,0.04)',
      border: `1px solid ${isCurrentUser ? `rgba(${isHost ? '124,58,237' : '6,182,212'},0.35)` : 'rgba(255,255,255,0.08)'}`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
      boxShadow: isCurrentUser ? `0 8px 32px rgba(${isHost ? '124,58,237' : '6,182,212'},0.15)` : 'none',
      position: 'relative',
    }}>
      {/* YOU badge */}
      {isCurrentUser && (
        <div style={{
          position: 'absolute', top: '-10px', left: '50%', transform: 'translateX(-50%)',
          fontSize: '10px', fontWeight: 800, padding: '2px 10px', borderRadius: '100px',
          background: `linear-gradient(135deg, ${accentColor}, ${isHost ? '#06B6D4' : '#7C3AED'})`,
          color: 'white', letterSpacing: '0.08em', whiteSpace: 'nowrap',
        }}>ВЫ</div>
      )}

      {/* Avatar */}
      <div style={{ position: 'relative' }}>
        <div style={{
          width: '60px', height: '60px', borderRadius: '50%',
          background: `linear-gradient(135deg, ${accentColor}, ${isHost ? '#06B6D4' : '#7C3AED'})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '22px', fontWeight: 800, color: 'white', overflow: 'hidden',
          boxShadow: `0 6px 20px rgba(${isHost ? '124,58,237' : '6,182,212'},0.3)`,
        }}>
          {player.avatar_url
            ? <img src={player.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : (player.username?.[0]?.toUpperCase() || '?')}
        </div>
        {isOnline && (
          <div style={{
            position: 'absolute', bottom: '1px', right: '1px',
            width: '14px', height: '14px', borderRadius: '50%',
            background: '#10B981', border: '2px solid #0A0A1A',
            boxShadow: '0 0 8px rgba(16,185,129,0.5)',
          }} />
        )}
      </div>

      {/* Name + role */}
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontWeight: 700, color: 'white', fontSize: '15px', margin: '0 0 6px' }}>
          {player.username || 'Player'}
        </p>
        <span style={{
          fontSize: '11px', fontWeight: 700, padding: '3px 12px', borderRadius: '100px',
          background: `rgba(${isHost ? '124,58,237' : '6,182,212'},0.15)`,
          color: accentLight,
        }}>
          {isHost ? '👑 Хост' : '🎮 Гость'}
        </span>
      </div>

      {/* Stats */}
      <div style={{
        display: 'flex', gap: '12px', fontSize: '12px',
        color: 'rgba(255,255,255,0.4)', paddingTop: '8px',
        borderTop: '1px solid rgba(255,255,255,0.07)', width: '100%', justifyContent: 'center',
      }}>
        <span title="Игры">🎮 {player.games_played || 0}</span>
        <span title="Победы">🏆 {player.games_won || 0}</span>
        <span title="Средний балл">⭐ {player.avg_score?.toFixed(0) || 0}</span>
      </div>
    </div>
  )
}
