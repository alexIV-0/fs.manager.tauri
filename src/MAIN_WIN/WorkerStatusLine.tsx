// Статусбар режима воркера — рядом со статусбарами обработки и постинга, тот же стиль.
//
// Главное, что он должен показывать: ожидание — это работа, а не тишина. Между задачами
// воркер большую часть времени просто спрашивает и ждёт, и без обратного отсчёта такой
// режим неотличим от зависшего. Поэтому отсчёт до следующего запроса виден всегда, а
// счётчик запросов растёт на глазах.
//
// Отсчёт локальный (тик в секунду) от `nextPollAt`, как в PostingStatusLine: раннер
// обновляет состояние по событиям, а секунды крутит интерфейс.

import { Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useWorker_store } from '@/Store/Processing/useWorker_store';
import { statusTextSx } from './Universal/StatusRow';

function fmtCountdown(sec: number): string {
	const s = Math.max(0, Math.floor(sec));
	const m = Math.floor(s / 60);
	const ss = s % 60;
	return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export default function WorkerStatusLine() {
	const { isWorking, stopRequested, status } = useWorker_store();
	const [, tick] = useState(0);

	// Тикаем только пока воркер включён — иначе таймер крутился бы вхолостую.
	useEffect(() => {
		if (!isWorking) return;
		const id = setInterval(() => tick((v) => v + 1), 1000);
		return () => clearInterval(id);
	}, [isWorking]);

	let text = 'воркер остановлен';

	if (isWorking) {
		const nowSec = Math.floor(Date.now() / 1000);

		if (status.phase === 'working' && status.currentTaskId) {
			text = `задача ${status.currentTaskId}`;
			if (status.currentProject) text += ` · ${status.currentProject}`;
			// Аренда: сколько ещё задача числится за нами. Ушла в ноль — её заберёт другая машина.
			if (status.leaseUntil != null) text += ` · аренда: ${fmtCountdown(status.leaseUntil - nowSec)}`;
		} else if (status.phase === 'asking') {
			text = 'запрос…';
		} else {
			text = 'очередь пуста · жду';
			if (status.nextPollAt != null) text += ` · следующий запрос: ${fmtCountdown(status.nextPollAt - nowSec)}`;
		}

		if (stopRequested) text = `остановка после текущей задачи · ${text}`;

		text += ` · запросов: ${status.pollCount}`;
		if (status.doneCount || status.failedCount) text += ` · сделано: ${status.doneCount} · ошибок: ${status.failedCount}`;
		if (status.lastError) text += ` · ⚠ ${status.lastError}`;
	} else if (status.lastError) {
		// Ошибка последнего прогона переживает остановку: иначе воркер, погасший из-за
		// сбоя, выглядел бы просто выключенным, и причину искать было бы негде.
		text += ` · ⚠ ${status.lastError}`;
	}

	return (
		<Typography variant='body1' sx={statusTextSx(isWorking)}>
			{text}
		</Typography>
	);
}
