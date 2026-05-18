import { useEffect, useMemo, useState } from 'react';
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import type { PluginJsonData, UiJsonData } from './types';
import { joinPath } from '@/Utils/joinPath';

interface LoadPluginDialogProps {
	open: boolean;
	onClose: () => void;
	onLoad: (data: { pluginJson: PluginJsonData; uiJson: UiJsonData; scriptContent: string | null; folderPath: string }) => void;
}

export function LoadPluginDialog({ open, onClose, onLoad }: LoadPluginDialogProps) {
	const [plugins, setPlugins] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState('');
	const gray20 = greyColor(20);
	const gray40 = greyColor(40);
	const gray60 = greyColor(60);

	useEffect(() => {
		if (!open) return;
		setQuery('');
		setLoading(true);
		setError(null);
		(async () => {
			try {
				const devPath = await window.electronAPI.invoke<string>('getPluginsDevPath');
				const result = await window.electronAPI.invoke<Record<string, string[]>>('getSomeFromFolder', devPath, [
					{ type: 'folders', ext: [] },
				]);
				const folders: string[] = result?.folders ?? [];
				setPlugins(folders.filter((f) => !f.startsWith('_')));
			} catch (e: any) {
				setError(e.message);
			} finally {
				setLoading(false);
			}
		})();
	}, [open]);

	const visiblePlugins = useMemo(() => {
		const sorted = [...plugins].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
		const q = query.trim().toLowerCase();
		if (!q) return sorted;
		return sorted.filter((name) => name.toLowerCase().includes(q));
	}, [plugins, query]);

	const handleSelect = async (folderName: string) => {
		try {
			const devPath = await window.electronAPI.invoke<string>('getPluginsDevPath');
			const folderPath = joinPath(devPath, folderName);

			const pjRaw = await window.electronAPI.invoke<string>('readFileSync', joinPath(folderPath, 'plugin.json'));
			const pluginJson: PluginJsonData = JSON.parse(pjRaw);

			const ujRaw = await window.electronAPI.invoke<string>('readFileSync', joinPath(folderPath, 'ui.json'));
			const uiJson: UiJsonData = JSON.parse(ujRaw);

			let scriptContent: string | null = null;
			try {
				const scriptName = pluginJson.main.replace('.js', '.ts');
				scriptContent = await window.electronAPI.invoke<string>('readFileSync', joinPath(folderPath, scriptName));
			} catch {
				/* no script yet */
			}

			onLoad({ pluginJson, uiJson, scriptContent, folderPath });
			onClose();
		} catch (e: any) {
			setError(`Ошибка загрузки: ${e.message}`);
		}
	};

	return (
		<Dialog open={open} onClose={onClose} maxWidth='xs' fullWidth>
			<DialogTitle sx={{ fontSize: 14, py: 1.5, pb: 1 }}>Загрузить плагин из plugins-dev</DialogTitle>
			<DialogContent sx={{ p: 0 }}>
				<Box sx={{ px: 2, py: 1, borderBottom: `1px solid ${gray40}` }}>
					<input
						autoFocus
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder='Поиск...'
						style={{
							width: '100%',
							background: 'transparent',
							border: `1px solid ${gray40}`,
							borderRadius: 4,
							padding: '6px 8px',
							color: '#cdd6f4',
							fontSize: 13,
							outline: 'none',
						}}
					/>
				</Box>
				{loading && (
					<Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}>
						<CircularProgress size={22} />
					</Box>
				)}
				{error && <Box sx={{ px: 2, py: 1, color: '#ef5350', fontSize: 12 }}>{error}</Box>}
				{!loading &&
					visiblePlugins.map((name) => (
						<Box
							key={name}
							onClick={() => handleSelect(name)}
							sx={{
								px: 2,
								py: 1,
								cursor: 'pointer',
								fontSize: 13,
								borderBottom: `1px solid ${gray40}`,
								'&:hover': { bgcolor: gray20 },
							}}
						>
							{name}
						</Box>
					))}
				{!loading && plugins.length === 0 && !error && (
					<Box sx={{ p: 2, opacity: 0.5, fontSize: 12, textAlign: 'center' }}>Нет плагинов в plugins-dev</Box>
				)}
				{!loading && plugins.length > 0 && visiblePlugins.length === 0 && (
					<Box sx={{ p: 2, color: gray60, fontSize: 12, textAlign: 'center' }}>Ничего не найдено</Box>
				)}
			</DialogContent>
			<DialogActions>
				<Button size='small' onClick={onClose}>
					Отмена
				</Button>
			</DialogActions>
		</Dialog>
	);
}
