/**
 * Lightweight confetti-like animation using CSS only.
 * Creates particle bursts in a container and auto-cleans up.
 */
export function launchConfetti(container = document.body) {
  const colors = ['#147A8A', '#2DC4B2', '#F59E0B', '#10B981', '#EF4444', '#4DD9C8', '#7EEEE4']
  const particles = []
  const count = 80

  for (let i = 0; i < count; i++) {
    const el = document.createElement('div')
    const color = colors[Math.floor(Math.random() * colors.length)]
    const size = Math.random() * 8 + 4
    const x = Math.random() * window.innerWidth
    const y = -20
    const drift = (Math.random() - 0.5) * 300
    const duration = Math.random() * 2 + 2

    Object.assign(el.style, {
      position: 'fixed',
      left: `${x}px`,
      top: `${y}px`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: Math.random() > 0.5 ? '50%' : '2px',
      background: color,
      zIndex: '99999',
      pointerEvents: 'none',
      opacity: '1',
      animation: `confettiFall ${duration}s ease-out forwards`,
      transform: `rotate(${Math.random() * 360}deg)`,
    })

    // Custom CSS vars for drift
    el.style.setProperty('--drift', `${drift}px`)
    el.style.setProperty('--spin', `${Math.random() * 720 - 360}deg`)

    container.appendChild(el)
    particles.push(el)
  }

  // Inject keyframes if not already injected
  if (!document.getElementById('confetti-keyframes')) {
    const style = document.createElement('style')
    style.id = 'confetti-keyframes'
    style.textContent = `
      @keyframes confettiFall {
        0% {
          transform: translateY(0) translateX(0) rotate(0deg);
          opacity: 1;
        }
        100% {
          transform: translateY(${window.innerHeight + 50}px) translateX(var(--drift)) rotate(var(--spin));
          opacity: 0;
        }
      }
    `
    document.head.appendChild(style)
  }

  // Cleanup
  setTimeout(() => {
    particles.forEach(p => p.remove())
  }, 4500)
}
