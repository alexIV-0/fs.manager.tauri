// syncPostSourcesSidecar — синк options/postSources.json при сохранении флоу с нодами Finder.
//
// postSources.json = СКОМПИЛИРОВАННЫЙ build-артефакт (источник истины — граф в options.json).
// Единый (платформо-generic) сайдкар: каждый Finder несёт свой pipeline (Finder→Poster→…),
// платформа НЕ хранится отдельно — выводится из Poster-ноды в пайплайне (см. posters.ts).
// При сохранении: для каждой ноды-источника `finder` гоним createProcessQueue(flow, finderId)
// → кладём готовую очередь в сайдкар. Драйвер постинга в рантайме options.json НЕ читает:
// берёт из сайдкара пайплайн + конфиг скана и зовёт processItem.
//   - есть хотя бы одна включённая нода finder → пишем postSources.json + создаём папки-источники;
//   - finder'ов нет → удаляем postSources.json (папки не трогаем).
//
// Вызывается из SaveButton/TopPanel сразу после commands.saveFlowToOptionsFolder. Никогда не
// бросает — ошибки только логируются, чтобы не ломать сохранение флоу.

import { commands, unwrap } from '@/Utils/specta';
import { joinPath } from '@/Utils/joinPath';
import { createProcessQueue } from '@/PROCESSING/utils/createProcessQueue';
import { getDescription } from '@/PROCESSING/utils/getDesription';
import { findPoster } from '@/PROCESSING/autoPost/posters';

const FINDER_TYPE = 'finder';

function propValue(node: any, id: string): any {
	const props = node?.data?.properties ?? [];
	return props.find((p: any) => p?.id === id)?.controlProps?.value;
}

function firstStr(v: any, def = ''): string {
	if (Array.isArray(v)) return String(v[0] ?? def);
	return v != null ? String(v) : def;
}

function isAbsPath(p: string): boolean {
	return /^([A-Za-z]:[\\/]|\/)/.test(p);
}

// Свойство папки-источника finder'а. Берём по наличию '#folders' в options (робастно к id),
// иначе fallback по id folder/autocomplete.
function folderProp(node: any): any {
	const props = node?.data?.properties ?? [];
	return (
		props.find((p: any) => Array.isArray(p?.controlProps?.options) && p.controlProps.options.includes('#folders')) ??
		props.find((p: any) => p?.id === 'folder' || p?.id === 'autocomplete')
	);
}

// Резолвит выбранную папку (чипы #folders): относительный субпуть (или абсолют для CustomFolder).
// '..' поднимает на уровень. Драйвер join'ит относительный с projectPath; абсолют берёт как есть.
function resolveFinderFolder(node: any): string {
	const v = folderProp(node)?.controlProps?.value;
	const segs = (Array.isArray(v) ? v : v != null && v !== '' ? [v] : []).map(String);
	if (segs.length && isAbsPath(segs[0])) return segs.join('/');
	const out: string[] = [];
	for (const s of segs) {
		if (s === '../' || s === '..') out.pop();
		else if (s && s !== './') out.push(s);
	}
	return out.length ? out.join('/') : 'VK_post';
}

export async function syncPostSourcesSidecar(path: string, flow: any): Promise<void> {
	try {
		if (!path) return;
		const sidecarPath = joinPath(path, 'options', 'postSources.json');
		const nodes: any[] = Array.isArray(flow?.nodes) ? flow.nodes : [];
		const finderNodes = nodes.filter((n) => n?.type === FINDER_TYPE && n?.data?.disabled !== true);

		// Нет включённых Finder'ов → удалить сайдкар (если есть) и выйти. Папки не трогаем.
		if (finderNodes.length === 0) {
			const exists = unwrap(await commands.checkFilePath(sidecarPath, null));
			if (exists) await commands.deleteItem(sidecarPath);
			return;
		}

		// Базовый description (contact/automationType/discription) — статичен, бакуем один раз.
		let baseDescription: Record<string, any> = {};
		try {
			baseDescription = getDescription(flow);
		} catch (e) {
			console.warn('[syncPostSourcesSidecar] getDescription:', e);
		}

		const finders = finderNodes.map((node) => {
			const folder = resolveFinderFolder(node); // относит. субпуть или абсолют (CustomFolder)
			const searchType = firstStr(propValue(node, 'searchType'), 'video') || 'video';
			const order = firstStr(propValue(node, 'order'), 'by Time') || 'by Time';
			const interval = Number(propValue(node, 'interval')) || 0;
			const dv = propValue(node, 'daysOfWeek');
			const daysOfWeek = Array.isArray(dv) ? dv : [];
			const wv = propValue(node, 'window');
			const windowVal = Array.isArray(wv) && wv.length >= 2 ? [Number(wv[0]), Number(wv[1])] : [0, 1440];
			const deleteAfter = Boolean(propValue(node, 'deleteAfter'));

			// Компиляция подграфа от этого Finder'а (Finder → Poster → downstream).
			const pipeline = createProcessQueue(flow, node.id) as any[];
			// Аккаунт для тайминга интервала в драйвере — из ноды Poster в пайплайне (любая площадка).
			const poster = findPoster(pipeline);
			const account = poster ? firstStr(poster.account) : '';

			return {
				finderId: node.id,
				folder,
				searchType,
				order,
				interval,
				daysOfWeek,
				window: windowVal,
				deleteAfter,
				account,
				pipeline,
			};
		});

		const sidecar = { baseDescription, finders };
		await commands.writeFile(sidecarPath, JSON.stringify(sidecar, null, 2));

		// Создаём папки-источники, чтобы юзеру было куда складывать файлы.
		for (const f of finders) {
			const abs = isAbsPath(f.folder) ? f.folder : joinPath(path, f.folder);
			await commands.testAndCreateFolder(abs).catch(() => {});
		}
	} catch (e) {
		console.error('[syncPostSourcesSidecar] ошибка синка postSources.json:', e);
	}
}
