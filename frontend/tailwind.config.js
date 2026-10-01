/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Bell shake: rings for ~0.8s, then rests until the next cycle
      keyframes: {
        'bell-ring': {
          '0%, 40%, 100%': { transform: 'rotate(0deg)' },
          '5%': { transform: 'rotate(18deg)' },
          '10%': { transform: 'rotate(-16deg)' },
          '15%': { transform: 'rotate(13deg)' },
          '20%': { transform: 'rotate(-10deg)' },
          '25%': { transform: 'rotate(6deg)' },
          '30%': { transform: 'rotate(-3deg)' },
        },
      },
      animation: {
        'bell-ring': 'bell-ring 2.5s ease-in-out infinite',
      },
      colors: {
        primary: {
          50: '#f0f7ff',
          100: '#e0effe',
          200: '#bae0fd',
          300: '#7cc7fb',
          400: '#36abf7',
          500: '#0c8fe9',
          600: '#0171c7',
          700: '#025aa1',
          800: '#064d85',
          900: '#0b416f',
          950: '#072949',
        },
      },
    },
  },
  plugins: [],
}
