// Слова и числа про синхронизацию — в одном месте.
//
// Здесь живёт формат, а не логика: размеры, времена и объяснение расхождения.
// Раньше `humanSize` был локальной функцией внутри `SyncStatusButton`, и второй
// потребитель (подсказка у стрелок) неизбежно завёл бы вторую такую же — с чуть
// другими правилами округления. Один формат на всё облако читается как один
// интерфейс, а не как три похожих.

import type { SyncDetail } from '@/bindings';

/** Размер по-человечески. `—` для нуля и неизвестного: соврать «0 Б» хуже. */
export function humanSize(bytes: number | null | undefined): string {
	if (!bytes) return '—';
	if (bytes < 1024) return `${bytes} Б`;
	const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
	let v = bytes / 1024;
	let i = 0;
	while (v >= 1024 && i + 1 < units.length) {
		v /= 1024;
		i += 1;
	}
	return `${v.toFixed(1)} ${units[i]}`;
}

/**
 * «1 файл», «2 файла», «5 файлов» — русский счёт.
 *
 * Мелочь, но текст вопроса читают перед тем, как согласиться скачать 50 ГБ, и
 * «3 файлов требуют разбора» в таком месте выглядит как машинный вывод, которому
 * нельзя доверять.
 */
export function plural(n: number, forms: [string, string, string]): string {
	const mod100 = Math.abs(n) % 100;
	const mod10 = mod100 % 10;
	if (mod100 >= 11 && mod100 <= 14) return `${n} ${forms[2]}`;
	if (mod10 === 1) return `${n} ${forms[0]}`;
	if (mod10 >= 2 && mod10 <= 4) return `${n} ${forms[1]}`;
	return `${n} ${forms[2]}`;
}

/** «2 часа назад» — по этому времени считается вытеснение, и его надо понимать. */
export function sinceText(unixSec: number | null | undefined): string {
	if (!unixSec) return '—';
	const mins = Math.max(0, Math.round((Date.now() / 1000 - unixSec) / 60));
	if (mins < 60) return `${mins} мин назад`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours} ч назад`;
	return `${Math.round(hours / 24)} дн назад`;
}

/** Дата и время коротко: «26 авг 14:32». `null` → «время неизвестно». */
export function whenText(unixSec: number | null | undefined): string {
	if (!unixSec) return 'время неизвестно';
	return new Date(unixSec * 1000).toLocaleString('ru-RU', {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
	});
}

/**
 * Чем объясняется расхождение — строками, которые можно прочитать глазами.
 *
 * ── Зачем это вообще ────────────────────────────────────────────────────────
 * Значок говорит ВЫВОД («в облаке новее»), и до этих строк выбрать действие
 * можно было только на доверии: что с чем сравнили — не показывал никто.
 *
 * ── Чего здесь нет и не будет ───────────────────────────────────────────────
 * Времени файла в облаке: бэкенд его не отдаёт (`origin_mtime` приезжает пустым).
 * Поэтому «в облаке новее» — это вывод по ВЕРСИИ (хэш разошёлся с тем, из которого
 * сделана копия), а не по часам. Подставить сюда любое другое время значило бы
 * соврать в том самом месте, куда человек пришёл за правдой.
 */
export function explainDivergence(d: SyncDetail | null): string[] {
	if (!d) return [];
	const lines: string[] = [];

	lines.push(
		d.localExists
			? `На диске: ${humanSize(d.localSize)} · ${whenText(d.localMtime)}`
			: 'На диске: копии нет',
	);
	lines.push(
		`В облаке: ${humanSize(d.remoteSize)} · ${
			d.remoteMtime ? whenText(d.remoteMtime) : 'время бэкенд не отдаёт'
		}`,
	);
	if (d.syncedAt) {
		lines.push(`Синхронизировано: ${whenText(d.syncedAt)} (${sinceText(d.syncedAt)})`);
	}

	// Вывод движка — словами, теми же, что в подсказке значка.
	const вывод: Partial<Record<NonNullable<SyncDetail['state']>, string>> = {
		stale: 'Версия в облаке сменилась после этой синхронизации — копия отстала.',
		localModified: 'Копию правили после синхронизации, в облаке этой правки нет.',
		conflict: 'Изменилось и здесь, и в облаке: одна из версий будет потеряна.',
		error: 'Последняя передача упала — по значку не видно, в какую сторону.',
	};
	if (d.state && вывод[d.state]) lines.push(вывод[d.state]!);

	return lines;
}
