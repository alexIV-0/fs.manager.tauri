import chokidar from 'chokidar';
import path from 'path';
import { exec } from 'child_process';

const root = process.cwd();
const pluginsDir = path.join(root, 'plugins-dev');

console.log('👀 Watching plugins-dev...');

const watcher = chokidar.watch(pluginsDir, {
	ignored: ['**/node_modules/**', '**/_packScripts/**', '**/dist/**', '**/_**/**'],
	ignoreInitial: true,
});

watcher.on('all', (event, filePath) => {
	const rel = path.relative(pluginsDir, filePath);
	const pluginName = rel.split(path.sep)[0];

	if (!pluginName) return;

	console.log(`🔁 ${event}: ${pluginName}`);

	exec(`node plugins-dev/_packScripts/build-plugin.js ${pluginName}`, () => {});
});
