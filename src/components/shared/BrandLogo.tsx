'use client'

interface BrandLogoProps {
  marque: string
  size?: 'sm' | 'md' | 'lg'
}

// sm = cart strip (w-7), md = grid cards (w-10), lg = qty picker (w-12)
const SIZES = {
  sm: { cls: 'w-7 h-7 rounded-lg',    text: 'text-[8px]',  svg: '52%' },
  md: { cls: 'w-10 h-10 rounded-xl',  text: 'text-[11px]', svg: '56%' },
  lg: { cls: 'w-12 h-12 rounded-2xl', text: 'text-sm',     svg: '58%' },
}

type BrandDef = {
  bg:      string
  fg:      string
  abbr?:   string
  isApple?: boolean
}

const BRANDS: Record<string, BrandDef> = {
  // Apple family
  apple:    { bg: '#1D1D1F', fg: '#FFFFFF', isApple: true },
  iphone:   { bg: '#1D1D1F', fg: '#FFFFFF', isApple: true },
  ipad:     { bg: '#1D1D1F', fg: '#FFFFFF', isApple: true },
  macbook:  { bg: '#1D1D1F', fg: '#FFFFFF', isApple: true },
  // Android brands
  samsung:  { bg: '#1428A0', fg: '#FFFFFF', abbr: 'S'    },
  xiaomi:   { bg: '#FF6900', fg: '#FFFFFF', abbr: 'Mi'   },
  redmi:    { bg: '#FF4444', fg: '#FFFFFF', abbr: 'Ri'   },
  huawei:   { bg: '#CF0A2C', fg: '#FFFFFF', abbr: 'HW'   },
  oppo:     { bg: '#1C1C1E', fg: '#9EDB5F', abbr: 'OP'   },
  realme:   { bg: '#FFD000', fg: '#1A1A1A', abbr: 'RM'   },
  oneplus:  { bg: '#F5010C', fg: '#FFFFFF', abbr: '1+'   },
  'one plus':{ bg: '#F5010C', fg: '#FFFFFF', abbr: '1+'  },
  infinix:  { bg: '#00B849', fg: '#FFFFFF', abbr: 'IX'   },
  tecno:    { bg: '#E31837', fg: '#FFFFFF', abbr: 'TC'   },
  nokia:    { bg: '#005AFF', fg: '#FFFFFF', abbr: 'Nk'   },
  motorola: { bg: '#5C2D8C', fg: '#FFFFFF', abbr: 'Moto' },
  lg:       { bg: '#A50034', fg: '#FFFFFF', abbr: 'LG'   },
  sony:     { bg: '#2B2B2B', fg: '#FFFFFF', abbr: 'So'   },
  honor:    { bg: '#2B2B8A', fg: '#FFFFFF', abbr: 'Hr'   },
  vivo:     { bg: '#415FFF', fg: '#FFFFFF', abbr: 'vv'   },
  asus:     { bg: '#00558C', fg: '#FFFFFF', abbr: 'As'   },
  lenovo:   { bg: '#E2231A', fg: '#FFFFFF', abbr: 'Lv'   },
}

// Deterministic color for unknown brands — same brand always gets same color
function hashColor(marque: string): string {
  let h = 0
  for (let i = 0; i < marque.length; i++) h = marque.charCodeAt(i) + ((h << 5) - h)
  return `hsl(${Math.abs(h) % 360}, 55%, 35%)`
}

// Apple logo SVG — clean minimal path, renders well at all small sizes
function AppleSVG({ size }: { size: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size}>
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  )
}

export function BrandLogo({ marque, size = 'md' }: BrandLogoProps) {
  const key    = marque.toLowerCase().trim()
  const config = BRANDS[key] ?? BRANDS[key.replace(/\s+/g, '')]
  const sz     = SIZES[size]
  const bg     = config?.bg ?? hashColor(marque)
  const fg     = config?.fg ?? '#FFFFFF'

  return (
    <div
      className={`${sz.cls} flex items-center justify-center flex-shrink-0 select-none`}
      style={{ backgroundColor: bg, color: fg }}
    >
      {config?.isApple ? (
        <AppleSVG size={sz.svg} />
      ) : (
        <span className={`${sz.text} font-black tracking-tight leading-none`}>
          {config?.abbr ?? marque.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  )
}