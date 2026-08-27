// Массовые действия по папке зеркала — одна реализация на все точки входа.
//
// Точек три, и все обязаны вести себя одинаково: пункт контекстного меню, клик по
// значку папки и (в будущем) кнопка в модалке «Информация». Развести их по трём
// файлам значило бы получить три разных диалога подтверждения — и три разных
// представления человека о том, что сейчас произойдёт.
//
// ── Почему всегда спрашиваем ────────────────────────────────────────────────
// Клик по облачку — это рекурсивная гидрация: она может стоить пятьдесят
// гигабайт и час канала. Цифры для вопроса бесплатны (лежат в индексе), поэтому
// молчаливого запуска здесь не бывает: `window.confirm` с числами — тот же приём,
// что у удаления проекта, и по той же причине.
//
// ── Почему в конце ничего не говорим ────────────────────────────────────────
// Итог виден сразу и без слов: значки в строках уходят в «скачивается», кнопка
// синхронизации в верхней панели показывает очередь и проценты. Модальное «готово»
// после каждого нажатия только мешало бы. Молчим ТОЛЬКО про успех — про отказ,
// про «нечего делать» и про упёршуюся в предохранитель очередь говорим словами.

import { invalidateDirCache } from '@/Store/helpers/readDirContent';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { basename, dirname } from '@/Utils/path';
import { downloadSubtree, subtreePlan, uploadSubtree } from '@/Utils/storageSeam';
import { humanSize, plural } from './syncText';

/** «47 файлов» — счёт по-русски: текст вопроса читают перед согласием на 50 ГБ. */
const файлов = (n: number) => plural(n, ['файл', 'файла', 'файлов']);

/**
 * Перечитать строку папки и её родителя.
 *
 * Значок обязан измениться сразу после действия, иначе человек не понимает,
 * сработало ли. Событие `storage-changed` из Rust придёт и само, но только когда
 * поедет первый байт, — а между нажатием и первым байтом проходит секунда-две.
 */
export function refreshFolderRows(path: string): void {
	const parent = dirname(path);
	invalidateDirCache(path);
	invalidateDirCache(parent);
	const store = useColumnView_Store.getState();
	store.refreshAffectedColumns('gd', [path, parent]);
	store.refreshAffectedColumns('local', [path, parent]);
}

/** Строка про то, что массовая операция не тронет. Пусто — трогать нечего. */
function неразобранное(count: number): string {
	if (count === 0) return '';
	return (
		`\n${файлов(count)} ${count === 1 ? 'требует' : 'требуют'} разбора (конфликт или ошибка) — ` +
		`их массовая операция не трогает, они решаются по одному стрелками в строке.`
	);
}

/**
 * Скачать папку целиком: докачать всё, чего здесь нет.
 *
 * `pin` — заодно «оставить оффлайн». Без него скачанное живёт по правилам кэша и
 * через несколько часов вытесняется по таймеру: человек, скачавший папку ради
 * работы в дороге, обнаружил бы пустоту. Поэтому про кэш сказано прямо в вопросе.
 */
export async function downloadFolder(path: string, pin = false): Promise<void> {
	const name = basename(path) || path;
	try {
		const plan = await subtreePlan(path);
		if (!plan) {
			window.alert(`«${name}» — не папка облачного зеркала, скачивать нечего.`);
			return;
		}
		if (!plan.known) {
			window.alert(
				`Каталог проекта ещё не загружен — сколько здесь файлов, неизвестно.\n` +
					`Нажмите «Обновить» на папке и повторите.`,
			);
			return;
		}
		if (plan.missingFiles === 0) {
			window.alert(
				`В «${name}» скачивать нечего: ${файлов(plan.files)} — уже на диске.` +
					неразобранное(plan.unresolved),
			);
			return;
		}

		const строки = [
			`Скачать «${name}»${pin ? ' и оставить оффлайн' : ''}?`,
			'',
			`${файлов(plan.missingFiles)}, ${humanSize(plan.missingBytes)} — вместе со вложенными папками.`,
			plan.localFiles > 0 ? `${файлов(plan.localFiles)} уже на диске, их не трогаем.` : '',
			неразобранное(plan.unresolved),
			'',
			pin
				? 'Оставленное оффлайн вытеснение по таймеру не тронет — папка останется на диске.'
				: 'Копии живут по правилам кэша и через несколько часов вытесняются. Чтобы папка осталась на диске, есть пункт «Скачать и оставить оффлайн».',
		];
		if (!window.confirm(строки.filter(Boolean).join('\n'))) return;

		const r = await downloadSubtree(path, pin);
		if (r?.capped) {
			window.alert(
				`Поставлено в очередь ${файлов(r.queued)} — это предел одной операции.\n` +
					`Остальное доберётся повторным «Скачать папку», когда очередь опустеет.`,
			);
		}
	} catch (err) {
		window.alert(`Не удалось скачать «${name}»:\n\n${String(err)}`);
	} finally {
		refreshFolderRows(path);
	}
}

/** Отправить папку целиком: залить всё, чего нет в облаке. */
export async function uploadFolder(path: string): Promise<void> {
	const name = basename(path) || path;
	try {
		const plan = await subtreePlan(path);
		if (!plan) {
			window.alert(`«${name}» — не папка облачного зеркала, отправлять нечего.`);
			return;
		}
		if (plan.uploadFiles === 0) {
			window.alert(
				`Из «${name}» отправлять нечего — всё содержимое уже в облаке.` +
					неразобранное(plan.unresolved),
			);
			return;
		}

		const строки = [
			`Отправить «${name}» в облако?`,
			'',
			`${файлов(plan.uploadFiles)}, ${humanSize(plan.uploadBytes)} — те, которых в облаке нет или которые правили здесь.`,
			неразобранное(plan.unresolved),
		];
		if (!window.confirm(строки.filter(Boolean).join('\n'))) return;

		await uploadSubtree(path);
	} catch (err) {
		window.alert(`Не удалось отправить «${name}»:\n\n${String(err)}`);
	} finally {
		refreshFolderRows(path);
	}
}
