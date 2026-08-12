import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';
import { useColumnFocus_store } from '@/Store/MainWin/columnFocus_store';
import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { prefetchDir } from '@/Store/helpers/readDirContent';
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
import { isInMirror, renameProjectInCloud, setProjectPaused } from '@/Utils/storageSeam';
import { storageFolderMenuItems } from '@/MAIN_WIN/Storage/useStorageMenuItems';
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
	const mainFolderPath = mainFolders_stor(
		(s) => s.mainFolderArr.find((f) => f.id === activeMainFolder)?.path ?? '',
	);
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
			void setProjectPaused(projectPath, _prev).catch((err) => {
				console.error('Не удалось изменить активность проекта в каталоге:', err);
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
		await deleteItem(joinPath(activeMain.path, name));
		mainFolders_stor.getState().updateParameters({
			id: activeMain.id,
			projectFolders: activeMain.projectFolders.filter((f: string) => f !== name),
		});
		removeFolder(name);
	};

	const cloudItems = storageFolderMenuItems(projectPath, isOnline);

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
			<Checkbox checked={onOffVal} onClick={(e) => { e.stopPropagation(); toggleState(onOffVal); }} />
			{/* Архивный проект: обработка по нему не запускается вообще, и это должно
			    быть видно до того, как человек начнёт искать, почему ничего не
			    происходит. Значок перед именем, приглушённый — состояние, а не
			    предупреждение: архив это нормальное положение дел. */}
			{isArchived && (
				<Tooltip title='В архиве на сайте — обработка не запускается' arrow>
					<Archive size={13} strokeWidth={1} style={{ marginRight: 6, flexShrink: 0, opacity: 0.55 }} />
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

		<ProjectStatsModal
			open={statsOpen}
			onClose={() => setStatsOpen(false)}
			projectName={name}
			projectPath={getProjectPath() ?? ''}
		/>
		</>
	);
});
