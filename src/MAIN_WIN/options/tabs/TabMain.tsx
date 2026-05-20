import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Checkbox, IconButton, MenuItem, Select, TextField, Typography } from '@mui/material';
import { AlertTriangle, CheckCircle, RefreshCw, Trash2 } from 'lucide-react';
import { appSettings_client } from '@/Store/Settings/appSettings_client';
import { pathPattern_store, typeOfNodes_store } from '@/Store/MainWin/pathPattern_store';
import { cyanColor, greyColor } from '@/Store/Color/grayColor';
import MySettingRow from './settings/MySettingRow';
import MyTooltip from '@/MAIN_WIN/Universal/MyTooltip';
import MyAutocomplete from '@/MAIN_WIN/Universal/MyAutocomplete';
import { filePathNamePattern } from '@/NODE_WIN/utils/searchTypes';
import { COLOR_TYPE_EXCLUDED, COLOR_TYPE_REQUIRES_EXECUTABLE } from '@/types/appSettings';
import type { AppSettings, AppSettingsPatch } from '@/types/appSettings';

const CUSTOM_FOLDER = 'Custom Folder...';

// Глубокий мердж по одному уровню — соответствует тому, что делает main-сторона
// в patchAppSettings. Использовать только для AppSettingsPatch.
function mergePatch(prev: AppSettings, p: AppSettingsPatch): AppSettings {
	const next = { ...prev } as AppSettings;
	for (const key of Object.keys(p) as Array<keyof AppSettingsPatch>) {
		const val = (p as any)[key];
		if (val && typeof val === 'object' && !Array.isArray(val)) {
			(next as any)[key] = { ...((prev as any)[key] ?? {}), ...val };
		} else {
			(next as any)[key] = val;
		}
	}
	return next;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<Box sx={{ mb: 2, pb: 1.5, borderBottom: `1px solid ${greyColor(22)}` }}>
			<Typography
				sx={{
					color: cyanColor(80),
					fontSize: '0.95rem',
					fontWeight: 600,
					mb: 0.8,
					textTransform: 'uppercase',
					letterSpacing: '0.5px',
				}}
			>
				{title}
			</Typography>
			<Box sx={{ display: 'flex', flexDirection: 'column' }}>{children}</Box>
		</Box>
	);
}

interface TabMainProps {
	// Черновик настроек, поднят в OptionsPopover. Все правки идут в draft локально,
	// фактическое сохранение в файл происходит при закрытии модалки кликом вне (commit).
	// Esc закрывает без commit'а — изменения отбрасываются.
	draft: AppSettings;
	setDraft: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export default function TabMain({ draft, setDraft }: TabMainProps) {
	// Алиас, чтобы не править все обращения по JSX.
	const settings = draft;
	// Локальный patch — мутирует только draft, в стор/IPC ничего не уходит до commit'а.
	const patch = (p: AppSettingsPatch): Promise<void> => {
		setDraft((prev) => mergePatch(prev, p));
		return Promise.resolve();
	};
	// ColorTypes остаются через стор напрямую — отдельный файл, отдельная логика,
	// клик-действия (добавить/удалить тип) применяются сразу.
	const { colorTypes, loaded, load, rescanColorTypes, setColorTypes, removeColorType } = appSettings_client();

	const nodeTypes = typeOfNodes_store((s) => s.patternStore);
	const nodeTypesAdd = typeOfNodes_store((s) => s.addPatternElement);
	const nodeTypesRemove = typeOfNodes_store((s) => s.removePatternElement);

	// Маски, доступные для вкомпоновки в путь архива.
	// Плюс триггер Custom Folder... для выбора произвольной папки.
	const pathPatterns = pathPattern_store((s) => s.patternStore);
	// Системные маски (filePathNamePattern) имеют приоритет над пользовательскими паттернами.
	// Дедупликация по имени убирает дубли когда пользователь случайно добавил $projectName.
	const archiveOptions = useMemo(() => {
		const seen = new Set<string>();
		const out: string[] = [CUSTOM_FOLDER];
		for (const name of filePathNamePattern) {
			if (seen.has(name)) continue;
			seen.add(name);
			out.push(name);
		}
		for (const p of pathPatterns) {
			if (seen.has(p.name)) continue;
			seen.add(p.name);
			out.push(p.name);
		}
		if (!seen.has('#historyValue(pathBD)')) out.push('#historyValue(pathBD)');
		return out;
	}, [pathPatterns]);

	const [newTypeName, setNewTypeName] = useState('');

	// Пути исполняемых файлов — для отображения статуса в строках ресурсного пула.
	// Структура: [{ id, name, path: string[] }]. Нас интересует path[0] — первый путь.
	const [execPaths, setExecPaths] = useState<Record<string, string>>({});

	useEffect(() => {
		if (!loaded) load();
	}, [loaded, load]);

	useEffect(() => {
		window.electronAPI
			.invoke('program_paths_get')
			.then((raw: unknown) => {
				const map: Record<string, string> = {};
				if (Array.isArray(raw)) {
					for (const entry of raw) {
						const id = (entry as any)?.id ?? (entry as any)?.name ?? '';
						const p = Array.isArray((entry as any)?.path) ? (entry as any).path[0] : (entry as any)?.path;
						if (id && typeof p === 'string') map[id] = p;
					}
				}
				setExecPaths(map);
			})
			.catch(() => {});
	}, []);

	// Мерджим colorTypes (из main-файла) с typeOfNodes_store (renderer).
	// Исключаем ffplay и другие нежелательные типы.
	const mergedTypes = useMemo(() => {
		const excluded = new Set(COLOR_TYPE_EXCLUDED);
		const byName = new Map(
			colorTypes.types
				.filter((t) => !excluded.has(t.name))
				.map((t) => [t.name, { ...t }]),
		);
		for (const nt of nodeTypes) {
			if (!byName.has(nt.name) && !excluded.has(nt.name)) {
				byName.set(nt.name, { name: nt.name, defaultLimit: 1, orphan: true });
			}
		}
		const arr = Array.from(byName.values());
		arr.sort((a, b) => {
			if (a.orphan !== b.orphan) return a.orphan ? 1 : -1;
			return a.name.localeCompare(b.name);
		});
		return arr;
	}, [colorTypes.types, nodeTypes]);

	const updatePoolLimit = (name: string, limit: number) => {
		patch({ resourcePools: { ...settings.resourcePools, [name]: Math.max(1, limit) } });
	};

	const addNewType = async () => {
		const name = newTypeName.trim();
		if (!name) return;
		if (mergedTypes.some((t) => t.name === name)) {
			setNewTypeName('');
			return;
		}
		// 1) Main-сайд: colorTypes.json
		const next = {
			...colorTypes,
			types: [...colorTypes.types, { name, defaultLimit: 1, orphan: true }],
		};
		await setColorTypes(next);
		// 2) Renderer: typeOfNodes_store (чтобы тип появился во вкладке Nodes)
		if (!nodeTypes.some((n) => n.name === name)) {
			nodeTypesAdd(name, [], undefined);
		}
		setNewTypeName('');
	};

	const deleteType = async (name: string) => {
		// 1) Удаляем из colorTypes.json
		await removeColorType(name);
		// 2) Чистим лимит
		if (settings.resourcePools[name] !== undefined) {
			const pools = { ...settings.resourcePools };
			delete pools[name];
			await patch({ resourcePools: pools });
		}
		// 3) Удаляем из typeOfNodes_store (по id)
		const entry = nodeTypes.find((n) => n.name === name);
		if (entry) nodeTypesRemove(entry.id);
	};

	// ================== Templates ==================
	const [templates, setTemplates] = useState<Array<{ id: string; label: string }>>([]);

	useEffect(() => {
		window.templates
			.list()
			.then(setTemplates)
			.catch(() => {});
	}, []);

	// ================== Storage helpers ==================
	const handleArchivePathChange = async (index: number, value: string[]) => {
		let next = value;
		if (value.includes(CUSTOM_FOLDER)) {
			try {
				const res: any = await window.electronAPI.invoke('selectFolders', {
					multiSelect: false,
				});
				const picked = Array.isArray(res) ? res[0] : res;
				next = value.map((v) => (v === CUSTOM_FOLDER ? picked : v)).filter((v): v is string => typeof v === 'string' && v.length > 0);
			} catch {
				next = value.filter((v) => v !== CUSTOM_FOLDER);
			}
		}
		const updated = [...settings.storage.localArchives];
		updated[index] = { ...updated[index], path: next };
		patch({ storage: { localArchives: updated } });
	};

	const handleAddArchive = () => {
		const updated = [...settings.storage.localArchives];
		updated.push({
			enabled: true,
			path: [],
			templateId: templates[0]?.id ?? 'local-archive',
		});
		patch({ storage: { localArchives: updated } });
	};

	const handleRemoveArchive = (index: number) => {
		const updated = settings.storage.localArchives.filter((_, i) => i !== index);
		patch({ storage: { localArchives: updated } });
	};

	const handleArchiveChange = (index: number, field: 'enabled' | 'templateId', value: unknown) => {
		const updated = [...settings.storage.localArchives];
		if (field === 'enabled') {
			updated[index] = { ...updated[index], enabled: value as boolean };
		} else if (field === 'templateId') {
			updated[index] = { ...updated[index], templateId: value as string };
		}
		patch({ storage: { localArchives: updated } });
	};

	return (
		<Box>
			{/* ============ ОСНОВНЫЕ ============ */}
			<Section title='Основные'>
				<MySettingRow
					label='Максимальное кол-во одновременно запущенных процессов'
					tooltip='Сколько items обрабатывается параллельно в рамках одной сессии. Применяется при старте сканирования.'
					type='number'
					value={settings.processing.maxParallel}
					onChange={(v) => patch({ processing: { maxParallel: v } })}
					min={1}
				/>
				<MySettingRow
					label='Авто-удаление старых папок'
					tooltip='Поддиректории рабочей папки старше указанного числа дней удаляются bottom-up после каждого скана. 0 — выключено.'
					type='number'
					value={settings.cleanup.retentionDays ?? 0}
					onChange={(v) => patch({ cleanup: { retentionDays: v > 0 ? v : null } })}
					unit='дней'
				/>
				<MySettingRow
					label='Авто-отключение проектов'
					tooltip='Если папка OUT проекта не модифицировалась более указанного числа дней, проект автоматически отключается (чекбокс снимается). Если в главной папке не остаётся включённых проектов — она тоже отключается. 0 — выключено.'
					type='number'
					value={settings.cleanup.autoDisableDays ?? 0}
					onChange={(v) => patch({ cleanup: { autoDisableDays: v > 0 ? v : null } })}
					unit='дней'
				/>
				<MySettingRow
					label='Размер буфера логов'
					tooltip='Сколько записей хранится в памяти для окна логов. При переполнении старые вытесняются.'
					type='number'
					value={settings.logging.bufferSize}
					onChange={(v) => patch({ logging: { bufferSize: v } })}
					unit='записей'
					min={100}
				/>
			</Section>

			{/* ============ РАСПИСАНИЕ СКАНИРОВАНИЯ ============ */}
			<Section title='Расписание сканирования'>
				<MySettingRow
					label='Максимальное ожидание между сканами'
					tooltip='Идеальный интервал между стартами сканов. Если предыдущий скан был быстрым — следующий начнётся через это время. Допустимо дробное (например, 0.5 = 30 сек).'
					type='number'
					value={settings.scanSchedule.maxScanWaitMin}
					onChange={(v) => patch({ scanSchedule: { maxScanWaitMin: v } })}
					unit='мин'
					min={0}
				/>
				<MySettingRow
					label='Минимальное ожидание между сканами'
					tooltip='Floor для случая, когда сам скан длился дольше maxScanWait — следующий запустится через этот интервал, а не моментально. Допустимо дробное.'
					type='number'
					value={settings.scanSchedule.minScanWaitMin}
					onChange={(v) => patch({ scanSchedule: { minScanWaitMin: v } })}
					unit='мин'
					min={0}
				/>
				<MySettingRow
					label='Задержка между папками внутри скана'
					tooltip='Пауза между обработкой соседних папок внутри одного скана. Снижает пиковую нагрузку на диск.'
					type='number'
					value={settings.scanSchedule.foldersDelayMs}
					onChange={(v) => patch({ scanSchedule: { foldersDelayMs: v } })}
					unit='мс'
				/>
			</Section>

			{/* ============ РЕСУРСНЫЕ ПУЛЫ ============ */}
			<Section title='Ресурсные пулы'>
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
					<Typography sx={{ color: greyColor(55), fontSize: '0.82rem', flex: 1 }}>
						Лимиты одновременных шагов по типу ноды (colorType). Применяются при старте.
					</Typography>
					<MyTooltip text='Обновить — пересканит установленные плагины и добавит новые colorType. Уже добавленные типы без плагинов помечаются «не используется», но не удаляются автоматически.' />
					<Button
						size='small'
						variant='outlined'
						startIcon={<RefreshCw size={13} />}
						onClick={() => rescanColorTypes()}
						sx={{ textTransform: 'none', fontSize: '0.78rem', py: 0.2 }}
					>
						Обновить
					</Button>
				</Box>
				{colorTypes.lastScannedAt && (
					<Typography sx={{ color: greyColor(40), fontSize: '0.72rem', mb: 0.5 }}>
						Последнее сканирование: {new Date(colorTypes.lastScannedAt).toLocaleString()}
					</Typography>
				)}

				{mergedTypes.map((t) => {
					const limit = settings.resourcePools[t.name] ?? t.defaultLimit ?? 1;
					const execKey = COLOR_TYPE_REQUIRES_EXECUTABLE[t.name];
					const execPath = execKey ? (execPaths[execKey] ?? '') : null;
					// null = не требует исполняемого; '' = требует но не задан; string = задан
					const execOk = execPath === null ? null : execPath.length > 0;

					return (
						<MySettingRow
							key={t.name}
							label={
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
									{execOk === true && (
										<span title={`Путь задан: ${execPath}`} style={{ display: 'flex', alignItems: 'center' }}>
											<CheckCircle size={13} color='#4caf50' />
										</span>
									)}
									{execOk === false && (
										<span title='Путь к исполняемому файлу не задан в настройках' style={{ display: 'flex', alignItems: 'center' }}>
											<AlertTriangle size={13} color='#e8a838' />
										</span>
									)}
									<span style={{ color: t.orphan ? greyColor(45) : undefined }}>
										{t.name + (t.orphan ? ' — не используется' : '')}
									</span>
								</Box>
							}
							type='number'
							value={limit}
							onChange={(v) => updatePoolLimit(t.name, v)}
							min={1}
							trailing={
								t.orphan ? (
									<IconButton
										size='small'
										onClick={() => deleteType(t.name)}
										sx={{ p: 0.25, color: greyColor(45), '&:hover': { color: '#d65a5a' } }}
										title='Удалить тип'
									>
										<Trash2 size={14} />
									</IconButton>
								) : null
							}
						/>
					);
				})}

				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
					<TextField
						size='small'
						variant='standard'
						placeholder='новый тип'
						value={newTypeName}
						onChange={(e) => setNewTypeName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') addNewType();
						}}
						sx={{ width: 220 }}
					/>
					<Button size='small' variant='outlined' onClick={addNewType} sx={{ textTransform: 'none', fontSize: '0.78rem', py: 0.2 }}>
						+ Добавить
					</Button>
				</Box>
			</Section>

			{/* ============ ЛОКАЛЬНЫЙ АРХИВ ============ */}
			<Section title='Локальный архив'>
				{settings.storage.localArchives.map((archive, idx) => (
					<Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
						<Checkbox
							size='small'
							checked={archive.enabled}
							onChange={(e) => handleArchiveChange(idx, 'enabled', e.target.checked)}
							sx={{ p: 0.5 }}
						/>
						<Box sx={{ flex: 1, minWidth: 260 }}>
							<MyAutocomplete
								options={archiveOptions}
								value={archive.path}
								multiSelect={true}
								allowDuplicates={false}
								optionsOnly={false}
								onChange={(v) => handleArchivePathChange(idx, v)}
							/>
						</Box>
						<Select
							size='small'
							variant='standard'
							value={templates.some((t) => t.id === archive.templateId) ? archive.templateId : ''}
							onChange={(e) => handleArchiveChange(idx, 'templateId', e.target.value)}
							sx={{ width: 200, fontSize: '0.9rem' }}
						>
							{templates.map((t) => (
								<MenuItem key={t.id} value={t.id}>
									{t.label}
								</MenuItem>
							))}
						</Select>
						<IconButton size='small' onClick={() => handleRemoveArchive(idx)}>
							<Trash2 size={16} />
						</IconButton>
					</Box>
				))}
				<Box sx={{ display: 'flex', flexDirection: 'row' }}>
					<Button size='small' variant='outlined' onClick={handleAddArchive} sx={{ mt: 1, textTransform: 'none', flexGrow: 1 }}>
						+ Добавить архив
					</Button>
					<MyTooltip text='Динамический список локальных архивов. Каждый архив имеет чекбокс (включить/выключить), маску пути и шаблон сохранения. Нажмите «+ Добавить архив» для новой записи.' />
				</Box>
			</Section>

			{/* ============ ОНЛАЙН-БД ============ */}
			<Section title='Онлайн-БД'>
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
					<Checkbox
						size='small'
						checked={settings.storage.onlineDb.enabled}
						onChange={(e) =>
							patch({
								storage: {
									onlineDb: { ...settings.storage.onlineDb, enabled: e.target.checked },
								},
							})
						}
						sx={{ p: 0.5 }}
					/>
					<TextField
						size='small'
						variant='standard'
						placeholder='https://...'
						value={settings.storage.onlineDb.url}
						onChange={(e) =>
							patch({
								storage: {
									onlineDb: { ...settings.storage.onlineDb, url: e.target.value },
								},
							})
						}
						sx={{ flex: 1, minWidth: 260, '& input': { fontSize: '0.9rem' } }}
					/>
					<Select
						size='small'
						variant='standard'
						value={templates.some((t) => t.id === settings.storage.onlineDb.templateId) ? settings.storage.onlineDb.templateId : ''}
						onChange={(e) =>
							patch({
								storage: {
									onlineDb: {
										...settings.storage.onlineDb,
										templateId: e.target.value,
									},
								},
							})
						}
						sx={{ width: 200, fontSize: '0.9rem' }}
					>
						{templates.map((t) => (
							<MenuItem key={t.id} value={t.id}>
								{t.label}
							</MenuItem>
						))}
					</Select>
					<MyTooltip text='Чекбокс включает отправку, URL — адрес БД, Шаблон — форма записи. Механизм отправки пока не реализован, поле сохраняется для будущей интеграции.' />
				</Box>
			</Section>
		</Box>
	);
}
