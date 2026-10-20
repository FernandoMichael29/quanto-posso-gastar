import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` precisa bater com o nome do repositório no GitHub Pages.
// Se você renomear o repositório, mude aqui também (ou defina BASE no ambiente).
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE || '/quanto-posso-gastar/',
  // o pdf.js (importar extrato em PDF) usa sintaxe ES2022
  build: { outDir: 'dist', target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } }
});
