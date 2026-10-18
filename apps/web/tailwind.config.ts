import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#13231e',
        moss: '#567b65',
        paper: '#f6f7f2',
        line: '#e4e8e1',
      },
      boxShadow: { soft: '0 12px 40px rgba(19,35,30,.06)' },
    },
  },
  plugins: [],
};

export default config;
