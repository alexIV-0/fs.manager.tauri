// src/NODE_WIN/nodes/properties/TitleEdit/TitlePreviewPane.tsx
//
// Левая часть модалки титров: холст + подложка-видео.
//
// Без подложки это прежний рисунок канваса на шахматке — быстрый, но всё-таки
// ДРУГОЙ движок, чем финальный рендер. Выбрали видео — и панель показывает
// настоящий кадр из ffmpeg с тем же .ass, который уйдёт в обработку: тот же
// libass, те же шрифты, те же переносы. Отсюда же уходит и вечная путаница с
// цветом: полупрозрачная плашка на шахматке и на реальном кадре выглядит
// по-разному, потому что это разные подложки, а не разные настройки.
//
// Кадры считает общий движок превью (`usePreviewCache` → Rust
// `preview_render_frame`) — тот же, что у keying/convert/ffSwitch/overlay.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { FolderOpen, X } from 'lucide-react';
import { commands, unwrap } from '@/Utils/specta';
import { toFileUrl } from '@/Utils/mediaUtils';
import { loadFromLocalStorage, saveToLocalStorage } from '@/Utils/loadSaveToLS';
import { greyColor } from '@/Store/Color/grayColor';
import { checkerboardStyle } from '@/Utils/CheckerboardBg';
import { MyPopoverColor } from '@/MAIN_WIN/Universal/MyPopoverColor';
import type { PreviewRenderSpec } from '@/bindings';
import { escapeFilterPath } from '@/Utils/titleAss';
import { TitleFormatSettings, VideoFormat } from './types';
import TitleCanvas from './TitleCanvas';
import PreviewTimeline, { type PreviewTimelineHandle } from '../PreviewTimeline';
import PreviewStateDot from '../PreviewStateDot';
import { usePreviewCache } from '../usePreviewCache';
import { useTitleAssPreview } from './useTitleAssPreview';

/** Подложки помнятся по формату и живут в localStorage: это локальные пути
 *  конкретной машины, в options.json (который уезжает на сайт) им не место. */
const LS_KEY = 'titlePreviewSources';

type Sources = Partial<Record<VideoFormat, string>>;

const readSources = (): Sources => (loadFromLocalStorage(LS_KEY) as Sources) ?? {};

const VIDEO_FILTER = {
	name: 'Видео',
	extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mpg', 'mpeg', 'wmv'],
};

const CONTROLS_H = 56;

/** Подложка холста, когда кадра нет: цвет титров без неё оценить нельзя —
 *  на белом и на чёрном один и тот же полупрозрачный фон выглядит по-разному. */
type BgMode = 'checker' | 'white' | 'black' | 'custom';

interface BgState {
	mode: BgMode;
	/** Свой цвет — помнится, даже когда выбран не он. */
	custom: string;
}

const LS_BG = 'titlePreviewBg';
const DEFAULT_BG: BgState = { mode: 'checker', custom: '#808080' };

const readBg = (): BgState => ({ ...DEFAULT_BG, ...((loadFromLocalStorage(LS_BG) as Partial<BgState>) ?? {}) });

/** null — шахматка (рисуется канвасом), иначе сплошная заливка. */
function bgToColor(bg: BgState): string | null {
	switch (bg.mode) {
		case 'checker':
			return null;
		case 'white':
			return '#ffffff';
		case 'black':
			return '#000000';
		default:
			return bg.custom;
	}
}

const SWATCHES: { mode: BgMode; color?: string; title: string }[] = [
	{ mode: 'checker', title: 'Шахматка (прозрачность)' },
	{ mode: 'white', color: '#ffffff', title: 'Белая подложка' },
	{ mode: 'black', color: '#000000', title: 'Чёрная подложка' },
];

interface TitlePreviewPaneProps {
	settings: TitleFormatSettings;
	format: VideoFormat;
	placeholderText: string;
	onPlaceholderTextChange: (text: string) => void;
	onVideoSizeChange: (width: number, height: number) => void;
	canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export default function TitlePreviewPane({
	settings,
	format,
	placeholderText,
	onPlaceholderTextChange,
	onVideoSizeChange,
	canvasRef,
}: TitlePreviewPaneProps) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const timelineRef = useRef<PreviewTimelineHandle>(null);

	const [sources, setSources] = useState<Sources>(readSources);
	const source = sources[format] ?? '';

	const [bg, setBg] = useState<BgState>(readBg);

	const applyBg = useCallback((next: BgState) => {
		setBg(next);
		saveToLocalStorage(LS_BG, next);
	}, []);

	const [editingText, setEditingText] = useState(false);
	const [meta, setMeta] = useState({ width: 0, height: 0, duration: 0 });
	const [time, setTime] = useState(0);

	// Сменили формат — метаданные прежней подложки уже не про эту.
	useEffect(() => {
		setMeta({ width: 0, height: 0, duration: 0 });
		setTime(0);
	}, [format]);

	const pickSource = useCallback(async () => {
		const picked = unwrap(await commands.selectFiles({ multiSelect: false, filters: [VIDEO_FILTER] }));
		if (!picked?.length) return;
		setSources((prev) => {
			const next = { ...prev, [format]: picked[0] };
			saveToLocalStorage(LS_KEY, next);
			return next;
		});
	}, [format]);

	const clearSource = useCallback(() => {
		setSources((prev) => {
			const next = { ...prev };
			delete next[format];
			saveToLocalStorage(LS_KEY, next);
			return next;
		});
	}, [format]);

	// ── ASS для превью — той же сборкой, что и финальный рендер ──────────────

	const { assPath, graphKey, error } = useTitleAssPreview({
		settings,
		text: placeholderText,
		frameWidth: meta.width,
		frameHeight: meta.height,
		paused: editingText,
	});

	// Сетка render-bar: ~4 ячейки в секунду, как у остальных превью.
	const cellCount = useMemo(
		() => (meta.duration > 0 ? Math.min(600, Math.max(20, Math.round(meta.duration * 4))) : 1),
		[meta.duration],
	);

	const buildSpec = useCallback(
		(t: number): PreviewRenderSpec | null => {
			if (!source || !assPath) return null;
			return {
				inputs: [{ path: source, seek: t }],
				filterGraph: `ass=${escapeFilterPath(assPath)}`,
				complex: false,
				outLabel: null,
				time: t,
				maxDim: null,
				namespace: 'title',
			};
		},
		[source, assPath],
	);

	const { cellStates, frameUrl, frameState, requestFrame } = usePreviewCache({
		duration: meta.duration,
		cellCount,
		buildSpec,
		graphKey: `${source}|${graphKey}`,
	});

	// Кадр перезапрашиваем и при смене позиции, и при смене ASS: настройки
	// поменялись — прежний кадр уже не показывает то, что настроено.
	useEffect(() => {
		if (source && assPath && !editingText) requestFrame(time);
	}, [source, assPath, graphKey, time, editingText, requestFrame]);

	const handleSeek = useCallback(
		(ratio: number) => {
			const t = ratio * meta.duration;
			setTime(t);
			timelineRef.current?.update(t, meta.duration);
		},
		[meta.duration],
	);

	const labelColor = greyColor(55);
	const defColor = greyColor(80);

	const fileName = source ? source.split(/[\\/]/).pop() : '';
	const aspectMismatch =
		meta.width > 0 &&
		Math.abs(meta.width / meta.height - settings.videoWidth / settings.videoHeight) > 0.02;

	return (
		<Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
			<Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
				<TitleCanvas
					settings={settings}
					frameUrl={source ? frameUrl : null}
					bgColor={bgToColor(bg)}
					placeholderText={placeholderText}
					onPlaceholderTextChange={onPlaceholderTextChange}
					onVideoSizeChange={onVideoSizeChange}
					onEditingChange={setEditingText}
					canvasRef={canvasRef}
				/>
				{source && <PreviewStateDot state={frameState} />}
			</Box>

			{/* Подложка + таймлайн */}
			<Box
				sx={{
					height: CONTROLS_H,
					flexShrink: 0,
					px: 1.5,
					display: 'flex',
					alignItems: 'center',
					gap: 1.5,
					borderTop: `1px solid ${greyColor(25)}`,
				}}
			>
				<Tooltip title={source ? source : 'Показать титры на реальном кадре — как их отрисует ffmpeg'}>
					<Box
						component='button'
						onClick={pickSource}
						sx={{
							display: 'inline-flex',
							alignItems: 'center',
							gap: '5px',
							px: 1,
							py: '4px',
							maxWidth: 260,
							borderRadius: '3px',
							fontSize: 11,
							cursor: 'pointer',
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							flexShrink: 0,
							border: `1px solid ${greyColor(28)}`,
							backgroundColor: 'transparent',
							color: source ? defColor : labelColor,
							'&:hover': { color: defColor, backgroundColor: greyColor(25) },
						}}
					>
						<FolderOpen size={13} strokeWidth={1.5} />
						<Box component='span' sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
							{fileName || 'Видео для превью…'}
						</Box>
					</Box>
				</Tooltip>

				{source && (
					<Tooltip title='Убрать подложку'>
						<Box
							component='button'
							onClick={clearSource}
							sx={{
								display: 'inline-flex',
								p: '3px',
								borderRadius: '3px',
								cursor: 'pointer',
								border: 'none',
								backgroundColor: 'transparent',
								color: labelColor,
								flexShrink: 0,
								'&:hover': { color: defColor },
							}}
						>
							<X size={13} strokeWidth={1.5} />
						</Box>
					</Tooltip>
				)}

				{/* Подложка холста — только пока нет кадра: поверх кадра она не видна. */}
				{!source && (
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
						{SWATCHES.map((sw) => (
							<Tooltip key={sw.mode} title={sw.title}>
								<Box
									component='button'
									onClick={() => applyBg({ ...bg, mode: sw.mode })}
									sx={{
										width: 20,
										height: 20,
										p: 0,
										borderRadius: '3px',
										cursor: 'pointer',
										...(sw.mode === 'checker' ? checkerboardStyle : { backgroundColor: sw.color }),
										backgroundSize: sw.mode === 'checker' ? '8px 8px' : undefined,
										border: `1px solid ${bg.mode === sw.mode ? greyColor(75) : greyColor(30)}`,
										outline: bg.mode === sw.mode ? `1px solid ${greyColor(75)}` : 'none',
									}}
								/>
							</Tooltip>
						))}

						{/* Свой цвет: клик и выбирает подложку, и открывает пикер. */}
						<Tooltip title='Свой цвет подложки'>
							<Box
								onClick={() => applyBg({ ...bg, mode: 'custom' })}
								sx={{
									display: 'inline-flex',
									borderRadius: '4px',
									p: '1px',
									border: `1px solid ${bg.mode === 'custom' ? greyColor(75) : 'transparent'}`,
								}}
							>
								<MyPopoverColor
									color={bg.custom}
									size={20}
									onChange={(color) => applyBg({ mode: 'custom', custom: color })}
								/>
							</Box>
						</Tooltip>
					</Box>
				)}

				<Box sx={{ flex: 1, minWidth: 0 }}>
					{source && meta.duration > 0 && (
						<PreviewTimeline
							ref={timelineRef}
							duration={meta.duration}
							cellCount={cellCount}
							cellStates={cellStates}
							onSeek={handleSeek}
							showHoverTime
						/>
					)}
				</Box>

				{error && (
					<Typography fontSize={10} color='#e0a82e' sx={{ flexShrink: 0, maxWidth: 220 }} noWrap title={error}>
						{error}
					</Typography>
				)}

				{aspectMismatch && !error && (
					<Typography fontSize={10} color='#e0a82e' sx={{ flexShrink: 0 }} noWrap>
						подложка {meta.width}×{meta.height} — не пропорции формата
					</Typography>
				)}
			</Box>

			{/* Только источник метаданных: длительность и стороны КАДРА (с учётом поворота). */}
			{source && (
				<video
					ref={videoRef}
					src={toFileUrl(source)}
					preload='metadata'
					muted
					// НЕ display:none: скрытому таким образом видео WebKit может не
					// грузить метаданные, а нам нужны стороны кадра и длительность.
					style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', left: 0, bottom: 0 }}
					onLoadedMetadata={() => {
						const v = videoRef.current;
						if (!v) return;
						setMeta({ width: v.videoWidth, height: v.videoHeight, duration: v.duration || 0 });
					}}
				/>
			)}
		</Box>
	);
}
