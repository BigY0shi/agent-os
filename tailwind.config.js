/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
    './app/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        // YOSHI Dark Theme — near-black base with orange accent
        surface: {
          950: '#09090B',  // bg-base
          900: '#111113',  // bg-surface (cards)
          800: '#1A1A1D',  // bg-elevated (hover, inputs)
          700: '#222225',  // bg-overlay (tags, badges)
          600: '#2A2A2F',  // border-default
          500: '#3A3A40',  // border-strong
          400: '#63637A',  // text-tertiary
          300: '#A1A1AA',  // text-secondary
          200: '#EDEDEF',  // text-primary
          100: '#F8F8FA',  // white-ish
        },
        accent: {
          DEFAULT: '#FF6B00',  // Teenage Engineering orange
          dim: 'rgba(255, 107, 0, 0.15)',
          glow: 'rgba(255, 107, 0, 0.35)',
        },
        status: {
          green:    '#34D399',
          'green-dim': 'rgba(52, 211, 153, 0.15)',
          amber:    '#FBBF24',
          'amber-dim': 'rgba(251, 191, 36, 0.15)',
          red:      '#F87171',
          'red-dim': 'rgba(248, 113, 113, 0.15)',
          blue:     '#60A5FA',
          'blue-dim': 'rgba(96, 165, 250, 0.15)',
          purple:   '#A78BFA',
          'purple-dim': 'rgba(167, 139, 250, 0.15)',
          pink:     '#F472B6',
          'pink-dim': 'rgba(244, 114, 182, 0.15)',
        },
        // Section colors
        section: {
          'social-media':   '#A78BFA',
          'marketing':      '#60A5FA',
          'market-research':'#F472B6',
          'freelance':      '#34D399',
          'devops':         '#FB923C',
          'engineering':    '#38BDF8',
          'data':           '#FBBF24',
          'custom':         '#A1A1AA',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'sans-serif'],
        mono: ['Fira Code', 'SF Mono', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'slide-up': 'slideUp 0.2s ease-out',
        'pulse-status': 'pulseStatus 2s infinite',
        'shimmer': 'shimmer 1.5s infinite linear',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        slideUp: { '0%': { transform: 'translateY(6px)', opacity: 0 }, '100%': { transform: 'translateY(0)', opacity: 1 } },
        pulseStatus: { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.4 } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
    },
  },
  plugins: [],
};
