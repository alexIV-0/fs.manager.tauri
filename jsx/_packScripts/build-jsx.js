import { buildEntry, listEntries, resolveEntry, SUPPORTED_EXT } from './jsx-builder.js';

// Одноразовая сборка ExtendScript (.jsx).
//   node jsx/_packScripts/build-jsx.js          — собрать все entry из jsx/dev
//   node jsx/_packScripts/build-jsx.js <name>   — собрать только jsx/dev/<name>

const arg = process.argv[2];

if (arg) {
	const entryFile = await resolveEntry(arg);
	if (!entryFile) {
		console.error(`❌ Не найден файл jsx/dev/${arg}{${SUPPORTED_EXT.join(',')}}`);
		process.exit(1);
	}
	console.log(`🔨 Сборка jsx: ${entryFile}`);
	await buildEntry(entryFile);
} else {
	const files = await listEntries();
	if (files.length === 0) {
		console.log('ℹ️  В jsx/dev нет файлов для сборки');
		process.exit(0);
	}
	console.log(`🔨 Сборка всех jsx (${files.length})`);
	for (const f of files) {
		await buildEntry(f);
	}
}

console.log('✅ Готово');
