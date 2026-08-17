import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';
import { useColumnFocus_store } from '@/Store/MainWin/columnFocus_store';
import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { prefetchDir, invalidateDirCache } from '@/Store/helpers/readDirContent';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { ListItem, Checkbox, ListItemText, IconButton, TextField, Tooltip } from '@mui/material';
import { Archive, Settings } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import useFoldersFromLS from '../hooks/useFoldersFromLS';
import { useEditableField } from '@/hooks/useEditableField';
import { joinPath } from '@/Utils/joinPath';
import { getProjectActivity, setProjectActivity } from '@/Utils/projectActivityLS';
import { getAppSettings } from '@/Store/Settings/appSettings_client';
import { commands, unwrap } from '@/Utils/specta';
import { clipboardFs_store } from '@/Store/MainWin/clipboardFs_store';
import { archivedProjects_store } from '@/Store/MainWin/archivedProjects_store';
import { isInMirror, renameProjectInCloud, setProjectPaused, purgeProject, projectCloudStats } from '@/Utils/storageSeam';
import { storageFolderMenuItems, storageProjectMenuItems } from '@/MAIN_WIN/Storage/useStorageMenuItems';
import { useContextMenu } from '../hooks/useContextMenu';
import { useMenuItems } from '../hooks/useMenuItems';
import { FileFolderContextMenu } from '../FileExplorerColumn/ContextMenu/FileFolderContextMenu';
import {
	copyPath,
	showInFinder,
	deleteItem,
	createFolder,
	copyToClipboardFs,
	cutToClipboardFs,
	pasteFromClipboardFs,
} from '@/PROCESSING/utils/fileSystemActions';
import { ProjectStatsModal } from './ProjectStatsModal';

export const ProjectFolderItem = memo(function ProjectFolderItem({
	name,
	isActive,
	refreshKey,
}: {
	name: string;
	isActive: boolean;
	refreshKey?: number;
}) {
	const [onOffVal, setOnOffVal] = useState(true);
	const [statsOpen, setStatsOpen] = useState(false);
	const listItemRef = useRef<HTMLLIElement>(null);

	const activeMainFolder = setActiveFolders_store((s) => s.activeMainFolder);
	const scrollToProjectFolder = setActiveFolders_store((s) => s.scrollToProjectFolder);
	const renameProjectRequest = setActiveFolders_store((s) => s.renameProjectRequest);
	const isColumnFocused = useColumnFocus_store((s) => s.focusedColumn === 'project');

	const { folders, addFolder, removeFolder } = useFoldersFromLS(activeMainFolder || '');

	// Путь проекта собираем из активной главной папки: колонка проектов знает только
	// имена, а архивность живёт в каталоге и привязана к пути.
	const mainFolderPath = mainFolders_stor((s) => s.mainFolderArr.find((f) => f.id === activeMainFolder)?.path ?? '');
	// Онлайн-проект: имя живёт в каталоге сайта, а не в имени папки на диске.
	// Переименовать его локально нельзя — путь перестанет разбираться, и значки
	// синхронизации исчезнут (ровно это и случилось при первой проверке).
	const [isOnline, setIsOnline] = useState(false);
	// Ref рядом со state: `onSave` из `useEditableField` замыкается один раз, и
	// прочитал бы состояние первого рендера — то есть страховка молча не работала бы.
	const isOnlineRef = useRef(false);
	useEffect(() => {
		if (!mainFolderPath) return;
		let alive = true;
		void isInMirror(mainFolderPath).then((v) => {
			if (!alive) return;
			isOnlineRef.current = v;
			setIsOnline(v);
		});
		return () => {
			alive = false;
		};
	}, [mainFolderPath]);

	const projectPath = mainFolderPath ? joinPath(mainFolderPath, name) : '';

	const isArchived = archivedProjects_store((s) =>
		Boolean(mainFolderPath && s.paths[`${mainFolderPath}/${name}`.replace(/[\\/]+$/, '').toLowerCase()]),
	);

	const { isEditing, startEditing, inputProps } = useEditableField({
		initialValue: name,
		onSave: async (newName) => {
			const { mainFolderArr, updateParameters } = mainFolders_stor.getState();
			const { activeMainFolder } = setActiveFolders_store.getState();
			const activeMain = mainFolderArr.find((f) => f.id === activeMainFolder);
			if (!activeMain) return;
			const oldPath = joinPath(activeMain.path, name);
			const newPath = joinPath(activeMain.path, newName);

			// Онлайн-проект: имя живёт в каталоге, поэтому команда идёт в бэкенд, а
			// папка зеркала переезжает следом. Локальная папка — как раньше.
			// Список в сторе обновляем ПОСЛЕ успеха: иначе при отказе сервера в колонке
			// останется имя, которого нет ни на диске, ни в каталоге.
			try {
				if (isOnlineRef.current) {
					await renameProjectInCloud(oldPath, newName);
				} else {
					unwrap(await commands.renameFolder(oldPath, newPath));
				}
			} catch (err) {
				console.error('Не удалось переименовать проект:', err);
				window.alert(`Не удалось переименовать проект:\n${String(err)}`);
				return;
			}
			const updated = activeMain.projectFolders.map((f: string) => (f === name ? newName : f));
			updateParameters({ id: activeMain.id, projectFolders: updated });
		},
	});

	function toggleState(_prev: boolean) {
		if (_prev) {
			addFolder(name);
		} else {
			removeFolder(name);
			reactivateOnManualEnable();
		}
		setOnOffVal(!_prev);

		// Онлайн-проект: активность живёт в каталоге (`projects.is_paused`), значит её
		// надо туда и записать — иначе выключение здесь сайт не увидит, а следующий
		// `/projects` вернёт галочку обратно. Локальные папки как раньше: LS + сайдкар.
		if (isOnlineRef.current && projectPath) {
			void setProjectPaused(projectPath, _prev)
				.then((записано) => {
					// `false` = каталог не признал путь проектом. Для локальной папки это
					// норма, но здесь мы уже знаем, что папка облачная, — значит запись
					// не состоялась, и молчать об этом нельзя: галочка стояла бы в новом
					// положении, а сайт остался бы со старым.
					if (!записано) {
						console.error('[активность] каталог не принял путь проекта:', projectPath);
						window.alert(
							`Проект «${name}» не опознан в облаке — переключение сохранено только локально.`,
						);
					}
				})
				.catch((err) => {
				console.error('Не удалось изменить активность проекта в каталоге:', err);
				// Откатываем галочку: если каталог отказал (нет эндпоинта, нет сети,
				// чужой проект), состояние на сайте не изменилось — а галочка уже
				// стояла бы в новом положении и врала. Следующий `/projects` всё равно
				// вернул бы прежнее значение, то есть переключатель «отскакивал» бы
				// сам собой через две минуты, без объяснений.
				if (_prev) {
					removeFolder(name);
				} else {
					addFolder(name);
				}
				setOnOffVal(_prev);
				window.alert(`Не удалось переключить проект «${name}» в облаке.\n\n${String(err)}`);
			});
		}
	}

	// Двойная логика ручного включения:
	// — папка давно холодная (активность > N дней, т.е. была авто-отключена) →
	//   даём ровно сутки. Если за эти сутки в неё что-то обработается, addedCount>0
	//   поднимет активность до «сейчас» → полные N дней. Если ничего не попало —
	//   на следующем проходе она снова отключится.
	// — свежая папка (активность ≤ N дней) → не трогаем, ведёт себя как обычно.
	// Дату ведём в LS, т.к. mtime папки OUT на gsync ненадёжен (его откатывает синк).
	function reactivateOnManualEnable() {
		const autoDisableDays = getAppSettings().cleanup.autoDisableDays;
		if (!autoDisableDays || autoDisableDays <= 0) return;

		const activeMain = mainFolders_stor.getState().mainFolderArr.find((f) => f.id === activeMainFolder);
		if (!activeMain) return;

		const dayMs = 86_400_000;
		const activity = getProjectActivity(activeMain.id, name);
		// Нет истории — пусть auto-disable засеет «сейчас» (полные N дней).
		if (activity === undefined) return;
		// Свежая папка — оставляем как есть.
		if (Date.now() - activity <= autoDisableDays * dayMs) return;
		// Холодная — сутки до повторного auto-disable.
		setProjectActivity(activeMain.id, name, Date.now() - (autoDisableDays - 1) * dayMs);
	}

	const handleMainClick = () => {
		setActiveFolders_store.getState().setActiveProjectFolder(name);
		useColumnFocus_store.getState().setFocusedColumn('project');
	};

	const handleMouseEnter = () => {
		const { mainFolderArr } = mainFolders_stor.getState();
		const { activeMainFolder } = setActiveFolders_store.getState();
		const activeMain = mainFolderArr.find((f) => f.id === activeMainFolder);
		if (!activeMain) return;
		prefetchDir(joinPath(activeMain.path, name));
	};

	const openOptions = async () => {
		const { mainFolderArr } = mainFolders_stor.getState();
		const { activeMainFolder } = setActiveFolders_store.getState();
		const activeMain = mainFolderArr.find((f) => f.id === activeMainFolder);
		if (!activeMain) return;

		// UI-ноды плагинов окно нод теперь подтягивает само через Rust plugin manager
		// (см. NODE_WIN/index.tsx → loadAllUINodes). Снапшот в localStorage больше не нужен.
		const optionsPath = joinPath(activeMain.path, name);
		window.tauriAPI.invoke('open-node-window', optionsPath);
	};

	// ── Контекстное меню (ПКМ) ──────────────────────────────────────────────
	const menuId = `project-${activeMainFolder ?? ''}-${name}`;
	const { menuPosition, handleContextMenu, handleMenuClose, isMenuOpen } = useContextMenu(menuId);
	const hasClipboard = clipboardFs_store((s) => s.type !== null && s.paths.length > 0);

	// Абсолютный путь проектной папки (main-папка + имя проекта).
	const getProjectPath = (): string | null => {
		const activeMain = mainFolders_stor.getState().mainFolderArr.find((f) => f.id === activeMainFolder);
		return activeMain ? joinPath(activeMain.path, name) : null;
	};

	// Удаление проекта: с диска + из списка main-папки + чистка off-списка LS,
	// иначе в колонке остался бы «призрак» удалённой папки.
	const handleDeleteProject = async () => {
		const activeMain = mainFolders_stor.getState().mainFolderArr.find((f) => f.id === activeMainFolder);
		if (!activeMain) return;
		// Облачный проект так удалить нельзя: его папка — не запись в каталоге файлов, а
		// строка в `projects`, и шов отвечает отказом. Раньше отказ уходил в консоль, а
		// строку из стора всё равно вычищали — выглядело как удаление, хотя не удалялось
		// ничего: ни на диске, ни в облаке.
		if (isOnline) {
			window.alert(
				`«${name}» — облачный проект, его папку нельзя удалить как обычную.\n\n` +
					`Для него есть пункт «Удалить проект полностью…»: он чистит содержимое в облаке ` +
					`и локальную папку. Саму запись проекта удаляют на сайте — программе бэкенд этого не даёт.`,
			);
			return;
		}
		await deleteItem(joinPath(activeMain.path, name));
		mainFolders_stor.getState().updateParameters({
			id: activeMain.id,
			projectFolders: activeMain.projectFolders.filter((f: string) => f !== name),
		});
		removeFolder(name);
	};

	// Выжигание облачного проекта: содержимое в облаке + локальная папка.
	//
	// Строку из колонки НЕ убираем: запись проекта в каталоге остаётся, и следующий
	// `reloadFolders` вернул бы её обратно. Пусть лучше проект честно останется в списке
	// пустым, чем исчезнет и появится снова.
	const handlePurgeProject = async () => {
		const p = getProjectPath();
		if (!p) return;
		handleMenuClose();

		// Спрашиваем с числами: «удалить проект» без объёма человек подтверждает вслепую.
		const stats = await projectCloudStats(p);
		const size = (bytes: number): string => {
			if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} ГБ`;
			if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} МБ`;
			return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
		};
		const объём = stats
			? `${stats.files} файлов (${size(stats.bytes)})`
			: 'всё содержимое (точное число неизвестно — полного обхода проекта ещё не делали)';

		if (
			!window.confirm(
				`Удалить проект «${name}» полностью?\n\n` +
					`В облаке будет удалено ${объём}, на диске — папка проекта целиком.\n` +
					`Восстановить будет нельзя: корзины на стороне сайта пока нет.\n\n` +
					`Сама запись проекта останется — её удаляют на сайте.`,
			)
		) {
			return;
		}

		try {
			const report = await purgeProject(p);
			if (!report) {
				window.alert(`«${name}» не в зеркале — удалять в облаке нечего.`);
				return;
			}

			const локально = report.localRemoved
				? 'убрана с диска'
				: report.localKept
					? `осталась на диске — ${report.localKept}`
					: 'на диске её не было';
			const lines = [
				`Проект «${name}»:`,
				`• в облаке удалено ${report.filesDeleted} файлов (${size(report.freedBytes)})`,
				`• локальная папка ${локально}`,
			];
			if (report.filesLeft > 0) lines.push(`• осталось в облаке: ${report.filesLeft} файлов`);
			if (report.skipped.length > 0) {
				// Список режем: при отвалившейся сети отказ приходит на каждый файл, и
				// окно на тысячу строк не прочитает никто. Полная картина — в отчёте команды.
				lines.push('', 'Бэкенд не отдал:');
				for (const s of report.skipped.slice(0, 10)) lines.push(`• ${s.path} — ${s.error}`);
				if (report.skipped.length > 10) lines.push(`• …и ещё ${report.skipped.length - 10}`);
			}
			lines.push('', 'Запись самого проекта удаляется на сайте.');
			window.alert(lines.join('\n'));
		} catch (err) {
			window.alert(`Не удалось удалить проект «${name}»:\n\n${String(err)}`);
		} finally {
			// Колонки перечитываем в любом случае: часть файлов могла уйти и до отказа.
			invalidateDirCache(p);
			const cols = useColumnView_Store.getState();
			cols.refreshAffectedColumns('gd', [p]);
			cols.refreshAffectedColumns('local', [p]);
		}
	};

	const cloudItems = [
		...storageFolderMenuItems(projectPath, isOnline),
		...storageProjectMenuItems(isOnline, handlePurgeProject),
	];

	const menuItems = useMenuItems({
		type: 'project',
		// специфичные для 2-й колонки
		onOpenNodes: openOptions,
		onOpenStats: () => setStatsOpen(true),
		// зеркало пунктов 3-й колонки
		onRename: () => {
			handleMenuClose();
			// Откладываем на тик, иначе autoFocus TextField тут же теряет фокус.
			setTimeout(() => startEditing(), 0);
		},
		onCopyPath: () => {
			const p = getProjectPath();
			if (p) copyPath(p);
		},
		onShowInFinder: () => {
			const p = getProjectPath();
			if (p) showInFinder(p);
		},
		onDelete: handleDeleteProject,
		onCreateFolder: () => {
			const p = getProjectPath();
			if (p) createFolder(p);
		},
		onCopy: () => {
			const p = getProjectPath();
			if (p) copyToClipboardFs([p]);
		},
		onCut: () => {
			const p = getProjectPath();
			if (p) cutToClipboardFs([p]);
		},
		onPaste: () => {
			const p = getProjectPath();
			if (p) pasteFromClipboardFs(p);
		},
		hasClipboard,
	});

	useEffect(() => {
		setOnOffVal(!folders.includes(name));
	}, [activeMainFolder, name, folders, refreshKey]);

	useEffect(() => {
		if (scrollToProjectFolder === name && listItemRef.current) {
			listItemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
			setActiveFolders_store.getState().setScrollToProjectFolder(null);
		}
	}, [scrollToProjectFolder, name]);

	// Запрос на переименование по Enter из ProjectFolderColumn — входим в режим
	// редактирования и сбрасываем запрос, чтобы он не сработал повторно.
	useEffect(() => {
		if (renameProjectRequest === name && !isEditing) {
			startEditing();
			setActiveFolders_store.getState().setRenameProjectRequest(null);
		}
	}, [renameProjectRequest, name, isEditing, startEditing]);

	return (
		<>
			<ListItem
				ref={listItemRef}
				disablePadding
				sx={{
					height: '34px',
					backgroundColor: isActive ? (isColumnFocused ? '#007bff4c' : 'rgba(150,150,150,0.22)') : 'transparent',
					position: 'relative',
					'&:hover': { backgroundColor: isActive && isColumnFocused ? '#007bff5c' : '#ffffff0b' },
					'&:hover .removeProjectButton': { opacity: 1 },
				}}
				onClick={handleMainClick}
				onContextMenu={(e) => handleContextMenu(e, handleMainClick)}
				onMouseEnter={handleMouseEnter}
			>
				<Checkbox
					checked={onOffVal}
					onClick={(e) => {
						e.stopPropagation();
						toggleState(onOffVal);
					}}
				/>
				{/* Архивный проект: обработка по нему не запускается вообще, и это должно
			    быть видно до того, как человек начнёт искать, почему ничего не
			    происходит. Значок перед именем, приглушённый — состояние, а не
			    предупреждение: архив это нормальное положение дел. */}
				{isArchived && (
					<Tooltip title='В архиве на сайте — обработка не запускается' arrow>
						<Archive size={18} strokeWidth={2} style={{ marginRight: 10, flexShrink: 0, opacity: 0.55 }} />
					</Tooltip>
				)}
				{isEditing ? (
					<TextField
						{...inputProps}
						onKeyDown={(e) => {
							inputProps.onKeyDown(e);
							e.stopPropagation();
						}}
						variant='standard'
						size='small'
						onFocus={(e) => e.target.select()}
						sx={{ flex: 1 }}
					/>
				) : (
					<ListItemText
						onDoubleClick={startEditing}
						sx={{
							whiteSpace: 'nowrap',
							textOverflow: 'ellipsis',
							width: '100%',
							overflow: 'hidden',
							cursor: 'pointer',
							...(isActive && { '& .MuiListItemText-primary': { color: '#64afffff', fontWeight: 600 } }),
						}}
					>
						{name}
					</ListItemText>
				)}
				<IconButton
					className='removeProjectButton'
					sx={{
						p: '1px',
						position: 'absolute',
						top: '50%',
						right: '2px',
						transform: 'translateY(-50%)',
						opacity: 0,
						transition: 'opacity 0.3s',
					}}
					onClick={openOptions}
				>
					<Settings strokeWidth={1} size={20} />
				</IconButton>
			</ListItem>

			<FileFolderContextMenu
				menuId={menuId}
				type='project'
				position={menuPosition}
				open={isMenuOpen}
				onClose={handleMenuClose}
				items={[...menuItems, ...cloudItems]}
			/>

			<ProjectStatsModal open={statsOpen} onClose={() => setStatsOpen(false)} projectName={name} projectPath={getProjectPath() ?? ''} />
		</>
	);
});
