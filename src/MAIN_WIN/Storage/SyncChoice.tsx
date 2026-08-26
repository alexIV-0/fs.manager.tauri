// Две стрелки прямо в строке файла: скачать или залить.
//
// ── Зачем они в строке, а не в меню ─────────────────────────────────────────
// Расхождение — это состояние, из которого программа сама выйти не может, и
// значок про него только СООБЩАЕТ. Пока действия жили в контекстном меню, строка
// с ⚠ или с «в облаке новее» была уведомлением без выхода: непонятно, что новее,
// и непонятно, что можно сделать. Стрелки читаются без подписи (вниз — взять из
// облака, вверх — залить свою) и стоят на расстоянии одного клика.
//
// ── Почему не только у конфликта ────────────────────────────────────────────
// Раньше выбор показывался ровно в одном состоянии — `conflict`. Но выбор нужен
// в каждом расхождении: у «в облаке новее» человек может хотеть оставить своё, у
// «правлено здесь» — отказаться от правки, у ошибки не видно даже направления.
// Разница между состояниями не в наличии выбора, а в том, какая сторона по
// умолчанию правее — это показано яркостью стрелки и текстом подсказки.
//
// ── Числа подгружаются по наведению ─────────────────────────────────────────
// «Что новее» нельзя было увидеть вообще: листинг папки не делает `stat` (иначе
// тысяча файлов = тысяча обращений к диску). Поэтому обе стороны спрашиваются
// ОДНИМ вызовом и ровно тогда, когда человек навёл курсор на выбор.

import { Box, CircularProgress, IconButton, Tooltip } from '@mui/material';
import { CloudDownload, CloudUpload } from 'lucide-react';
import { useRef, useState } from 'react';

import type { FileState, SyncDetail } from '@/bindings';
import { syncDetail } from '@/Utils/storageSeam';
import { pullFromCloud, pushToCloud } from './fileActions';
import { explainDivergence } from './syncText';

interface Props {
	path: string;
	state: FileState;
}

/** Что стрелка сделает и чего это стоит — по состоянию, а не по кнопке. */
const ВНИЗ: Partial<Record<FileState, string>> = {
	stale: 'Обновить копию из облака',
	localModified: 'Взять из облака — ваша правка будет потеряна',
	conflict: 'Взять из облака — локальные правки будут потеряны',
	error: 'Скачать из облака заново',
};

const ВВЕРХ: Partial<Record<FileState, string>> = {
	stale: 'Залить мою версию — более новая облачная будет перезаписана',
	localModified: 'Отправить мою версию в облако',
	conflict: 'Залить мою версию — облачная будет перезаписана',
	error: 'Отправить в облако заново',
};

/** Какая сторона правее по умолчанию. У конфликта и ошибки — никакая. */
const ПО_УМОЛЧАНИЮ: Partial<Record<FileState, 'down' | 'up'>> = {
	stale: 'down',
	localModified: 'up',
};

export function SyncChoice({ path, state }: Props) {
	const [busy, setBusy] = useState(false);
	const [detail, setDetail] = useState<SyncDetail | null>(null);
	const asked = useRef(false);

	// Один запрос на наведение, и только первый раз: подсказку открывают, чтобы
	// посмотреть, а не чтобы опрашивать диск каждым движением курсора.
	const askDetail = () => {
		if (asked.current) return;
		asked.current = true;
		void syncDetail(path).then(setDetail);
	};

	const act = async (dir: 'down' | 'up') => {
		if (busy) return;
		setBusy(true);
		try {
			// Строку папки перечитывают сами действия — здесь только направление.
			if (dir === 'down') await pullFromCloud(path, state);
			else await pushToCloud(path, state);
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

	const подсказка = (действие?: string) => (
		<Box sx={{ fontSize: 11, lineHeight: 1.45 }}>
			{действие && <Box sx={{ fontWeight: 600 }}>{действие}</Box>}
			{explainDivergence(detail).map((line) => (
				<Box key={line}>{line}</Box>
			))}
		</Box>
	);

	const стрелка = (dir: 'down' | 'up') => {
		const текст = (dir === 'down' ? ВНИЗ : ВВЕРХ)[state];
		if (!текст) return null;
		const Icon = dir === 'down' ? CloudDownload : CloudUpload;
		const главная = ПО_УМОЛЧАНИЮ[state];
		return (
			<Tooltip title={подсказка(текст)} placement='left' arrow>
				<IconButton
					size='small'
					// Приглушаем не главное направление: в расхождении одна из сторон
					// обычно правее, и подсказать это яркостью дешевле, чем текстом.
					sx={{ p: '2px', opacity: !главная || главная === dir ? 1 : 0.5 }}
					onClick={(e) => {
						e.stopPropagation();
						void act(dir);
					}}
				>
					<Icon size={13} strokeWidth={1} />
				</IconButton>
			</Tooltip>
		);
	};

	return (
		<Box
			onMouseEnter={askDetail}
			sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}
		>
			{стрелка('down')}
			{стрелка('up')}
		</Box>
	);
}
