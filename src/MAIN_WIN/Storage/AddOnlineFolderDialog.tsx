// Выбор облачной папки для добавления в первую колонку.
//
// Облачная папка — обычная главная папка, просто лежащая в зеркале. Поэтому
// диалог только выбирает клиента и заводит запись; дальше она живёт в общем
// списке наравне с локальными: чекбокс, on/off all, обход при обработке.
//
// Клиенты, уже добавленные в список, здесь не показываются — второй раз добавить
// ту же папку нельзя (как и локальную).

import {
	Box,
	Dialog,
	DialogContent,
	DialogTitle,
	List,
	ListItemButton,
	Typography,
} from '@mui/material';
import { Cloud } from 'lucide-react';
import { useEffect, useState } from 'react';

import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';
import { storage_store } from '@/Store/MainWin/storage_store';
import { browseMirror } from '@/Utils/storageSeam';
import { reloadFolders } from '@/PROCESSING/reloadFolders';

interface Props {
	open: boolean;
	onClose: () => void;
}

export function AddOnlineFolderDialog({ open, onClose }: Props) {
	const { status, clients, projects } = storage_store();
	const { mainFolderArr } = mainFolders_stor();
	const [paths, setPaths] = useState<Record<string, string>>({});
	const [error, setError] = useState<string | null>(null);

	// Пути папок клиентов берём из того же листинга, что рисует колонки: правила
	// раскладки имён живут в Rust, и повторять их здесь нельзя — разъедутся.
	useEffect(() => {
		if (!open || !status.connected || !status.mirrorRoot) return;
		setError(null);
		void browseMirror(status.mirrorRoot).then((rows) => {
			if (!rows) {
				setError('Не удалось прочитать корень зеркала');
				return;
			}
			const map: Record<string, string> = {};
			for (const r of rows) if (r.storage?.fileId) map[r.storage.fileId] = r.path;
			setPaths(map);
		});
	}, [open, status.connected, status.mirrorRoot, clients.length]);

	const norm = (p: string) => p.replace(/\/+$/, '').toLowerCase();
	const added = new Set(mainFolderArr.map((f) => norm(f.path)));
	const available = clients.filter((c) => paths[c.id] && !added.has(norm(paths[c.id])));

	const add = async (clientId: string) => {
		const path = paths[clientId];
		if (!path) return;
		const id = mainFolders_stor.getState().ensureOnlineFolder(path);

		// Проекты заполняем ДО выбора папки. Иначе колонка проектов на мгновение
		// видит пустой список, сохраняет выбор от предыдущей папки, и третья колонка
		// продолжает показывать её содержимое.
		const entry = mainFolders_stor.getState().mainFolderArr.find((f) => f.id === id);
		if (entry) {
			try {
				const projectNames = await reloadFolders(entry);
				mainFolders_stor.getState().updateParameters({ id, projectFolders: projectNames });
			} catch (e) {
				console.error('Не удалось прочитать проекты облачной папки', path, e);
			}
		}

		setActiveFolders_store.getState().setMainFolderId(id);
		onClose();
	};

	return (
		<Dialog open={open} onClose={onClose} maxWidth='xs' fullWidth>
			<DialogTitle component='div' sx={{ pb: 1 }}>
				<Typography variant='subtitle2'>Добавить папку из облака</Typography>
			</DialogTitle>

			<DialogContent dividers sx={{ p: 0 }}>
				{!status.connected ? (
					<Typography variant='caption' sx={{ display: 'block', p: 2, color: 'text.disabled' }}>
						Хранилище не подключено. Настройки → Хранилище.
					</Typography>
				) : error ? (
					<Typography variant='caption' sx={{ display: 'block', p: 2, color: 'error.main' }}>
						{error}
					</Typography>
				) : available.length === 0 ? (
					<Typography variant='caption' sx={{ display: 'block', p: 2, color: 'text.disabled' }}>
						{clients.length === 0 ? 'В хранилище нет клиентов' : 'Все папки уже добавлены'}
					</Typography>
				) : (
					<List disablePadding>
						{available.map((c) => (
							<ListItemButton key={c.id} onClick={() => void add(c.id)} sx={{ gap: 1, py: '4px' }}>
								<Cloud size={14} strokeWidth={1} opacity={0.55} />
								<Typography variant='body2' noWrap sx={{ flex: 1, minWidth: 0, fontSize: 13 }}>
									{c.displayName}
								</Typography>
								<Typography variant='caption' sx={{ color: 'text.disabled', fontSize: 10 }}>
									{projects.filter((p) => p.clientId === c.id).length}
								</Typography>
							</ListItemButton>
						))}
					</List>
				)}
			</DialogContent>

			{status.mock && (
				<Box sx={{ px: 2, py: '4px' }}>
					<Typography variant='caption' sx={{ color: 'warning.main', fontSize: 10 }}>
						демо-данные, не настоящее хранилище
					</Typography>
				</Box>
			)}
		</Dialog>
	);
}
