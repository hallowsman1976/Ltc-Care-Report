/** Tailwind config — production build (แทน Play CDN) */
module.exports = {
  content: ['./*.html'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Anuphan', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          50:'#eef5ff', 100:'#dbe9ff', 200:'#bcd6ff', 300:'#8ebcff',
          400:'#5a9bff', 500:'#2e83ff', 600:'#0a6cff', 700:'#0a57d8',
          800:'#1a2138', 900:'#0f1424',
        },
        accent: {
          50:'#ecfdf3', 100:'#d4f7e1', 200:'#a8eec3', 300:'#6fe09e',
          400:'#34c759', 500:'#1f9d4d', 600:'#178043', 700:'#136636',
        },
      },
    },
  },
  // เผื่อคลาสที่ Alpine สร้างแบบ dynamic / อยู่ใน :class (กันถูก purge ทิ้ง)
  safelist: [
    { pattern: /^(bg|text|border)-(primary|accent)-(50|100|200|300|400|500|600|700|800|900)$/, variants: ['hover'] },
    { pattern: /^(bg|text)-(pink|red|green|blue|yellow|orange|purple|slate|amber)-(50|100|400|500|600|700)$/ },
    { pattern: /^bg-white\/(10|15|20)$/, variants: ['hover'] },
    'text-white', 'opacity-50',
  ],
};
