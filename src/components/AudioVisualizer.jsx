import { useRef, useEffect } from 'react'

export default function AudioVisualizer({ analyserData, isActive = false, color = 'violet', height = 120 }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1

    canvas.width = canvas.offsetWidth * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    const w = canvas.offsetWidth
    const h = height

    ctx.clearRect(0, 0, w, h)

    if (!analyserData || analyserData.length === 0) {
      drawIdleWave(ctx, w, h, color)
      return
    }

    const gradient = ctx.createLinearGradient(0, 0, w, 0)
    if (color === 'violet') {
      gradient.addColorStop(0, '#7C3AED')
      gradient.addColorStop(0.5, '#A78BFA')
      gradient.addColorStop(1, '#06B6D4')
    } else {
      gradient.addColorStop(0, '#06B6D4')
      gradient.addColorStop(0.5, '#67E8F9')
      gradient.addColorStop(1, '#7C3AED')
    }

    // Draw bars
    const barCount = 64
    const barWidth = (w / barCount) * 0.7
    const gap = (w / barCount) * 0.3
    const step = Math.floor(analyserData.length / barCount)

    for (let i = 0; i < barCount; i++) {
      const value = analyserData[i * step] || 128
      const normalizedValue = Math.abs(value - 128) / 128
      const barHeight = Math.max(2, normalizedValue * h * (isActive ? 0.9 : 0.3))

      ctx.fillStyle = gradient
      ctx.globalAlpha = 0.3 + normalizedValue * 0.7

      const x = i * (barWidth + gap)
      const y = (h - barHeight) / 2

      ctx.beginPath()
      ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2)
      ctx.fill()

      // Glow effect
      if (isActive && normalizedValue > 0.3) {
        ctx.globalAlpha = normalizedValue * 0.2
        ctx.shadowColor = color === 'violet' ? '#7C3AED' : '#06B6D4'
        ctx.shadowBlur = 15
        ctx.beginPath()
        ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2)
        ctx.fill()
        ctx.shadowBlur = 0
      }
    }

    ctx.globalAlpha = 1
  }, [analyserData, isActive, color, height])

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-lg"
      style={{ height: `${height}px` }}
    />
  )
}

function drawIdleWave(ctx, w, h, color) {
  const barCount = 64
  const barWidth = (w / barCount) * 0.7
  const gap = (w / barCount) * 0.3
  const gradient = ctx.createLinearGradient(0, 0, w, 0)
  gradient.addColorStop(0, color === 'violet' ? '#7C3AED' : '#06B6D4')
  gradient.addColorStop(1, color === 'violet' ? '#06B6D4' : '#7C3AED')

  ctx.fillStyle = gradient

  for (let i = 0; i < barCount; i++) {
    const barHeight = 3
    const x = i * (barWidth + gap)
    const y = (h - barHeight) / 2
    ctx.globalAlpha = 0.3
    ctx.beginPath()
    ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}
