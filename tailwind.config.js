/** @type {import('tailwindcss').Config} */
const config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        gold: {
          DEFAULT: '#C9A440',
          50:  '#FAF5E8',
          100: '#F3E9C7',
          200: '#E8D494',
          300: '#DCBE61',
          400: '#C9A440',
          500: '#A8872E',
          600: '#876B22',
          700: '#665117',
          800: '#44360F',
          900: '#221B07',
        },
        ez: {
          sidebar:     '#111111',
          dark:        '#1A1A1A',
          bg:          '#F8F7F4',
          surface:     '#FFFFFF',
          card:        '#FFFFFF',
          border:      '#E8E5DE',
          muted:       '#F2F0EB',
          text:        '#1A1A1A',
          subtle:      '#6B6860',
          placeholder: '#B0ADA6',
        },
      },
      fontFamily: {
        display: ['Barlow Condensed', 'sans-serif'],
        body:    ['Inter', 'sans-serif'],
      },
      borderRadius: {
        lg: '12px',
        md: '8px',
        sm: '6px',
      },
      boxShadow: {
        'ez-sm':  '0 1px 3px rgba(0,0,0,0.08)',
        'ez-md':  '0 4px 12px rgba(0,0,0,0.10)',
        'ez-lg':  '0 8px 24px rgba(0,0,0,0.12)',
        'ez-gold':'0 0 20px rgba(201,164,64,0.25)',
      },
      keyframes: {
        'fade-in':  { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'slide-in': { from: { transform: 'translateX(-100%)' },             to: { transform: 'translateX(0)' } },
      },
      animation: {
        'fade-in':  'fade-in 0.2s ease-out',
        'slide-in': 'slide-in 0.25s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

module.exports = config