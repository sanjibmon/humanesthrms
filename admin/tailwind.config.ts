import type { Config } from 'tailwindcss';

/* Brand tokens sampled from the live site, apps.humanest.co.in.
   Structure (radii, shadows, 44px inputs) follows the production prompts. */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#087FD9',
          dark: '#0668B4',
          deep: '#0D2E5B',
          soft: '#E9F8FF',
          softer: '#F2FAFF',
        },
        leaf: { DEFAULT: '#20CE80', text: '#0E8A5B', soft: '#E9FFF5' },
        cyan: { brand: '#04B9CF' },
        amber: { brand: '#F59E0B', bg: '#FEF3C7', text: '#D97706' },
        ink: '#0D2E5B',
        slate: {
          body: '#334155',
          muted: '#64748B',
          faint: '#94A3B8',
          line: '#E2E8F0',
          line2: '#F1F5F9',
          surface: '#F8FAFC',
        },
        canvas: '#F8FAF9',
      },
      borderRadius: { xl: '12px', '2xl': '16px' },
      boxShadow: {
        sm: '0 1px 2px rgba(13,46,91,.05), 0 1px 3px rgba(13,46,91,.06)',
        md: '0 4px 12px rgba(13,46,91,.08), 0 2px 4px rgba(13,46,91,.04)',
        lg: '0 10px 30px rgba(13,56,80,.09)',
        xl: '0 25px 70px rgba(20,67,98,.16)',
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      backgroundImage: {
        'brand-grad': 'linear-gradient(135deg,#087FD9 0%,#20CE80 100%)',
        'brand-grad-wide': 'linear-gradient(100deg,#087FD9 0%,#20CE80 100%)',
        'brand-deep': 'linear-gradient(135deg,#0D2E5B 0%,#087FD9 100%)',
      },
      transitionDuration: { DEFAULT: '200ms' },
    },
  },
  plugins: [],
};
export default config;
