import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2023',
    rollupOptions: { input: ['index.html', 'werkscherm.html', 'instellingen.html', 'portaal.html', 'scenario.html'] },
  },
});
