import chokidar from 'chokidar';
import path from 'path';
import { buildEntry, listEntries, devDir, root, SUPPORTED_EXT } from './jsx-builder.js';
import { buildPlayground, ensurePlaygroundConfig, playgroundConfig } from './build-playground.js';

// Следим за jsx/dev (пересобираем изменившийся entry → distr/<name>.jsx) и за
// jsx/_playground/playground.js. На каждое изменение dev-скрипта ИЛИ конфига
// пересобираем ещё и jsx/_playground/__run.jsx (distr + подставленный inObj +
// вызов entry-функции) — runnable-версию под ExtendScript Debugger.
//
// Импорты из jsx/utils встраиваются в бандл при сборке. Сами по себе они не
// привязаны к конкретному entry, поэтому на изменение ЛЮБОГО файла в jsx/utils
// пересобираем ВСЕ entry (их немного) + __run.jsx — иначе правки утилов не
// попадут в distr/__run.jsx (как было раньше, когда за utils не следили).

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

/** Пересобирает все dev-entry (утил мог импортнуться в любой из них) + __run.jsx. */
async function rebuildAllEntries() {
	const entries = await listEntries();
	for (const name of entries) {
		await buildEntry(name);
	}
	await buildPlayground();
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

// 3. jsx/utils/** (рекурсивно) → встраиваются в бандл, но не привязаны к одному
//    entry, поэтому пересобираем ВСЕ entry + __run.jsx.
const utilsDir = path.join(root, 'jsx', 'utils');
const utilsWatcher = chokidar.watch(utilsDir, { ignoreInitial: true });
console.log('👀 Слежу за jsx/utils ...');
utilsWatcher.on('all', (event, filePath) => {
	if (event === 'addDir' || event === 'unlinkDir') return;
	if (!SUPPORTED_EXT.includes(path.extname(filePath))) return;
	console.log(`🔁 ${event}: utils/${path.relative(utilsDir, filePath)} → пересборка всех entry`);
	schedule('__utils__', rebuildAllEntries);
});
