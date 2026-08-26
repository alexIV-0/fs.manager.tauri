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

import type { CSSProperties } from 'react';
import { Box, Tooltip, alpha, useTheme } from '@mui/material';
import { Cloud, CloudDownload, CircleCheck, CircleArrowUp, RefreshCw, TriangleAlert, Pin } from 'lucide-react';
import type { FileState, FolderAggregate } from '@/bindings';

const SIZE = 20;
/** Как в TopPanelGD/TopPanelLocal: единообразие толщины делает иконку «своей». */
const STROKE = 1;
/** Пин — накладка поверх основного значка, поэтому мельче, но НЕ бледнее:
 *  раньше он был `text.disabled` того же размера и терялся на фоне галочки. */
const PIN_SIZE = 20;

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
	// Пустая папка синхронизирована по определению: скачивать в ней нечего. Раньше
	// здесь стоял значок папки — бессмысленный: что это папка, уже видно по большой
	// иконке слева, а человек ждёт в этом месте состояние синхронизации.
	empty: { Icon: CircleCheck, tone: 'success', title: 'Пусто — синхронизирована' },
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
	/**
	 * Что делает КЛИК по значку. Есть не всегда: у синхронизированного файла делать
	 * нечего, а у конфликта нужен выбор — там рядом стоят две стрелки.
	 *
	 * ── Зачем значок вообще нажимается ──────────────────────────────────────
	 * Облачко у файла означает «здесь этого нет». Первое, что человек делает,
	 * увидев его, — нажимает: он не читает, что это «индикатор». Значок, который
	 * умеет только сообщать, — это лишний клик правой кнопкой на каждое действие.
	 */
	onAction?: () => void;
	/** Чем клик закончится — дописывается в подсказку. Без него нажимать вслепую. */
	actionHint?: string;
}

export function StorageBadge({ state, aggregate, pinned, progress, error, onAction, actionHint }: Props) {
	const look = state ? FILE_LOOK[state] : aggregate ? FOLDER_LOOK[aggregate] : null;
	const color = useTone(look?.tone ?? 'muted');

	if (!look) return null;

	const { Icon } = look;
	const pct = typeof progress === 'number' ? Math.round(progress * 100) : null;
	const title = error ? `${look.title}: ${error}` : look.title;

	// ── Запинённый и синхронизированный: показываем ТОЛЬКО пин ────────────────
	// Галочка тут избыточна: пин означает «держим локально», а держать можно только
	// то, что скачано. Две иконки говорили бы одно и то же дважды.
	//
	// Замена работает ровно для состояния покоя (`fresh`). Для всего, что требует
	// действия — «надо залить», «в облаке новее», конфликт, ошибка, идущая передача —
	// значок состояния остаётся, а пин идёт накладкой: спрятать требование действия
	// за пином значит спрятать саму работу.
	const pinOnly = pinned && state === 'fresh';

	// ⚙️ ЕДИНСТВЕННОЕ МЕСТО, где настраивается вид пина.
	//
	// Раньше пин рисовался в ДВУХ ветках — «только пин» и «накладка», — и правка одной
	// из них не давала никакого эффекта, если строка рендерилась через другую. Теперь
	// стиль один, а разница между режимами только в размере и позиции.
	const pinStyle: CSSProperties = pinOnly
		? { rotate: '35deg', fill: 'green' }
		: {
				position: 'absolute',
				bottom: -1,
				right: -4,
				// rotate: '35deg',
				// Контур цветом фона: накладка читается поверх линий значка, а не
				// сливается с ними.
				paintOrder: 'stroke',
				stroke: 'rgba(0,0,0,0.55)',
				strokeWidth: 3,
			};

	const pinNode = (
		<Pin size={pinOnly ? SIZE : PIN_SIZE} strokeWidth={pinOnly ? STROKE : 2} fill={pinOnly ? 'none' : 'currentColor'} style={pinStyle} />
	);

	const состояние = pinOnly
		? 'Оставлен оффлайн · синхронизирован'
		: pinned
			? `${title} · оставлен оффлайн`
			: title;
	const подсказка = onAction && actionHint ? `${состояние} · ${actionHint}` : состояние;

	return (
		<Tooltip title={подсказка} placement='left' arrow>
			<Box
				onClick={
					onAction
						? (e) => {
								// Строка под значком — кнопка выбора и перехода в папку.
								// Без этого клик по облачку заодно уводил бы вглубь.
								e.stopPropagation();
								e.preventDefault();
								onAction();
							}
						: undefined
				}
				// Двойной клик по строке файла открывает его во внешней программе, и
				// это событие идёт мимо `onClick`: без гашения быстрый двойной тык по
				// облачку заодно открывал бы файл.
				onDoubleClick={onAction ? (e) => e.stopPropagation() : undefined}
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
					...(onAction && {
						cursor: 'pointer',
						// Подсветку даём цветом, а не тенью и не масштабом: тень на строке
						// React-Flow-подобного списка перекрашивает весь слой и мерцает.
						'&:hover': { color: 'primary.main' },
					}),
				}}
			>
				{/* Пин заменяет значок состояния — значит второй иконки в этой ветке нет. */}
				{!pinOnly && <Icon size={SIZE} strokeWidth={STROKE} />}
				{pct !== null && (
					<Box component='span' sx={{ fontSize: 10, lineHeight: 1, userSelect: 'none', fontVariantNumeric: 'tabular-nums' }}>
						{pct}%
					</Box>
				)}
				{pinned && pinNode}
			</Box>
		</Tooltip>
	);
}
