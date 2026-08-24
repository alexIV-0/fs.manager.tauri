// Разрешение конфликта: две стрелки прямо в строке файла.
//
// Конфликт — единственное состояние, которое программа не решает сама: файл
// изменился и локально, и в облаке, и любой автовыбор теряет данные. Значит выбор
// обязан быть у человека, и он должен быть **на расстоянии одного клика** — в
// контекстное меню такое прятать нельзя: строка с ⚠ висит и непонятно, что делать.
//
// Две стрелки читаются без подписи: вниз — взять облачную версию, вверх — залить
// свою. Тултипы объясняют цену выбора, потому что в обоих случаях одна из версий
// будет потеряна, и человек должен понимать какая.

import { IconButton, Tooltip, Box, CircularProgress } from '@mui/material';
import { CloudDownload, CloudUpload } from 'lucide-react';
import { useState } from 'react';

import { resolveConflict } from '@/Utils/storageSeam';

interface Props {
	path: string;
	/** Позвать после успеха — перечитать папку, чтобы значок сменился. */
	onResolved?: () => void;
}

export function ConflictChoice({ path, onResolved }: Props) {
	const [busy, setBusy] = useState(false);

	const pick = async (takeCloud: boolean) => {
		if (busy) return;
		setBusy(true);
		try {
			await resolveConflict(path, takeCloud);
			onResolved?.();
		} catch (e) {
			console.error('resolveConflict failed:', e);
		} finally {
			setBusy(false);
		}
	};

	if (busy) {
		return (
			<Box sx={{ display: 'flex', alignItems: 'center', px: 0.5 }}>
				<CircularProgress size={12} />
			</Box>
		);
	}

	return (
		<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
			<Tooltip title='Взять из облака — локальные правки будут потеряны' arrow>
				<IconButton
					size='small'
					sx={{ p: '2px' }}
					onClick={(e) => {
						e.stopPropagation();
						void pick(true);
					}}
				>
					<CloudDownload size={13} strokeWidth={1} />
				</IconButton>
			</Tooltip>
			<Tooltip title='Залить мою версию — облачная будет перезаписана' arrow>
				<IconButton
					size='small'
					sx={{ p: '2px' }}
					onClick={(e) => {
						e.stopPropagation();
						void pick(false);
					}}
				>
					<CloudUpload size={13} strokeWidth={1} />
				</IconButton>
			</Tooltip>
		</Box>
	);
}
