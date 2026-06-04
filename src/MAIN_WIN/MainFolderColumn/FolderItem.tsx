import { Checkbox, IconButton, ListItem, ListItemText } from '@mui/material';
import { ListRestart, X } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';
import { useColumnFocus_store } from '@/Store/MainWin/columnFocus_store';
import { reloadFolders } from '@/PROCESSING/reloadFolders';
import { loadFromLocalStorage } from '@/Utils/loadSaveToLS';
import { basename } from '@/Utils/path';

type FolderItemProps = {
	obj: any;
	isActive?: boolean;
	onClick?: (id: string) => void;
	onRemove?: (id: string) => void;
	onRestart?: (id: string) => void;
	scrollIntoView?: boolean;
};

export const FolderItem = memo(function FolderItem({ obj, isActive = false, onClick, onRemove, onRestart, scrollIntoView = false }: FolderItemProps) {
	const [name, setName] = useState('');
	const listItemRef = useRef<HTMLLIElement>(null);

	const scrollToMainFolder = setActiveFolders_store((s) => s.scrollToMainFolder);
	const isColumnFocused = useColumnFocus_store((s) => s.focusedColumn === 'main');

	useEffect(() => {
		setName(basename(obj.path));
	}, [obj.path]);

	useEffect(() => {
		const shouldScroll = scrollIntoView || scrollToMainFolder === obj.id;
		if (shouldScroll && listItemRef.current) {
			listItemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
			if (scrollToMainFolder === obj.id) {
				setActiveFolders_store.getState().setScrollToMainFolder(null);
			}
		}
	}, [scrollIntoView, scrollToMainFolder, obj.id]);

	const handleRemoveClick = (e: React.MouseEvent) => {
		e.stopPropagation();

		const { mainFolderArr, removeFolderFromMainArr } = mainFolders_stor.getState();
		const { setMainFolderId } = setActiveFolders_store.getState();

		const index = mainFolderArr.findIndex((folder) => folder.id === obj.id);
		removeFolderFromMainArr(obj.id);
		localStorage.removeItem(obj.id);

		const { mainFolderArr: newArr } = mainFolders_stor.getState();

		if (newArr.length === 0) {
			setMainFolderId(null);
		} else if (index >= newArr.length) {
			setMainFolderId(newArr[newArr.length - 1].id);
		} else {
			setMainFolderId(newArr[index].id);
		}
	};

	const handleReloadFolders = async (e: React.MouseEvent) => {
		const { updateParameters } = mainFolders_stor.getState();
		const finalArr = await reloadFolders(obj);
		updateParameters({
			id: obj.id,
			projectFolders: finalArr,
		});
	};

	const handleMainClick = () => {
		setActiveFolders_store.getState().setMainFolderId(obj.id);
		useColumnFocus_store.getState().setFocusedColumn('main');
	};

	const handleChekboxClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		mainFolders_stor.getState().updateParameters({ id: obj.id, active: !obj.active });
	};

	// Подсветка жёлтым: папка активна, но все подпапки отключены — нечего сканировать.
	// off-список проектов лежит в LS под ключом obj.id (тот же, что использует ProjectFolderItem).
	// Слушаем кастомное событие чтобы перерисоваться когда ProjectFolderItem меняет off-список.
	const [offListVersion, setOffListVersion] = useState(0);
	useEffect(() => {
		const handler = (e: Event) => {
			if ((e as CustomEvent).detail?.key === obj.id) setOffListVersion((v) => v + 1);
		};
		window.addEventListener('folders-off-list-changed', handler);
		return () => window.removeEventListener('folders-off-list-changed', handler);
	}, [obj.id]);

	const offArr: string[] = loadFromLocalStorage(obj.id) || [];
	const hasProjects = Array.isArray(obj.projectFolders) && obj.projectFolders.length > 0;
	const allProjectsOff = hasProjects && obj.projectFolders.every((n: string) => offArr.includes(n));
	const idleHighlight = obj.active && allProjectsOff;

	return (
		<ListItem
			disablePadding
			ref={listItemRef}
			style={{ '--hover-bg': idleHighlight ? 'rgba(255, 191, 0, 0.25)' : '#ffffff0b' } as React.CSSProperties}
			sx={{
				height: '34px',
				backgroundColor:
					isActive && idleHighlight
						? 'rgba(255, 191, 0, 0.25)'
						: isActive
							? isColumnFocused
								? '#007bff4c'
								: 'rgba(150,150,150,0.22)'
							: idleHighlight
								? 'rgba(255, 191, 0, 0.15)'
								: 'transparent',
				position: 'relative',
				'&:hover': {
					backgroundColor: 'var(--hover-bg)',
				},
				'&:hover .removeProjectButton': {
					opacity: 1,
				},
			}}
			onClick={handleMainClick}
		>
			<Checkbox checked={obj.active} onClick={handleChekboxClick} />
			<ListItemText
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
			<IconButton
				className='removeProjectButton'
				onClick={handleReloadFolders}
				sx={{
					p: '1px',
					position: 'absolute',
					top: '50%',
					right: '30px',
					transform: 'translateY(-50%)',
					opacity: 0,
					transition: 'opacity 0.3s',
				}}
			>
				<ListRestart strokeWidth={1} />
			</IconButton>
			<IconButton
				className='removeProjectButton'
				onClick={handleRemoveClick}
				sx={{
					p: '1px',
					position: 'absolute',
					top: '50%',
					right: '4px',
					transform: 'translateY(-50%)',
					opacity: 0,
					transition: 'opacity 0.3s',
				}}
			>
				<X strokeWidth={1} />
			</IconButton>
		</ListItem>
	);
});
