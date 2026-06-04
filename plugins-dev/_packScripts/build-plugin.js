import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs/promises';
import { builtinModules } from 'module';

// Plugins run in Tauri WebView, not Node.js. Rust plugin:// handler
// rewrites `node:*` imports to async polyfills in src/PluginAPI/* at fetch time.
// Plugins should use @plugin-api/tauri helper for fs/ffmpeg/exec/ae operations.
// Modules below have working async polyfills — keep them external so the handler
// can substitute them at runtime.
const POLYFILLED = new Set([
	'path',
	'buffer',
	'url',
	'util',
	'events',
	'os',
	// fs/crypto/child_process polyfills exist but are async-only — plugins must
	// migrate to the @plugin-api/tauri helper. Old plugins still load.
	'fs',
	'fs/promises',
	'crypto',
	'child_process',
	'stream',
	'stream/promises',
]);

const nodeBuiltinsPlugin = {
	name: 'node-builtins',
	setup(build) {
		build.onResolve({ filter: /^node:/ }, (args) => {
			const name = args.path.replace(/^node:/, '');
			if (POLYFILLED.has(name)) {
				return { path: `node:${name}`, external: true };
			}
			// Bare `node:something` we don't polyfill yet — fail loudly.
			return {
				errors: [
					{
						text: `Plugin imports node:${name} which has no polyfill in Tauri. Use @plugin-api/tauri helper instead.`,
					},
				],
			};
		});
		// Bare imports of builtins without `node:` prefix (e.g. `import fs from 'fs'`)
		build.onResolve({ filter: /^[a-zA-Z0-9_\-]+$/ }, (args) => {
			if (POLYFILLED.has(args.path)) {
				return { path: `node:${args.path}`, external: true };
			}
		});
	},
};

const pluginName = process.argv[2];
if (!pluginName) {
	console.error('❌ Plugin name required');
	process.exit(1);
}

if (pluginName.startsWith('_')) {
	console.log(`⏭️  Skipping ${pluginName} (starts with _)`);
	process.exit(0);
}

const root = process.cwd();
const pluginDevPath = path.join(root, 'plugins-dev', pluginName);
const manifestPath = path.join(pluginDevPath, 'plugin.json');

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
const outDir = path.join(root, 'distr-plugins', `${manifest.id}@${manifest.version}`);

await fs.mkdir(outDir, { recursive: true });

console.log(`🔨 Building plugin: ${manifest.id}@${manifest.version}`);

const outFile = path.join(outDir, manifest.main);

// Берём имя файла из манифеста и меняем .js на .ts
const entryFileName = manifest.main.replace(/\.js$/, '.ts');

// ===== СБОРКА =====
// platform: 'browser' — плагины крутятся в WebView, не в Node.js
// target: 'es2022' — современный WebView/Safari/Chrome поддерживает всё
// node:* импорты остаются external и переписываются Rust plugin:// handler'ом
// на полифилы из src/PluginAPI/*.
await esbuild.build({
	entryPoints: [path.join(pluginDevPath, entryFileName)],
	outfile: outFile,

	bundle: true,
	platform: 'browser',
	target: 'es2022',
	format: 'esm',
	// 'inline' (а не true): карта вшивается в .js как data-URI, отдельный .js.map не создаётся.
	// Иначе бандл ссылается на //# sourceMappingURL=*.js.map, а plugin://-протокол .map не отдаёт → 404.
	sourcemap: 'inline',

	treeShaking: true,
	minify: false,
	keepNames: true,

	external: ['electron', ...(manifest.external || [])],

	plugins: [nodeBuiltinsPlugin],
});

// копируем статику
await fs.copyFile(manifestPath, path.join(outDir, 'plugin.json'));

try {
	await fs.copyFile(path.join(pluginDevPath, 'ui.json'), path.join(outDir, 'ui.json'));
} catch {
	console.log('   ⚠️  ui.json not found (skipped)');
}

// ===== КОПИРОВАНИЕ EXTERNAL node_modules =====
const externals = manifest.external || [];

if (externals.length > 0) {
	console.log(`📦 Copying external dependencies: ${externals.join(', ')}`);

	const destNodeModules = path.join(outDir, 'node_modules');
	await fs.mkdir(destNodeModules, { recursive: true });

	for (const pkgName of externals) {
		const srcPkg = path.join(root, 'node_modules', pkgName);

		try {
			await fs.access(srcPkg);
		} catch {
			console.warn(`   ⚠️  Package not found in node_modules: ${pkgName}`);
			continue;
		}

		const destPkg = path.join(destNodeModules, pkgName);

		// Для scoped пакетов создаём папку @scope
		await fs.mkdir(path.dirname(destPkg), { recursive: true });

		await copyDir(srcPkg, destPkg);
		console.log(`   ✅ Copied: ${pkgName}`);
	}
}

// ===== КОПИРОВАНИЕ ASSETS =====
const copyAssets = manifest.copyAssets || [];

if (copyAssets.length > 0) {
	console.log(`🗂️  Copying assets: ${copyAssets.join(', ')}`);

	for (const assetName of copyAssets) {
		const srcAsset = path.join(pluginDevPath, assetName);

		try {
			await fs.access(srcAsset);
		} catch {
			console.warn(`   ⚠️  Asset not found: ${assetName}`);
			continue;
		}

		const destAsset = path.join(outDir, assetName);
		const stat = await fs.stat(srcAsset);

		if (stat.isDirectory()) {
			await copyDir(srcAsset, destAsset);
		} else {
			await fs.mkdir(path.dirname(destAsset), { recursive: true });
			await fs.copyFile(srcAsset, destAsset);
		}

		console.log(`   ✅ Copied asset: ${assetName}`);
	}
}

console.log(`✅ Done: ${outDir}`);

// ===== ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ =====
async function copyDir(src, dest) {
	await fs.mkdir(dest, { recursive: true });
	const entries = await fs.readdir(src, { withFileTypes: true });

	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);

		if (entry.isDirectory()) {
			await copyDir(srcPath, destPath);
		} else {
			await fs.copyFile(srcPath, destPath);
		}
	}
}
