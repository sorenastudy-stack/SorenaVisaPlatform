/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#0a2342',
        'navy-dark': '#060f1a',
        teal: '#0d7a6e',
        'teal-light': '#12a693',
        'off-white': '#f4f7f6',
      },
    },
  },
  plugins: [],
};
