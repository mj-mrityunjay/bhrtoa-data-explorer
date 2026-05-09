import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/bhrtoa-data-explorer/', 
  build: {
    chunkSizeWarningLimit: 1500, // Increases the warning limit to 1.5 MB
  }
})