import chokidar from 'chokidar';
import path from 'path';
import { buildEntry, devDir, SUPPORTED_EXT } from './jsx-builder.js';

// Следим ТОЛЬКО за папкой jsx/dev и пересобираем только тот файл, который
// изменился. Импорты из jsx/utils и других папок встраиваются при сборке, но
// за этими папками мы не следим — собираем по сохранению самого dev-файла.

// Дебаунс на каждый файл, чтобы пачка событий save не запускала сборку дважды.
const timers = new Map();

function isEntry(name) {
	return !name.startsWith('_') && SUPPORTED_EXT.includes(path.extname(name));
}

function scheduleBuild(entryFile) {
	if (timers.has(entryFile)) clearTimeout(timers.get(entryFile));
	timers.set(
		entryFile,
		setTimeout(async () => {
			timers.delete(entryFile);
			try {
				await buildEntry(entryFile);
			} catch (e) {
				console.error(`❌ Ошибка сборки ${entryFile}: ${e.message}`);
			}
		}, 120)
	);
}

const watcher = chokidar.watch(devDir, {
	ignoreInitial: true,
	depth: 0, // только файлы прямо в jsx/dev, без вложенных папок
});

console.log('👀 Слежу за jsx/dev ...');

watcher.on('all', (event, filePath) => {
	if (event === 'unlink' || event === 'unlinkDir' || event === 'addDir') return;
	const name = path.basename(filePath);
	if (!isEntry(name)) return;
	console.log(`🔁 ${event}: ${name}`);
	scheduleBuild(name);
});
