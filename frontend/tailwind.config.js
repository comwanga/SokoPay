/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50:  '#fdf8f0',
          100: '#faecd6',
          200: '#f4d5a3',
          300: '#ecb766',
          400: '#e39534',
          500: '#d97b18',
          600: '#c06010',
          700: '#9e4810',
          800: '#7f3913',
          900: '#682f12',
        },
        bitcoin: '#f7931a',
        mpesa: '#00a651',
      },
    },
  },
  plugins: [],
}
