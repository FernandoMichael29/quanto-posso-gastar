import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` precisa bater com o nome do repositório no GitHub Pages.
// Se você renomear o repositório, mude aqui também (ou defina BASE no ambiente).
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE || '/quanto-posso-gastar/',
  build: { outDir: 'dist' }
});
