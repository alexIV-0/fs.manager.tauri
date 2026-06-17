import { folderPath_store, pathPattern_store, typeOfFile_store } from '@/Store/MainWin/pathPattern_store';
import { commands, unwrap } from '@/Utils/specta';
import { usePathStore } from '@/Store/Node/usePathStore';
import { userInputHistory_store } from '@/Store/Node/userInputHistory_store';
import { PatternKeys } from '@/types/searchType';
import { useCallback } from 'react';
import { useNodeId, useReactFlow } from '@xyflow/react';
import { joinPath } from '@/Utils/joinPath';

// Поднимается по цепочке parentId. true, если хотя бы один предок — Loop-нода.
// Используется, чтобы скрывать $loopIndex из автокомплита у нод вне циклов.
function isInsideLoop(nodeId: string | null, getNode: (id: string) => any): boolean {
	if (!nodeId) return false;
	let cur = getNode(nodeId);
	while (cur?.parentId) {
		const parent = getNode(cur.parentId);
		if ((parent?.data as any)?.executionType === 'loop') return true;
		cur = parent;
	}
	return false;
}

// Резолвит относительный путь (с ./ ../) против абсолютной базы. Браузеро-безопасно
// (без node:path). Сохраняет стиль сепаратора базы (POSIX '/' или Windows '\').
function resolveRelativePath(base: string, rel: string): string {
	const sep = base.includes('\\') ? '\\' : '/';
	const baseParts = base.split(/[\\/]+/); // ['', 'Users', ...] для POSIX сохраняет ведущий ''
	for (const part of rel.split(/[\\/]+/)) {
		if (part === '' || part === '.') continue;
		if (part === '..') {
			if (baseParts.length > 1) baseParts.pop();
		} else {
			baseParts.push(part);
		}
	}
	return baseParts.join(sep) || sep;
}

export function useResolveOptions(propertyId?: string) {
	const path = usePathStore((s) => s.path);
	// useNodeId() возвращает id ноды, в чьём render-дереве вызван хук. null, если
	// хук дёрнут вне ноды (например, в инспекторе) — тогда $loopIndex просто не появится.
	const nodeId = useNodeId();
	const { getNode } = useReactFlow();

	const resolveOptions = useCallback(
		async (rawOptions: string[], currentChips?: string[], currentText?: string): Promise<string[]> => {
			const resolved = await Promise.all(
				rawOptions.map(async (item) => {
					if (typeof item !== 'string' || !item.startsWith('#')) {
						return [item];
					}

					const tag = item.slice(1);

					// Поддерживает #historyValue и #historyValue(customKey)
					const historyMatch = tag.match(/^historyValue(?:\((.+)\))?$/);
					if (historyMatch) {
						const key = historyMatch[1] ?? propertyId ?? '';
						return key ? (userInputHistory_store.getState().history[key] ?? []) : [];
					}

					// ⚠️ При добавлении нового #tag — также добавить его в HASH_OPTIONS
					// в src/MAIN_WIN/options/PluginBuilderWin/types.ts
					switch (tag) {
						case 'typeOfFile': {
							return typeOfFile_store.getState().patternStore.map((p) => p.name);
						}

						case 'pathPattern':
						case 'filePattern': {
							const customNames = pathPattern_store.getState().patternStore.map((p) => `$${p.name}`);
							// $loopIndex показываем только если нода реально внутри луп-ноды
							// (рантайм-значение есть только там; снаружи токен резолвится в '').
							const insideLoop = isInsideLoop(nodeId, getNode);
							const keys = Object.values(PatternKeys).filter(
								(k) => k !== PatternKeys.loopIndex || insideLoop,
							);
							return [...keys.map((key) => `$${key}`), '$random(', ...customNames];
						}

						case 'folders': {
							if (!path) return [];

							// VSCode-подобная навигация: директорию берём из уже введённого текста
							// (всё до последнего '/'), относительно папки проекта ($projectPathGD).
							// '../' поднимает на уровень выше, '../../' — на два и т.д.
							// Хвост после '/' отфильтрует подстрочный фильтр в автокомплите.
							const text = currentText ?? '';
							const lastSlash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
							const dirPart = lastSlash >= 0 ? text.slice(0, lastSlash) : '';

							const atRoot = dirPart === '' || dirPart === '.';
							const resolvedDir = atRoot ? path : resolveRelativePath(path, dirPart);

							// getSomeFromFolder бросает Err для несуществующей/недоступной папки.
							// Ловим, чтобы одна неудачная директория не уронила весь список опций.
							let folders: string[] = [];
							try {
								const result = unwrap(await commands.getSomeFromFolder(resolvedDir, [
									{ type: 'folders', ext: [] },
								])) as any;
								folders = Array.isArray(result) ? result : (result?.folders ?? []);
							} catch (e) {
								console.warn('[#folders] не удалось прочитать папку:', resolvedDir, e);
							}

							// IN/OUT прячем только в корне проекта — в других папках они валидны.
							if (atRoot) {
								const excluded = ['in', 'out'];
								folders = folders.filter((f: string) => !excluded.includes(f.toLowerCase()));
							}

							// '../' первым пунктом — чтобы можно было подняться кликом, а не только вводом.
							return ['../', ...folders];
						}

						case 'recursiveFF': {
							const basePath = path || '';
							if (!basePath) return ['Select File...'];

							// Фильтруем чипы — убираем 'Select File...' если он там есть
							const validChips = (currentChips ?? []).filter((c) => c !== 'Select File...');

							// Строим путь из чипов
							let currentDir = basePath;
							for (const part of validChips) {
								currentDir = joinPath(currentDir, part);
							}

							// Читаем содержимое текущей директории
							const result = unwrap(await commands.getSomeFromFolder(currentDir, [
								{ type: 'folders', ext: [] },
								{ type: 'files', ext: [] },
							])) as unknown as { folders: string[]; files: string[] };

							const folders = result?.folders ?? [];
							const files = result?.files ?? [];

							return [...folders, ...files, 'Select File...'];
						}

						case 'whisperModels': {
							const folderPaths = folderPath_store.getState().patternStore;
							const allFiles: string[] = [];

							for (const folderEntry of folderPaths) {
								for (const folderPath of folderEntry.path) {
									try {
										const filesArr = unwrap(await commands.getSomeFromFolder(folderPath, [
											{ type: 'files', ext: ['bin'] },
										])) as unknown as string[] | { files: string[] };
										const files = Array.isArray(filesArr) ? filesArr : (filesArr?.files ?? []);
										allFiles.push(...files);
									} catch {
										// папка недоступна — пропускаем
									}
								}
							}

							return allFiles;
						}

						case 'vkAccounts': {
							if (!path) return [];
							// path = "…/mainFolder/projectName" → mainFolderName = предпоследний сегмент
							const parts = path.split(/[\\/]+/).filter(Boolean);
							const mainFolderName = parts.length >= 2 ? parts[parts.length - 2] : '';
							if (!mainFolderName) return [];
							try {
								const res = unwrap(await commands.accountList(mainFolderName, 'vk')) as any;
								const arr = Array.isArray(res) ? res : [];
								return arr
									.map((a: any) => a?.name)
									.filter((n: any): n is string => typeof n === 'string' && n.length > 0);
							} catch (e) {
								console.warn('[#vkAccounts] не удалось получить список аккаунтов:', e);
								return [];
							}
						}

						case 'vkGroups': {
							if (!path) return [];
							const parts = path.split(/[\\/]+/).filter(Boolean);
							const mainFolderName = parts.length >= 2 ? parts[parts.length - 2] : '';
							if (!mainFolderName) return [];
							// выбранный аккаунт — из соседнего поля 'account' этой же ноды
							let accountName = '';
							if (nodeId) {
								const node = getNode(nodeId);
								const nodeProps = (node?.data as any)?.properties ?? [];
								const acc = nodeProps.find((pr: any) => pr.id === 'account');
								accountName = acc?.controlProps?.value ?? '';
							}
							if (!accountName) return [];
							try {
								const token = unwrap(await commands.accountGetToken(mainFolderName, 'vk', accountName));
								const groups = unwrap(await commands.vkGroupsGet(token)) as any;
								const arr = Array.isArray(groups) ? groups : [];
								return arr.map((g: any) => String(g?.name)).filter((n: string) => n && n !== 'null');
							} catch (e) {
								console.warn('[#vkGroups] не удалось получить группы:', e);
								return [];
							}
						}

						default:
							console.warn('[useResolveOptions] Неизвестный тег:', tag);
							return [];
					}
				}),
			);

			return resolved.flat();
		},
		[path, propertyId, nodeId, getNode],
	);

	return { resolveOptions };
}
