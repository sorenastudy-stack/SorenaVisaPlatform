/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // legacy tokens (kept for existing components)
        navy: '#0a2342',
        'navy-dark': '#060f1a',
        teal: '#0d7a6e',
        'teal-light': '#12a693',
        'off-white': '#f4f7f6',
        // design system tokens
        'sorena-navy':  '#1e3a5f',
        'sorena-gold':  '#E8B923',
        'sorena-cream': '#faf8f3',
        'sorena-text':  '#3d3d3d',
      },
      fontFamily: {
        sans:      ['Inter', 'system-ui', 'sans-serif'],
        vazirmatn: ['Vazirmatn', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl:  '12px',
        '2xl': '16px',
      },
    },
  },
  plugins: [],
};
