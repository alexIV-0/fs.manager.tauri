// Окно «скачиваю перед копированием» — видимая часть паузы.
//
// ── Зачем оно вообще ────────────────────────────────────────────────────────
// Копирование онлайн-папки теперь ждёт байтов, а ожидание может быть долгим:
// пятьдесят гигабайт по каналу — это часы. Без окна программа просто замирала бы
// после нажатия «Вставить»: ни отмены, ни понимания, что происходит, — и человек
// решил бы, что она повисла.
//
// Модальное намеренно: пока файлы едут, работать с этими же папками нельзя —
// половина строк меняет состояние под руками. Отмена рядом, и она честная: цикл
// останавливается на ближайшем файле, а копирование не начинается вовсе.
//
// Висит один на всё окно (`AppMain`), потому что копирование зовут из четырёх мест
// сразу — меню файла, меню папки, Ctrl+V и перетаскивание.

import { Box, Button, Dialog, DialogContent, DialogTitle, LinearProgress, Typography } from '@mui/material';
import { CloudDownload } from 'lucide-react';

import { hydrateGate_store } from '@/Store/MainWin/hydrateGate_store';
import { humanSize } from './syncText';

export function HydrateGateOverlay() {
	const { active, title, total, bytes, done, failed, bytesDone, current, cancelled, cancel } = hydrateGate_store();

	if (!active) return null;

	// `total === 0` — список ещё собирается: обход каталога по большому проекту идёт
	// секунды, и делать вид, что «0 из 0 скачано», нельзя.
	const считаем = total === 0;

	// Процент по БАЙТАМ, а не по числу файлов: один пятигиговый мастер и десять
	// мелких иначе дают одинаковый вклад, и полоса врёт. Размеров может не быть
	// вовсе (каталог их не знает) — тогда считаем по файлам.
	const pct = bytes > 0 ? Math.min(100, (bytesDone / bytes) * 100) : total > 0 ? (done / total) * 100 : 0;

	return (
		<Dialog
			open
			disableEscapeKeyDown
			maxWidth='xs'
			fullWidth
			sx={{ '& .MuiPaper-root': { backgroundColor: '#2d3748', color: 'white' } }}
		>
			<DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '1rem' }}>
				<CloudDownload size={18} />
				{title}: скачиваю файлы из облака
			</DialogTitle>
			<DialogContent>
				<Typography sx={{ fontSize: '0.85rem', opacity: 0.8, mb: 1 }}>
					{считаем
						? 'Считаю, чего не хватает…'
						: `${done} из ${total} · ${humanSize(bytesDone)} из ${humanSize(bytes)}`}
					{failed > 0 && ` · не удалось: ${failed}`}
				</Typography>

				<LinearProgress
					variant={считаем ? 'indeterminate' : 'determinate'}
					value={pct}
					sx={{
						height: 6,
						borderRadius: 3,
						backgroundColor: 'rgba(255,255,255,0.12)',
						'& .MuiLinearProgress-bar': { backgroundColor: '#4dabf7' },
					}}
				/>

				{/* Имя текущего файла — единственное доказательство, что дело движется,
				    когда файл большой и проценты стоят на месте минутами. */}
				<Typography
					sx={{
						mt: 1,
						fontSize: '0.78rem',
						opacity: 0.6,
						whiteSpace: 'nowrap',
						overflow: 'hidden',
						textOverflow: 'ellipsis',
					}}
				>
					{cancelled
						? 'Останавливаюсь — доезжает начатый файл…'
						: считаем
							? 'Читаю содержимое папок из каталога'
							: current || '\u00A0'}
				</Typography>

				<Typography sx={{ mt: 1.5, fontSize: '0.75rem', opacity: 0.5 }}>
					{title} начнётся, когда всё окажется на диске.
				</Typography>

				<Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
					<Button size='small' onClick={cancel} disabled={cancelled} sx={{ color: '#f56565' }}>
						Отменить
					</Button>
				</Box>
			</DialogContent>
		</Dialog>
	);
}
