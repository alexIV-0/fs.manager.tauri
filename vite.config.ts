import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const POLYFILLS = [
	['node:fs/promises', 'fs-promises'],
	['node:fs', 'fs'],
	['node:path', 'path'],
	['node:os', 'os'],
	['node:child_process', 'child_process'],
	['node:crypto', 'crypto'],
	['node:events', 'events'],
	['node:stream', 'stream'],
	['node:url', 'url'],
	['node:util', 'util'],
] as const;

// Инжектит <script type="importmap"> в каждый HTML до первого module-скрипта.
// Браузер применяет importmap к импортам в любом модуле, загруженном в этот реалм,
// включая динамически импортированные плагины с http://plugin.localhost — там
// `import "node:path"` резолвится в URL из этой таблицы.
function pluginApiImportmap(): Plugin {
	return {
		name: 'plugin-api-importmap',
		transformIndexHtml: {
			order: 'pre',
			handler(html, ctx) {
				const isDev = ctx.server !== undefined;
				const base = isDev ? '/src/PluginAPI' : '/assets/plugin-api';
				const ext = isDev ? '.ts' : '.js';
				const imports: Record<string, string> = {};
				for (const [from, file] of POLYFILLS) {
					imports[from] = `${base}/${file}${ext}`;
				}
				const tag = `<script type="importmap">${JSON.stringify({ imports })}</script>`;
				return html.replace(/<head>/i, `<head>\n\t\t${tag}`);
			},
		},
	};
}

// https://vitejs.dev/config/
export default defineConfig(() => {
	const polyfillInputs: Record<string, string> = {};
	for (const [, file] of POLYFILLS) {
		polyfillInputs[`plugin-api/${file}`] = path.resolve(__dirname, `src/PluginAPI/${file}.ts`);
	}

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
		plugins: [react(), pluginApiImportmap()],
		build: {
			rollupOptions: {
				input: {
					main: path.resolve(__dirname, 'index.html'),
					nodeWin: path.resolve(__dirname, 'nodeWin.html'),
					previewWin: path.resolve(__dirname, 'previewWin.html'),
					logWindow: path.resolve(__dirname, 'logWindow.html'),
					...polyfillInputs,
				},
				// PluginAPI потребляется ТОЛЬКО динамически из плагинов через importmap,
				// поэтому Rollup их не видит как используемые и tree-shake'ит экспорты.
				// 'strict' заставляет сохранять полный публичный API каждого entry-файла.
				preserveEntrySignatures: 'strict',
				output: {
					entryFileNames: (chunk) =>
						chunk.name.startsWith('plugin-api/')
							? 'assets/[name].js'
							: 'assets/[name]-[hash].js',
				},
			},
			outDir: 'dist',
		},
		server: {
			port: 1420,
			strictPort: true,
			watch: {
				ignored: ['**/src-tauri/**'],
			},
		},
		clearScreen: false,
	};
});
