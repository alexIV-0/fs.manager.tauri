/**
 * Строка состояния синхронизации словарей (план §5.6).
 *
 * Показывает ровно те три состояния, которые различает механизм, — потому что
 * «не подключено» и «нет связи» это разные вещи: первое настройка, второе сбой.
 * Без явной строки человек не может понять, почему одни настройки уезжают на
 * сервер, а соседние (пути к ffmpeg/AE) — нет.
 */

import { Box, Button, CircularProgress, Tooltip, Typography } from '@mui/material';
import { RefreshCw } from 'lucide-react';
import { greyColor, steelColor } from '@/Store/Color/grayColor';
import { settingsSync_store } from '@/Store/MainWin/settingsSync_store';

export function SettingsSyncRow() {
	const { configured, revision, dirty, busy, lastError, sync } = settingsSync_store();

	const text = !configured
		? 'не подключено — словари только на этой машине'
		: lastError
			? `нет связи${dirty > 0 ? `, локальных правок: ${dirty}` : ''}`
			: dirty > 0
				? `локальных правок: ${dirty}`
				: revision != null
					? `синхронизировано, ревизия ${revision}`
					: 'подключено';

	return (
		<Box sx={{ px: 1, py: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
			<Typography sx={{ fontSize: 11, color: lastError ? '#f38ba8' : steelColor(55), fontFamily: 'monospace' }}>
				словари: {text}
			</Typography>

			{configured ? (
				<Tooltip title={lastError ?? 'Синхронизировать словари с сайтом'} arrow>
					<span>
						<Button
							size='small'
							disabled={busy}
							onClick={() => void sync()}
							startIcon={busy ? <CircularProgress size={12} /> : <RefreshCw size={13} />}
							sx={{ textTransform: 'none', fontSize: 11, color: greyColor(70), minWidth: 0 }}
						>
							синхронизировать
						</Button>
					</span>
				</Tooltip>
			) : null}
		</Box>
	);
}

/** Пометка «этот словарь никуда не уезжает» — рядом с машинно-локальными секциями. */
export function LocalOnlyNote({ why }: { why: string }) {
	return (
		<Typography sx={{ px: 1, fontSize: 10, color: greyColor(45), fontFamily: 'monospace' }}>
			только на этой машине — {why}
		</Typography>
	);
}

export default SettingsSyncRow;
