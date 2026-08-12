// components/DraggableFolderItem.tsx
import { memo } from 'react';

import { sameStorage } from '@/Store/helpers/readDirContent';
import { useDraggable } from '@dnd-kit/core';
import { CurentFolderItem } from './CurentFolderItem';

interface DraggableFolderItemProps {
	name: string;
	path: string;
	isSelected: boolean;
	isActiveSelection?: boolean;
	isMultiSelected?: boolean;
	onSelect: () => void;
	onMultiSelectToggle?: () => void;
	onMultiSelectRange?: () => void;
	source: 'gd' | 'local';
	columnIndex?: number;
	/** Состояние в облачном зеркале; у локальных записей отсутствует. */
	storage?: import('@/Store/helpers/readDirContent').FileItem['storage'];
}

export const DraggableFolderItem = memo(function DraggableFolderItem({ name, path, isSelected, isActiveSelection, isMultiSelected, onSelect, onMultiSelectToggle, onMultiSelectRange, source, columnIndex, storage }: DraggableFolderItemProps) {
	const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
		id: `folder-${path}`,
		data: {
			type: 'folder',
			source,
			path,
			name,
			columnIndex,
		} as const,
	});

	const style = {
		opacity: isDragging ? 0.4 : 1,
		transition: 'opacity 0.2s ease',
		cursor: isDragging ? 'grabbing' : 'grab',
	};

	return (
		<div ref={setNodeRef} style={style} {...listeners} {...attributes}>
			<CurentFolderItem
				name={name}
				storage={storage}
				path={path}
				isSelected={isSelected}
				isActiveSelection={isActiveSelection}
				isMultiSelected={isMultiSelected}
				onSelect={onSelect}
				onMultiSelectToggle={onMultiSelectToggle}
				onMultiSelectRange={onMultiSelectRange}
			/>
		</div>
	);
}, (prev, next) =>
	prev.name === next.name &&
	prev.path === next.path &&
	prev.isSelected === next.isSelected &&
	prev.isActiveSelection === next.isActiveSelection &&
	prev.isMultiSelected === next.isMultiSelected &&
	// Значок синхронизации — тоже пропс, и он меняется чаще всех остальных.
	// Без этой строки строка не перерисовывалась НИКОГДА: путь и имя у облачного
	// файла постоянны, поэтому компаратор говорил «пропсы те же», хотя в сторе уже
	// лежало «скачивается 72 %». Симптом выглядел как «события не доходят».
	sameStorage(prev.storage, next.storage)
);
