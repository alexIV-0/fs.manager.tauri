import { folderPath_store, pathPattern_store, typeOfFile_store } from '@/Store/MainWin/pathPattern_store';
import { usePathStore } from '@/Store/Node/usePathStore';
import { userInputHistory_store } from '@/Store/Node/userInputHistory_store';
import { PatternKeys } from '@/types/searchType';
import { useCallback } from 'react';
import { joinPath } from '@/Utils/joinPath';

export function useResolveOptions(propertyId?: string) {
	const path = usePathStore((s) => s.path);

	const resolveOptions = useCallback(
		async (rawOptions: string[], currentChips?: string[]): Promise<string[]> => {
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
							return [...Object.values(PatternKeys).map((key) => `$${key}`), '$random(', ...customNames];
						}

						case 'folders': {
							const excluded = ['in', 'out'];
							const result = (await window.electronAPI.invoke('getSomeFromFolder', path, [{ type: 'folders', ext: [] }])) as any;

							const folders: string[] = Array.isArray(result) ? result : (result?.folders ?? []);

							return folders.filter((f: string) => !excluded.includes(f.toLowerCase()));
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
							const result = (await window.electronAPI.invoke('getSomeFromFolder', currentDir, [
								{ type: 'folders', ext: [] },
								{ type: 'files', ext: [] },
							])) as { folders: string[]; files: string[] };

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
										const filesArr = (await window.electronAPI.invoke('getSomeFromFolder', folderPath, [
											{ type: 'files', ext: ['bin'] },
										])) as string[] | { files: string[] };
										const files = Array.isArray(filesArr) ? filesArr : (filesArr?.files ?? []);
										allFiles.push(...files);
									} catch {
										// папка недоступна — пропускаем
									}
								}
							}

							return allFiles;
						}

						default:
							console.warn('[useResolveOptions] Неизвестный тег:', tag);
							return [];
					}
				}),
			);

			return resolved.flat();
		},
		[path, propertyId],
	);

	return { resolveOptions };
}
