export default function GlassCard({ children, className = '', hover = false, glow = '', onClick }) {
  return (
    <div
      onClick={onClick}
      className={`
        glass
        ${hover ? 'glass-hover transition-all duration-300 cursor-pointer' : ''}
        ${glow === 'violet' ? 'glow-violet' : ''}
        ${glow === 'cyan' ? 'glow-cyan' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  )
}
