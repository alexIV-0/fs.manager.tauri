import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
	const isServe = command === 'serve';

	return {
		resolve: {
			alias: {
				'@': path.join(__dirname, 'src'),
				// Полифил-модули для плагинов. plugin:// протокол на лету переписывает
				// `from "node:fs"` → `from "@plugin-api/fs"` и т.д.
				'@plugin-api/fs-promises': path.join(__dirname, 'src/PluginAPI/fs-promises.ts'),
				'@plugin-api/fs': path.join(__dirname, 'src/PluginAPI/fs.ts'),
				'@plugin-api/path': path.join(__dirname, 'src/PluginAPI/path.ts'),
				'@plugin-api/os': path.join(__dirname, 'src/PluginAPI/os.ts'),
				'@plugin-api/child_process': path.join(__dirname, 'src/PluginAPI/child_process.ts'),
				'@plugin-api/crypto': path.join(__dirname, 'src/PluginAPI/crypto.ts'),
				'@plugin-api/events': path.join(__dirname, 'src/PluginAPI/events.ts'),
				'@plugin-api/util': path.join(__dirname, 'src/PluginAPI/util.ts'),
				'@plugin-api/url': path.join(__dirname, 'src/PluginAPI/url.ts'),
				'@plugin-api/stream': path.join(__dirname, 'src/PluginAPI/stream.ts'),
			},
		},
		base: './',
		plugins: [react()],
		build: {
			rollupOptions: {
				input: {
					main: path.resolve(__dirname, 'index.html'),
					nodeWin: path.resolve(__dirname, 'nodeWin.html'),
					previewWin: path.resolve(__dirname, 'previewWin.html'),
					logWindow: path.resolve(__dirname, 'logWindow.html'),
				},
			},
			outDir: 'dist',
		},
		server: {
			port: 1420,
			strictPort: true,
		},
		clearScreen: false,
	};
});
