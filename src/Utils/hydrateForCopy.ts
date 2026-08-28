// Скачать байты ПЕРЕД файловой операцией — копированием, перемещением, дропом.
//
// ── Что чинит ───────────────────────────────────────────────────────────────
// В облачном зеркале папка существует в каталоге, а на диске её может не быть
// вовсе. `copy_item`/`move_item` копируют ДИСК — поэтому копирование онлайн-папки
// давало пустую структуру: имена вложенных папок на месте, файлов внутри нет, и
// об этом никто не говорил. Копия выглядела удачной.
//
// Пофайловая гидрация в `pasteFromClipboardFs` уже стояла (`ensureLocal` на
// источник), но для ПАПКИ она не делает ничего: `ensure_local` знает только файлы,
// а для логической папки лишь создаёт пустой каталог на диске. Ровно это и
// копировалось.
//
// ── Почему свой обход, а не очередь «Скачать папку» ─────────────────────────
// Очередь из `bulk.rs` сделана для «поставил и забыл»: она ставит работу и сразу
// отвечает числами, а байты везёт демон. Здесь задача обратная — ДОЖДАТЬСЯ: копия
// не имеет права начаться, пока файлов нет на диске. По той очереди этого не
// узнать — счётчики в ней общие (туда могла попасть чужая серия), есть
// предохранитель на 20 000 файлов и молчаливый пропуск конфликтов. Поэтому список
// собирается точно, по каталогу, а везёт его `ensure_local` — то самое «дай байты,
// я жду», на котором держится вся гидрация в программе.
//
// ── Параллельность ──────────────────────────────────────────────────────────
// Два файла разом — ровно как у демона (`DOWNLOAD_WORKERS = 2`). Больше потоков
// канал не ускоряют, а место в очереди на бэкенде делится с фоновой
// синхронизацией, которая в это же время может что-то заливать.

import { hydrateGate_store } from '@/Store/MainWin/hydrateGate_store';
import type { FileState } from '@/bindings';
import { basename, dirname } from '@/Utils/path';
import { browseMirror, ensureLocalStrict, ensureMirrorDir, type MirrorItem } from '@/Utils/storageSeam';

/** Сколько файлов везём одновременно. См. шапку. */
const PARALLEL = 2;

/**
 * Предохранитель на одну операцию: копировать проект на сотню тысяч файлов через
 * пофайловую гидрацию бессмысленно — такое делают «Скачать папку» и потом копируют
 * уже с диска. Молча обрезать нельзя, поэтому об упоре говорим словами.
 */
const MAX_FILES = 20_000;

/** Байтов на диске нет или они устарели — файл надо привезти. */
function нуженФайл(state: FileState | null | undefined): boolean {
	return state === 'cloud' || state === 'stale' || state === 'downloading';
}

/**
 * Расхождение, которое массовая операция трогать не имеет права.
 *
 * Те же два состояния, что и у «Скачать папку» (`bulk.rs`), и по той же причине:
 * в конфликте направление не выводится, а у ошибки не видно, какая половина
 * отвалилась — скачивание могло бы затереть единственную копию работы.
 */
function требуетРазбора(state: FileState | null | undefined): boolean {
	return state === 'conflict' || state === 'error';
}

interface Missing {
	path: string;
	size: number;
}

export interface HydratePlan {
	/** Файлы, которым нужны байты. Пусто — копировать можно прямо сейчас. */
	files: Missing[];
	bytes: number;
	/**
	 * Папки зеркала верхнего уровня из запроса. Их структуру надо материализовать
	 * на диске: пустая вложенная папка в каталоге есть, а на диске её нет — и в
	 * копии она бы просто пропала.
	 */
	dirs: string[];
	/** Конфликты и ошибки: не трогаем, но сказать о них обязаны. */
	unresolved: number;
	/** Упёрлись в предохранитель — список неполный. */
	capped: boolean;
}

/**
 * Что придётся привезти, чтобы скопировать эти пути. Вне зеркала — пустой план.
 *
 * Всё считается по каталогу: ни одного запроса в сеть, ни одного чтения файла.
 * Поэтому для локальных путей вызов стоит один поход в Rust на папку — и то
 * только пока шов не выяснил, что зеркала здесь нет.
 */
export async function planHydration(paths: string[]): Promise<HydratePlan> {
	const plan: HydratePlan = { files: [], bytes: 0, dirs: [], unresolved: 0, capped: false };
	if (paths.length === 0) return plan;

	// Группируем по родителю: листинг каталога отдаёт сразу и тип строки, и её
	// состояние синхронизации, и размер — один запрос на папку вместо трёх на файл.
	const byDir = new Map<string, Set<string>>();
	for (const p of paths) {
		const dir = dirname(p);
		const set = byDir.get(dir) ?? new Set<string>();
		set.add(p.replace(/[\\/]+$/, ''));
		byDir.set(dir, set);
	}

	for (const [dir, wanted] of byDir) {
		const items = await browseMirror(dir);
		// `null` — папка не из зеркала: её содержимое уже на диске.
		if (!items) continue;
		for (const item of items) {
			if (!wanted.has(item.path.replace(/[\\/]+$/, ''))) continue;
			if (item.isDir) plan.dirs.push(item.path);
			await collect(item, plan);
		}
	}

	return plan;
}

/** Обойти строку каталога: файл — посчитать, папку — раскрыть. */
async function collect(item: MirrorItem, plan: HydratePlan): Promise<void> {
	if (plan.files.length >= MAX_FILES) {
		plan.capped = true;
		return;
	}

	if (item.isDir) {
		const kids = await browseMirror(item.path);
		if (!kids) return;
		for (const kid of kids) await collect(kid, plan);
		return;
	}

	const state = item.storage?.state ?? null;
	if (требуетРазбора(state)) {
		plan.unresolved += 1;
		return;
	}
	if (!нуженФайл(state)) return;

	const size = item.storage?.sizeBytes ?? 0;
	plan.files.push({ path: item.path, size });
	plan.bytes += size;
}

/**
 * Привезти всё, чего не хватает, и только потом отдать «можно копировать».
 *
 * `false` — копировать НЕЛЬЗЯ: отменили или часть файлов не приехала. Копия из
 * половины файлов молча выглядела бы как удачная, поэтому частичный результат
 * здесь не пропускается — повторить операцию дешевле, чем найти потом дырявую
 * копию.
 */
export async function hydrateForCopy(paths: string[], title: string): Promise<boolean> {
	const gate = hydrateGate_store.getState();

	// Обход каталога по большому проекту — это секунды, и всё это время на экране
	// не было бы ничего. Но и мигать окном на каждой локальной вставке нельзя:
	// вне зеркала обход заканчивается мгновенно. Поэтому окно показывается только
	// если разбор затянулся.
	const ждунок = window.setTimeout(() => gate.start({ title, total: 0, bytes: 0 }), 300);
	let plan: HydratePlan;
	try {
		plan = await planHydration(paths);
		// Структуру папок достраиваем всегда, даже когда качать нечего:
		// `storage_ensure_dir` создаёт и вложенные папки, известные каталогу, — иначе
		// пустые ветки дерева в копию не попали бы вовсе.
		for (const dir of plan.dirs) await ensureMirrorDir(dir);
	} finally {
		window.clearTimeout(ждунок);
	}

	// Отменили, пока шёл разбор, — дальше идти незачем.
	if (hydrateGate_store.getState().cancelled) {
		gate.stop();
		return false;
	}

	if (plan.files.length === 0) {
		gate.stop();
		// Разбор нужен, а качать нечего: скопируется то, что лежит на диске. Молчать
		// нельзя — человек должен знать, что часть файлов поехала в старой версии.
		if (plan.unresolved > 0) {
			window.alert(
				`${plan.unresolved} файл(ов) требуют разбора (конфликт или ошибка синхронизации).\n` +
					`Копируется то, что лежит на диске: их версии в облаке не трогаем.`,
			);
		}
		return true;
	}

	if (plan.capped) {
		gate.stop();
		window.alert(
			`Здесь больше ${MAX_FILES} нескачанных файлов — столько за одну операцию не тянем.\n\n` +
				`Скачайте папку целиком («Скачать папку из облака…»), дождитесь очереди и повторите копирование.`,
		);
		return false;
	}

	// Тот же `start`, теперь с числами: он же и сбрасывает счётчики серии.
	gate.start({ title, total: plan.files.length, bytes: plan.bytes });

	let next = 0;
	const failed: string[] = [];

	const worker = async (): Promise<void> => {
		for (;;) {
			// Отмену читаем между файлами: рвать начатую передачу незачем — она
			// докачается и ляжет в зеркало, как любая другая.
			if (hydrateGate_store.getState().cancelled) return;
			const i = next++;
			if (i >= plan.files.length) return;

			const file = plan.files[i];
			hydrateGate_store.getState().setCurrent(basename(file.path));
			let ok = true;
			try {
				// `ensureLocalStrict`, а не `ensureLocal`: мягкий вариант глотает сбой и
				// возвращает путь — копирование пошло бы дальше по несуществующему файлу.
				const outcome = await ensureLocalStrict(file.path);
				// Путь мы взяли из каталога, значит «не в зеркале» здесь означает не
				// «локальный файл», а «байтов взять негде»: запись есть, ключа в облаке
				// нет. Молча пропустить такой файл — оставить дырку в копии.
				if (outcome === 'notInMirror') {
					ok = false;
					failed.push(`${basename(file.path)} — байтов нет в облаке (запись без ключа)`);
				}
			} catch (err) {
				ok = false;
				failed.push(`${basename(file.path)} — ${String(err)}`);
			}
			hydrateGate_store.getState().advance({ bytes: file.size, ok });
		}
	};

	await Promise.all(Array.from({ length: Math.min(PARALLEL, plan.files.length) }, worker));

	const cancelled = hydrateGate_store.getState().cancelled;
	hydrateGate_store.getState().stop();

	if (cancelled) return false;

	if (failed.length > 0) {
		window.alert(
			`Не скачалось файлов: ${failed.length}. Копирование отменено — неполная копия выглядела бы как удачная.\n\n` +
				failed.slice(0, 5).join('\n') +
				(failed.length > 5 ? `\n…и ещё ${failed.length - 5}` : ''),
		);
		return false;
	}

	return true;
}
