import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/api': {
                target: 'https://api.bling.com.br/Api/v3',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ''),
                secure: true,
            },
            '/oauth': {
                target: 'https://bling.com.br/Api/v3/oauth',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/oauth/, ''),
                secure: true,
            },
        },
    },
})
