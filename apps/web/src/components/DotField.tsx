import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

// Orin's loading state: evenly spaced dots with an ocean swell rolling in from the top-left.
// Used by the builder's preview while the app starts, and by the landing page's demo.
//
// Canvas, because a field this size is ~1,500 dots: one 2D draw a frame instead of 1,500 animating
// nodes. The dot colour is the canvas's CSS `color`, so it follows the theme like any text would.
const GAP = 18            // px between dot centres — the spacing is the look
const R = 1.15            // resting radius
const WAVELENGTH = 190    // px between wave fronts
const SPEED = 62          // px per second across the field

export function DotField({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const t0 = performance.now()
    let w = 0, h = 0, dpr = 1, raf = 0, visible = true

    function draw(t: number) {
      if (!w || !h || !ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = getComputedStyle(canvas!).color
      // Fronts come from just off the top-left corner and are bent by a slow cross-swell, so no
      // front is a perfect arc — the asymmetry is what makes it read as sea rather than an echo.
      const ox = -w * 0.08, oy = -h * 0.14, maxD = Math.hypot(w - ox, h - oy)
      const k = (Math.PI * 2) / WAVELENGTH, phase = t * SPEED * k
      const cols = Math.ceil(w / GAP) + 1, rows = Math.ceil(h / GAP) + 1
      const x0 = (w - (cols - 1) * GAP) / 2, y0 = (h - (rows - 1) * GAP) / 2
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = x0 + i * GAP, y = y0 + j * GAP, d = Math.hypot(x - ox, y - oy)
          const swell = 0.9 * Math.sin(y * 0.017 + t * 0.7) + 0.55 * Math.sin(x * 0.011 - t * 0.45)
          const crest = Math.pow(0.5 + 0.5 * Math.sin(d * k - phase + swell), 1.6)
          const fall = 1 - Math.min(d / maxD, 1) * 0.82
          ctx.globalAlpha = 0.14 + crest * fall * 0.62
          ctx.beginPath()
          ctx.arc(x, y, R * (1 + crest * fall * 0.9), 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }

    function loop() {
      cancelAnimationFrame(raf)
      const step = (now: number) => {
        if (!visible) return
        draw((now - t0) / 1000)
        raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }

    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect()
      dpr = Math.min(devicePixelRatio || 1, 2)
      w = r.width
      h = r.height
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      draw(reduced ? 0.9 : (performance.now() - t0) / 1000)
    })
    ro.observe(canvas)
    // Nothing to animate while it's off screen or behind a finished app.
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible && !reduced) loop()
    })
    io.observe(canvas)
    if (!reduced) loop()

    // Everything set up here is undone here — StrictMode and hot reload both run this twice.
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
    }
  }, [])

  return <canvas ref={ref} aria-hidden="true" className={cn('block h-full w-full', className)} />
}
