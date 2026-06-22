import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';
import { useColumnFocus_store } from '@/Store/MainWin/columnFocus_store';
import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { prefetchDir } from '@/Store/helpers/readDirContent';
import { ListItem, Checkbox, ListItemText, IconButton, TextField } from '@mui/material';
import { Settings } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import useFoldersFromLS from '../hooks/useFoldersFromLS';
import { useEditableField } from '@/hooks/useEditableField';
import { joinPath } from '@/Utils/joinPath';
import { getProjectActivity, setProjectActivity } from '@/Utils/projectActivityLS';
import { getAppSettings } from '@/Store/Settings/appSettings_client';
import { commands, unwrap } from '@/Utils/specta';

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
	const listItemRef = useRef<HTMLLIElement>(null);

	const activeMainFolder = setActiveFolders_store((s) => s.activeMainFolder);
	const scrollToProjectFolder = setActiveFolders_store((s) => s.scrollToProjectFolder);
	const renameProjectRequest = setActiveFolders_store((s) => s.renameProjectRequest);
	const isColumnFocused = useColumnFocus_store((s) => s.focusedColumn === 'project');

	const { folders, addFolder, removeFolder } = useFoldersFromLS(activeMainFolder || '');

	const { isEditing, startEditing, inputProps } = useEditableField({
		initialValue: name,
		onSave: async (newName) => {
			const { mainFolderArr, updateParameters } = mainFolders_stor.getState();
			const { activeMainFolder } = setActiveFolders_store.getState();
			const activeMain = mainFolderArr.find((f) => f.id === activeMainFolder);
			if (!activeMain) return;
			const updated = activeMain.projectFolders.map((f: string) => (f === name ? newName : f));
			updateParameters({ id: activeMain.id, projectFolders: updated });
			const oldPath = joinPath(activeMain.path, name);
			const newPath = joinPath(activeMain.path, newName);
			unwrap(await commands.renameFolder(oldPath, newPath));
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
			onMouseEnter={handleMouseEnter}
		>
			<Checkbox checked={onOffVal} onClick={(e) => { e.stopPropagation(); toggleState(onOffVal); }} />
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
	);
});
