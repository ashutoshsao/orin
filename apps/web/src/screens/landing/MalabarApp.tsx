import { cn } from '@/lib/utils'

// The app the landing-page demo "builds": a small spice shop. It's the payoff of the whole demo —
// if what appears in the preview isn't lovely, the demo sells nothing — so it gets a real design.
//
// It is deliberately NOT styled with Orin's tokens: it's somebody else's product, with its own brand
// (cream, turmeric, pepper, cardamom). Raw hex is correct here for that reason.
const C = {
  paper: '#FBF5EA', ink: '#231811', muted: '#7A6652', line: '#EADCC6',
  turmeric: '#E6AA2E', pepper: '#2C221C', cardamom: '#7FA35B', chili: '#B8481F',
}

type Part = 'nav' | 'hero' | 'art' | 'c1' | 'c2' | 'c3' | 'foot'

export function MalabarApp({ parts, icons, broken }: { parts: ReadonlySet<Part>; icons: boolean; broken: boolean }) {
  // A part fades up the moment the file that renders it lands — the "hot reload" beat.
  const show = (p: Part) => cn('transition-[opacity,transform] duration-500 ease-out', parts.has(p) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2')

  return (
    <div className="@container absolute inset-0 overflow-hidden font-sans" style={{ background: C.paper, color: C.ink }}>
      <nav className={cn('flex items-center justify-between border-b px-5 py-3 @xl:px-7', show('nav'))} style={{ borderColor: C.line }}>
        <span className="flex items-center gap-2">
          <Peppercorns />
          <span className="font-display text-[19px] leading-none tracking-[-0.01em]">Malabar &amp; Co.</span>
        </span>
        <span className="flex items-center gap-4 text-[11.5px]" style={{ color: C.muted }}>
          <span className="hidden @md:inline">Shop</span>
          <span className="hidden @md:inline">Recipes</span>
          <span className="hidden @lg:inline">Our farms</span>
          <span className="relative grid size-7 place-items-center rounded-full border" style={{ borderColor: C.line }}>
            {/* the icon only exists once `bun add lucide-react` has run */}
            <svg className={cn('transition-opacity duration-300', icons ? 'opacity-100' : 'opacity-0')} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 7h12l-1.2 12H7.2z" /><path d="M9 7a3 3 0 0 1 6 0" /></svg>
            <span className={cn('absolute -top-1 -right-1 grid size-3.5 place-items-center rounded-full text-[8px] font-semibold text-white transition-opacity', icons ? 'opacity-100' : 'opacity-0')} style={{ background: C.chili }}>2</span>
          </span>
        </span>
      </nav>

      <section className="grid gap-5 px-5 pt-5 pb-4 @xl:grid-cols-[1.08fr_1fr] @xl:items-center @xl:px-7 @xl:pt-6">
        <div className={show('hero')}>
          <p className="mb-2 text-[11px]" style={{ color: C.muted }}>Harvest 2026 · Wayanad &amp; Idukki</p>
          <h4 className="font-display text-[clamp(1.45rem,5.2cqi,2.15rem)] leading-[1.02] font-normal tracking-[-0.015em]">
            Spice, the week <br className="hidden @xl:block" />it was <em className="italic">ground.</em>
          </h4>
          <p className="mt-2.5 max-w-[34ch] text-[11.5px] leading-relaxed" style={{ color: C.muted }}>
            Single-farm pepper, cardamom and turmeric from the Malabar coast, milled in small batches and shipped within the week.
          </p>
          <div className="mt-3.5 flex items-center gap-3 text-[11px] font-semibold">
            <span className="rounded-full px-3.5 py-2" style={{ background: C.ink, color: C.paper }}>Shop the harvest</span>
            <span className="underline decoration-1 underline-offset-4" style={{ color: C.ink }}>Meet the farms</span>
          </div>
        </div>
        <div className={cn('hidden @xl:block', show('art'))}><StillLife /></div>
      </section>

      <section className={cn('grid grid-cols-2 gap-2.5 px-5 pb-4 transition-[filter,opacity] duration-300 @xl:grid-cols-3 @xl:px-7', broken && 'opacity-40 blur-[2px] grayscale')}>
        {PRODUCTS.map((p, i) => (
          <div key={p.name} className={cn('rounded-xl border bg-white p-2.5', show(p.part), i === 2 && 'hidden @xl:block')} style={{ borderColor: C.line }}>
            <div className="mb-2 grid h-[70px] place-items-center rounded-lg" style={{ background: p.tint }}><Jar color={p.color} /></div>
            <div className="flex items-baseline justify-between gap-2">
              <b className="truncate text-[11.5px] font-semibold">{p.name}</b>
              <span className="text-[11px] tabular-nums">₹{p.price}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between text-[10.5px]" style={{ color: C.muted }}>
              <span>{p.origin}</span>
              <span className="rounded-full border px-2 py-[1px] font-medium" style={{ borderColor: C.line, color: C.ink }}>Add</span>
            </div>
          </div>
        ))}
      </section>

      <footer className={cn('mx-5 flex justify-between border-t py-2.5 text-[10.5px] @xl:mx-7', show('foot'))} style={{ borderColor: C.line, color: C.muted }}>
        <span>Kozhikode, Kerala</span>
        <span>Free shipping over ₹999</span>
      </footer>
    </div>
  )
}

const PRODUCTS: { name: string; origin: string; price: number; color: string; tint: string; part: Part }[] = [
  { name: 'Tellicherry pepper', origin: 'Wayanad', price: 240, color: C.pepper, tint: '#F1E7DA', part: 'c1' },
  { name: 'Green cardamom', origin: 'Idukki', price: 320, color: C.cardamom, tint: '#EAF0DF', part: 'c2' },
  { name: 'Alleppey turmeric', origin: 'Alappuzha', price: 180, color: C.turmeric, tint: '#FBEBC8', part: 'c3' },
]

function Peppercorns() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="9" r="4.2" fill={C.pepper} />
      <circle cx="15.5" cy="8" r="3.6" fill={C.chili} />
      <circle cx="12" cy="15.5" r="4.4" fill={C.turmeric} />
    </svg>
  )
}

function Jar({ color }: { color: string }) {
  return (
    <svg width="44" height="54" viewBox="0 0 44 54" aria-hidden="true">
      <ellipse cx="22" cy="51" rx="15" ry="2.5" fill="#000" opacity=".08" />
      <rect x="9" y="3" width="26" height="8" rx="2.5" fill={C.ink} />
      <rect x="6" y="10" width="32" height="40" rx="7" fill={color} />
      <rect x="6" y="10" width="7" height="40" rx="3.5" fill="#fff" opacity=".14" />
      <rect x="10" y="24" width="24" height="14" rx="2" fill={C.paper} />
      <rect x="13" y="28" width="12" height="2" rx="1" fill={C.ink} opacity=".7" />
      <rect x="13" y="32" width="18" height="1.6" rx=".8" fill={C.ink} opacity=".35" />
    </svg>
  )
}

// Three mounds on a plate — turmeric, pepper, cardamom — with a scatter of whole spice.
function StillLife() {
  return (
    <svg viewBox="0 0 320 230" className="block w-full" role="img" aria-label="Turmeric, black pepper and cardamom on a plate">
      <defs>
        <radialGradient id="ml-sun" cx="30%" cy="22%" r="95%">
          <stop offset="0" stopColor="#F4BE55" /><stop offset=".55" stopColor="#C8561F" /><stop offset="1" stopColor="#6E2410" />
        </radialGradient>
        <linearGradient id="ml-shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".28" /><stop offset=".6" stopColor="#fff" stopOpacity="0" /></linearGradient>
      </defs>
      <rect width="320" height="230" rx="16" fill="url(#ml-sun)" />
      <ellipse cx="160" cy="186" rx="128" ry="16" fill="#000" opacity=".22" />
      <ellipse cx="160" cy="170" rx="124" ry="36" fill="#F6EBDC" />
      <ellipse cx="160" cy="166" rx="104" ry="26" fill="#EFE1CC" />
      <path d="M62 170 Q98 96 136 170 Z" fill={C.turmeric} />
      <path d="M62 170 Q98 96 136 170 Z" fill="url(#ml-shine)" />
      <path d="M116 172 Q160 70 206 172 Z" fill={C.pepper} />
      <path d="M116 172 Q160 70 206 172 Z" fill="url(#ml-shine)" opacity=".5" />
      <path d="M186 170 Q222 102 258 170 Z" fill={C.cardamom} />
      <path d="M186 170 Q222 102 258 170 Z" fill="url(#ml-shine)" />
      {[[84, 150], [94, 138], [104, 156], [112, 144], [78, 162]].map(([x, y], i) => <circle key={`t${i}`} cx={x} cy={y} r="1.3" fill="#B97F12" opacity=".7" />)}
      {[[150, 128], [166, 118], [158, 146], [174, 140], [144, 158], [182, 158]].map(([x, y], i) => <circle key={`p${i}`} cx={x} cy={y} r="2.1" fill="#4A3B31" />)}
      {[[42, 190, 20], [274, 186, -25], [230, 200, 10]].map(([x, y, a], i) => <ellipse key={`c${i}`} cx={x} cy={y} rx="7" ry="3.6" fill="#7FA35B" transform={`rotate(${a} ${x} ${y})`} />)}
      {[[60, 205], [70, 198], [258, 204], [248, 196], [100, 208]].map(([x, y], i) => <circle key={`b${i}`} cx={x} cy={y} r="2.8" fill={C.pepper} />)}
    </svg>
  )
}

export type { Part as MalabarPart }
