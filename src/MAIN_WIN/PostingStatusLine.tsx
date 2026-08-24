// Статусбар отдельного процесса автопостинга. Всегда видим (как основной), стиль тот же
// (Typography 1.4rem). Состояние тянет из usePosting_store (обновляет планировщик каждый тик).
// Обратный отсчёт — локальный (1с) от nextDueAt.

import { Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { usePosting_store } from '@/Store/Processing/usePosting_store';
import { statusTextSx } from './Universal/StatusRow';

// Обратный отсчёт в формате MM:SS (напр. 00:24, 01:30).
function fmtCountdown(sec: number): string {
	const s = Math.max(0, Math.floor(sec));
	const m = Math.floor(s / 60);
	const ss = s % 60;
	return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export default function PostingStatusLine() {
	const { isPosting, status } = usePosting_store();
	const [, tick] = useState(0);

	// Тикаем раз в секунду только пока постинг активен — для живого отсчёта.
	useEffect(() => {
		if (!isPosting) return;
		const id = setInterval(() => tick((v) => v + 1), 1000);
		return () => clearInterval(id);
	}, [isPosting]);

	let text = 'постинг остановлен';
	if (isPosting) {
		const nowSec = Math.floor(Date.now() / 1000);
		text = `папок: ${status.routesCount} · к постингу: ${status.queuedCount}`;
		// Отсчёт до следующего прохода планировщика (виден всегда, даже когда постить нечего).
		if (status.nextScanAt != null) {
			text += ` · следующий поиск: ${fmtCountdown(status.nextScanAt - nowSec)}`;
		}
		if (status.lastPermalink) text += ` · последний: ${status.lastPermalink}`;
		else if (status.lastError) text += ` · ⚠ ${status.lastError}`;
	}

	return (
		<Typography variant='body1' sx={statusTextSx(isPosting)}>
			{text}
		</Typography>
	);
}
