import chokidar from 'chokidar';
import path from 'path';
import { buildEntry, devDir, SUPPORTED_EXT } from './jsx-builder.js';
import { buildPlayground, ensurePlaygroundConfig, playgroundConfig } from './build-playground.js';

// Следим за jsx/dev (пересобираем изменившийся entry → distr/<name>.jsx) и за
// jsx/_playground/playground.js. На каждое изменение dev-скрипта ИЛИ конфига
// пересобираем ещё и jsx/_playground/__run.jsx (distr + подставленный inObj +
// вызов entry-функции) — runnable-версию под ExtendScript Debugger.
//
// Импорты из jsx/utils встраиваются при сборке, но за этими папками не следим —
// собираем по сохранению самого dev-файла.

// Дебаунс на каждый ключ, чтобы пачка событий save не запускала сборку дважды.
const timers = new Map();

function isEntry(name) {
	return !name.startsWith('_') && SUPPORTED_EXT.includes(path.extname(name));
}

function schedule(key, fn) {
	if (timers.has(key)) clearTimeout(timers.get(key));
	timers.set(
		key,
		setTimeout(async () => {
			timers.delete(key);
			try {
				await fn();
			} catch (e) {
				console.error(`❌ Ошибка сборки ${key}: ${e.message}`);
			}
		}, 120)
	);
}

// Стартовая сборка playground (создаст playground.js из шаблона, если его нет).
await ensurePlaygroundConfig();
await buildPlayground().catch((e) => console.error(`❌ playground: ${e.message}`));

// 1. dev-скрипты → distr/<name>.jsx + обновление __run.jsx
const devWatcher = chokidar.watch(devDir, {
	ignoreInitial: true,
	depth: 0, // только файлы прямо в jsx/dev, без вложенных папок
});
console.log('👀 Слежу за jsx/dev ...');
devWatcher.on('all', (event, filePath) => {
	if (event === 'unlink' || event === 'unlinkDir' || event === 'addDir') return;
	const name = path.basename(filePath);
	if (!isEntry(name)) return;
	console.log(`🔁 ${event}: ${name}`);
	schedule(name, async () => {
		await buildEntry(name);
		await buildPlayground(); // обновляем runnable-версию под отладку
	});
});

// 2. playground-конфиг → пересборка только __run.jsx
const cfgWatcher = chokidar.watch(playgroundConfig, { ignoreInitial: true });
console.log('👀 Слежу за jsx/_playground/playground.js ...');
cfgWatcher.on('all', (event) => {
	if (event === 'unlink') return;
	console.log(`🔁 ${event}: playground.js`);
	schedule('__playground__', () => buildPlayground());
});
