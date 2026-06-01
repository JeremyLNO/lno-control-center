/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  // text-${align} is built dynamically in SortHeader -> keep these utilities.
  safelist: ['text-left', 'text-right', 'text-center'],
  theme: {
    extend: {
      colors: {
        navy:   '#0B1F3A',
        navy2:  '#0F2A4D',
        gold:   '#C9A24D',
        success:'#10B981',
        danger: '#EF4444',
        warn:   '#F59E0B',
        bg:     '#F8F7F4',
      },
      fontFamily: { mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
    },
  },
  plugins: [],
}
