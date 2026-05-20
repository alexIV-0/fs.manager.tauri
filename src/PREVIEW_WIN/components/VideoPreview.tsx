import { useEffect, useRef, useState } from 'react';
import { toFileUrl, formatTime } from '@/Utils/mediaUtils';
import { checkerboardStyle } from '@/Utils/CheckerboardBg';

const CONTROLS_H = 68;
const MAX_DIM = 1280;

// Иконка громкости в зависимости от уровня
function VolumeIcon({ volume }: { volume: number }) {
	if (volume === 0) return <span>🔇</span>;
	if (volume < 0.4) return <span>🔈</span>;
	if (volume < 0.8) return <span>🔉</span>;
	return <span>🔊</span>;
}

export function VideoPreview({ filePath }: { filePath: string }) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const progressRef = useRef<HTMLDivElement>(null);
	const volumeRef = useRef<HTMLDivElement>(null);
	const draggingRef = useRef(false);
	const draggingVolRef = useRef(false);

	const [playing, setPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [volume, setVolume] = useState(1);
	const [error, setError] = useState(false);
	const [hasAlpha, setHasAlpha] = useState(false);
	const [transcodedPath, setTranscodedPath] = useState('');
	const [transcoding, setTranscoding] = useState(false);
	const [controlsVisible, setControlsVisible] = useState(true);
	const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// При загрузке метаданных — вычисляем размер окна
	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;

		const onMetadata = () => {
			setDuration(video.duration);
			setError(false);

			const vw = video.videoWidth || 1280;
			const vh = video.videoHeight || 720;
			let w = vw;
			let h = vh;

			if (w >= h && w > MAX_DIM) { h = Math.round((h * MAX_DIM) / w); w = MAX_DIM; }
			else if (h > w && h > MAX_DIM) { w = Math.round((w * MAX_DIM) / h); h = MAX_DIM; }

			window.electronAPI.invoke('preview:resize', {
				width: w,
				height: h,
				aspectRatio: vw / vh,
			});
		};

		video.addEventListener('loadedmetadata', onMetadata);
		return () => video.removeEventListener('loadedmetadata', onMetadata);
	}, [filePath]);

	// Принудительная перезагрузка <video> при смене src + автоплей
	useEffect(() => {
		const v = videoRef.current;
		if (!v) return;
		v.load();
		v.play().catch(() => setPlaying(false));
	}, [filePath, transcodedPath]);

	// Детекция альфа-канала (только индикатор, без конвертации)
	useEffect(() => {
		let mounted = true;
		setHasAlpha(false);
		setTranscodedPath('');
		setTranscoding(false);

		(window as any).electronAPI.invoke('preview:detect-alpha', filePath)
			.then((isAlpha: boolean) => {
				if (mounted) setHasAlpha(!!isAlpha);
			})
			.catch(() => {});

		return () => {
			mounted = false;
			if (transcodedPath) (window as any).electronAPI.invoke('preview:delete-temp', transcodedPath).catch(() => {});
		};
	}, [filePath]);

	// Если <video> не смог декодировать формат — стартуем фоновый транскод в H.264 mp4
	const handleVideoError = () => {
		console.log('[VideoPreview] video error — transcoding=', transcoding, 'transcodedPath=', transcodedPath);
		if (transcoding) return;
		if (transcodedPath) {
			// Уже играли транскод и он упал — финальная ошибка
			setError(true);
			return;
		}
		setError(false);
		setTranscoding(true);
		(window as any).electronAPI.invoke('preview:transcode-webm', filePath)
			.then((p: string) => {
				console.log('[VideoPreview] transcode result:', p);
				if (p) {
					setTranscodedPath(p);
				} else {
					setError(true);
				}
				setTranscoding(false);
			})
			.catch((err: any) => {
				console.error('[VideoPreview] transcode error:', err);
				setError(true);
				setTranscoding(false);
			});
	};

	// Применяем громкость к элементу
	useEffect(() => {
		if (videoRef.current) videoRef.current.volume = volume;
	}, [volume]);

	// Drag-to-seek по прогресс-бару
	useEffect(() => {
		const onMove = (e: MouseEvent) => {
			if (draggingRef.current && progressRef.current) {
				const v = videoRef.current;
				if (!v || !duration) return;
				const rect = progressRef.current.getBoundingClientRect();
				v.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
			}
			if (draggingVolRef.current && volumeRef.current) {
				const rect = volumeRef.current.getBoundingClientRect();
				const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
				setVolume(ratio);
			}
		};
		const onUp = () => { draggingRef.current = false; draggingVolRef.current = false; };
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
		return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
	}, [duration]);

	const togglePlay = () => {
		const v = videoRef.current;
		if (!v) return;
		if (v.paused) v.play(); else v.pause();
	};

	const handleProgressDown = (e: React.MouseEvent<HTMLDivElement>) => {
		const v = videoRef.current;
		if (!v || !duration || !progressRef.current) return;
		draggingRef.current = true;
		const rect = progressRef.current.getBoundingClientRect();
		v.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
	};

	const handleVolumeDown = (e: React.MouseEvent<HTMLDivElement>) => {
		if (!volumeRef.current) return;
		draggingVolRef.current = true;
		const rect = volumeRef.current.getBoundingClientRect();
		setVolume(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
	};

	// Колёсико мыши регулирует громкость
	const handleWheel = (e: React.WheelEvent) => {
		e.preventDefault();
		setVolume((v) => Math.max(0, Math.min(1, v - e.deltaY * 0.001)));
	};

	// Показ контролов при движении мыши, плавное скрытие через 2.5 сек простоя
	const showControlsTemporarily = () => {
		setControlsVisible(true);
		if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
		hideTimerRef.current = setTimeout(() => {
			if (!draggingRef.current && !draggingVolRef.current && !videoRef.current?.paused) {
				setControlsVisible(false);
			}
		}, 2500);
	};

	const handleMouseMove = () => showControlsTemporarily();

	const handleMouseLeave = () => {
		if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
		if (!draggingRef.current && !draggingVolRef.current && !videoRef.current?.paused) {
			setControlsVisible(false);
		}
	};

	useEffect(() => () => {
		if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
	}, []);

	// На паузе всегда показываем контролы и отменяем таймер скрытия
	useEffect(() => {
		if (!playing) {
			if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
			setControlsVisible(true);
		}
	}, [playing]);

	const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

	const btnStyle: React.CSSProperties = {
		width: 32, height: 32, borderRadius: '50%',
		border: '1px solid #3a3a3a', background: '#252525', color: '#ddd',
		cursor: 'pointer', display: 'flex', alignItems: 'center',
		justifyContent: 'center', fontSize: 13, flexShrink: 0, outline: 'none',
	};

	return (
		<div
			style={{
				height: '100vh',
				width: '100vw',
				position: 'relative',
				...checkerboardStyle,
				userSelect: 'none',
				overflow: 'hidden',
				cursor: controlsVisible ? 'default' : 'none',
			}}
			onWheel={handleWheel}
			onMouseMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
		>
			{/* Видео — занимает весь контент окна, контролы оверлеем поверх */}
			<video
				ref={videoRef}
				src={toFileUrl(transcodedPath || filePath)}
				style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', cursor: 'pointer' }}
				onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
				onPlay={() => setPlaying(true)}
				onPause={() => setPlaying(false)}
				onEnded={() => setPlaying(false)}
				onError={handleVideoError}
				onClick={togglePlay}
			/>

			{hasAlpha && (
				<div style={{
					position: 'absolute', top: 8, right: 8,
					background: 'rgba(120, 100, 220, 0.85)', color: '#fff',
					fontSize: 10, fontFamily: 'system-ui, sans-serif', fontWeight: 600,
					letterSpacing: '0.08em',
					padding: '3px 8px', borderRadius: 4, pointerEvents: 'none',
				}}>
					ALPHA
				</div>
			)}

			{transcoding && (
				<div style={{
					position: 'absolute', top: 8, left: 8,
					background: 'rgba(0,0,0,0.7)', color: '#bbb',
					fontSize: 11, fontFamily: 'system-ui, sans-serif',
					padding: '4px 10px', borderRadius: 4, pointerEvents: 'none',
				}}>
					transcoding...
				</div>
			)}

			{error && (
				<div style={{
					position: 'absolute', top: '40%', left: '50%',
					transform: 'translate(-50%, -50%)', color: '#f55', fontSize: 13,
					background: 'rgba(0,0,0,0.7)', padding: '8px 16px', borderRadius: 4,
				}}>
					Cannot decode this format. Try opening with the system player.
				</div>
			)}

			{/* Панель управления — оверлей поверх видео */}
			<div style={{
				position: 'absolute', left: 0, right: 0, bottom: 0,
				height: CONTROLS_H,
				background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0) 100%)',
				display: 'flex', flexDirection: 'column', justifyContent: 'center',
				padding: '0 16px', gap: 10,
				opacity: controlsVisible ? 1 : 0,
				pointerEvents: controlsVisible ? 'auto' : 'none',
				transition: 'opacity 0.25s ease',
			}}>
				{/* Прогресс-бар */}
				<div
					ref={progressRef}
					onMouseDown={handleProgressDown}
					style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
				>
					<div style={{ position: 'absolute', width: '100%', height: 4, background: '#2e2e2e', borderRadius: 2 }}>
						<div style={{ width: `${pct}%`, height: '100%', background: '#4fc3f7', borderRadius: 2 }} />
					</div>
					<div style={{
						position: 'absolute', left: `${pct}%`, top: '50%',
						transform: 'translate(-50%, -50%)', width: 12, height: 12,
						borderRadius: '50%', background: '#fff', boxShadow: '0 0 4px rgba(0,0,0,0.6)',
						pointerEvents: 'none',
					}} />
				</div>

				{/* Play + время + громкость */}
				<div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
					<button onClick={togglePlay} style={btnStyle}>
						{playing ? '⏸' : '▶'}
					</button>
					<span style={{ color: '#777', fontSize: 12, fontFamily: 'monospace' }}>
						{formatTime(currentTime)} / {formatTime(duration)}
					</span>

					{/* Громкость — выравниваем вправо */}
					<div style={{ flex: 1 }} />
					<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
						<span style={{ fontSize: 14, lineHeight: 1 }}>
							<VolumeIcon volume={volume} />
						</span>
						{/* Слайдер громкости */}
						<div
							ref={volumeRef}
							onMouseDown={handleVolumeDown}
							style={{ position: 'relative', width: 80, height: 20, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
						>
							<div style={{ position: 'absolute', width: '100%', height: 3, background: '#2e2e2e', borderRadius: 2 }}>
								<div style={{ width: `${volume * 100}%`, height: '100%', background: '#aaa', borderRadius: 2 }} />
							</div>
							<div style={{
								position: 'absolute', left: `${volume * 100}%`, top: '50%',
								transform: 'translate(-50%, -50%)', width: 10, height: 10,
								borderRadius: '50%', background: '#ccc',
								pointerEvents: 'none',
							}} />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
