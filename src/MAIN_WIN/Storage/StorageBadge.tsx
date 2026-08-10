// Значок состояния файла или папки — ЕДИНСТВЕННОЕ место, где состояние
// превращается в иконку. Всё, что рисует значки, использует этот компонент.
//
// ── Бюджет цвета ─────────────────────────────────────────────────────────────
// Раскрасить четыре состояния из шести = цвет перестал что-либо значить.
// Насыщенность тратим только на то, что требует действия: «не залито» и «ошибка».
// Остальное живёт в сером, как и весь интерфейс (подписи панелей идут через
// text.disabled).
//
// Пин рисуется ПОВЕРХ основного значка, а не вместо: запиненный файл
// одновременно либо синхронизирован, либо качается, и терять эту информацию нельзя.

import { Box, Tooltip, alpha, useTheme } from '@mui/material';
import {
	Cloud,
	CloudDownload,
	CircleCheck,
	CircleArrowUp,
	RefreshCw,
	TriangleAlert,
	Pin,
	FolderClosed,
} from 'lucide-react';
import type { FileState, FolderAggregate } from '@/bindings';

const SIZE = 15;
/** Как в TopPanelGD/TopPanelLocal: единообразие толщины делает иконку «своей». */
const STROKE = 1;

type Look = {
	Icon: typeof Cloud;
	/** Ключ палитры или null → text.disabled. */
	tone: 'muted' | 'secondary' | 'success' | 'warning' | 'error';
	title: string;
};

const FILE_LOOK: Record<FileState, Look> = {
	cloud: { Icon: Cloud, tone: 'muted', title: 'Только в облаке' },
	downloading: { Icon: CloudDownload, tone: 'secondary', title: 'Скачивается' },
	fresh: { Icon: CircleCheck, tone: 'success', title: 'Синхронизировано' },
	stale: { Icon: RefreshCw, tone: 'secondary', title: 'В облаке новее' },
	localOnly: { Icon: CircleArrowUp, tone: 'warning', title: 'Есть только локально — не залито' },
	localModified: { Icon: CircleArrowUp, tone: 'warning', title: 'Локально новее — надо залить' },
	uploading: { Icon: CircleArrowUp, tone: 'warning', title: 'Заливается' },
	conflict: {
		Icon: TriangleAlert,
		tone: 'error',
		title: 'Конфликт: изменилось и локально, и в облаке',
	},
	error: { Icon: TriangleAlert, tone: 'error', title: 'Ошибка передачи' },
};

const FOLDER_LOOK: Record<FolderAggregate, Look> = {
	empty: { Icon: FolderClosed, tone: 'muted', title: 'Пусто' },
	allCloud: { Icon: Cloud, tone: 'muted', title: 'Ничего не скачано' },
	mixed: { Icon: Cloud, tone: 'secondary', title: 'Скачано частично' },
	allLocal: { Icon: CircleCheck, tone: 'success', title: 'Скачано полностью' },
	downloading: { Icon: CloudDownload, tone: 'secondary', title: 'Внутри идёт скачивание' },
	needsUpload: { Icon: CircleArrowUp, tone: 'warning', title: 'Внутри есть незалитое' },
	conflict: { Icon: TriangleAlert, tone: 'error', title: 'Внутри есть конфликт' },
	error: { Icon: TriangleAlert, tone: 'error', title: 'Внутри есть ошибка' },
};

function useTone(tone: Look['tone']) {
	const t = useTheme();
	switch (tone) {
		// Состояние покоя: цвета нет вообще. Таких файлов большинство, и раскрасить
		// их значит зашумить весь список.
		case 'muted':
			return t.palette.text.disabled;
		case 'secondary':
			return t.palette.text.secondary;
		// Тоже покой, но приятно видеть — приглушаем сильно.
		case 'success':
			return alpha(t.palette.success.main, 0.6);
		// Требует действия — здесь цвет оправдан.
		case 'warning':
			return alpha(t.palette.warning.main, 0.8);
		case 'error':
			return alpha(t.palette.error.main, 0.8);
	}
}

interface Props {
	state?: FileState | null;
	aggregate?: FolderAggregate | null;
	pinned?: boolean;
	/** 0..1 — показываем проценты рядом со значком. */
	progress?: number | null;
	error?: string | null;
}

export function StorageBadge({ state, aggregate, pinned, progress, error }: Props) {
	const look = state ? FILE_LOOK[state] : aggregate ? FOLDER_LOOK[aggregate] : null;
	const color = useTone(look?.tone ?? 'muted');

	if (!look) return null;

	const { Icon } = look;
	const pct = typeof progress === 'number' ? Math.round(progress * 100) : null;
	const title = error ? `${look.title}: ${error}` : look.title;

	return (
		<Tooltip title={pinned ? `${title} · оставлен оффлайн` : title} placement='left' arrow>
			<Box
				sx={{
					display: 'inline-flex',
					alignItems: 'center',
					gap: '3px',
					position: 'relative',
					flexShrink: 0,
					color,
					// Статичные стили: анимации и тени на строках списка перекрашивают
					// весь слой и дают мерцание при наведении.
					transition: 'none',
				}}
			>
				<Icon size={SIZE} strokeWidth={STROKE} />
				{pct !== null && (
					<Box
						component='span'
						sx={{ fontSize: 10, lineHeight: 1, userSelect: 'none', fontVariantNumeric: 'tabular-nums' }}
					>
						{pct}%
					</Box>
				)}
				{pinned && (
					<Pin
						size={9}
						strokeWidth={1.5}
						style={{
							position: 'absolute',
							right: -3,
							bottom: -3,
							// Пин — модификатор, а не сигнал: он не должен спорить с
							// основным значком за внимание.
							opacity: 0.75,
						}}
					/>
				)}
			</Box>
		</Tooltip>
	);
}
