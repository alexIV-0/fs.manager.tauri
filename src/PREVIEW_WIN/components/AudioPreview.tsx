import { useEffect, useRef, useState } from 'react';
import { useWavesurfer } from '@wavesurfer/react';
import { toFileUrl, formatTime } from '@/Utils/mediaUtils';
import { commands } from '@/Utils/specta';

const WAVE_H = 180;
const CONTROLS_H = 68;
const WINDOW_W = 640;

function VolumeIcon({ volume }: { volume: number }) {
	if (volume === 0) return <span>🔇</span>;
	if (volume < 0.4) return <span>🔈</span>;
	if (volume < 0.8) return <span>🔉</span>;
	return <span>🔊</span>;
}

export function AudioPreview({ filePath }: { filePath: string }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const volumeRef = useRef<HTMLDivElement>(null);
	const draggingVolRef = useRef(false);

	const [volume, setVolume] = useState(1);
	const [duration, setDuration] = useState(0);

	// WaveSurfer декодит файл целиком и рисует waveform. Клик/драг по волне = seek
	// (interact/dragToSeek), поэтому отдельный прогресс-бар больше не нужен.
	const { wavesurfer, isPlaying, currentTime } = useWavesurfer({
		container: containerRef,
		url: toFileUrl(filePath),
		height: WAVE_H,
		waveColor: '#3a4a52',
		progressColor: '#4fc3f7',
		cursorColor: '#fff',
		cursorWidth: 1,
		barWidth: 2,
		barGap: 1,
		barRadius: 2,
		dragToSeek: true,
		normalize: true,
	});

	// Фиксированный размер окна (аудио не имеет аспекта — aspect_ratio не передаём).
	useEffect(() => {
		commands.previewResize({ width: WINDOW_W, height: WAVE_H + CONTROLS_H });
	}, []);

	// На готовности: длительность + автоплей.
	useEffect(() => {
		if (!wavesurfer) return;
		const onReady = () => {
			setDuration(wavesurfer.getDuration());
			wavesurfer.setVolume(volume);
			wavesurfer.play().catch(() => {});
		};
		wavesurfer.on('ready', onReady);
		return () => {
			wavesurfer.un('ready', onReady);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [wavesurfer]);

	// Применяем громкость к инстансу.
	useEffect(() => {
		wavesurfer?.setVolume(volume);
	}, [volume, wavesurfer]);

	// Drag громкости.
	useEffect(() => {
		const onMove = (e: MouseEvent) => {
			if (draggingVolRef.current && volumeRef.current) {
				const rect = volumeRef.current.getBoundingClientRect();
				setVolume(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
			}
		};
		const onUp = () => {
			draggingVolRef.current = false;
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
		return () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
	}, []);

	const togglePlay = () => wavesurfer?.playPause();

	const handleVolumeDown = (e: React.MouseEvent<HTMLDivElement>) => {
		if (!volumeRef.current) return;
		draggingVolRef.current = true;
		const rect = volumeRef.current.getBoundingClientRect();
		setVolume(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
	};

	// Колёсико мыши регулирует громкость.
	const handleWheel = (e: React.WheelEvent) => {
		e.preventDefault();
		setVolume((v) => Math.max(0, Math.min(1, v - e.deltaY * 0.001)));
	};

	const btnStyle: React.CSSProperties = {
		width: 32, height: 32, borderRadius: '50%',
		border: '1px solid #3a3a3a', background: '#252525', color: '#ddd',
		cursor: 'pointer', display: 'flex', alignItems: 'center',
		justifyContent: 'center', fontSize: 13, flexShrink: 0, outline: 'none',
	};

	return (
		<div
			style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0d0d0d', userSelect: 'none' }}
			onWheel={handleWheel}
		>
			{/* Waveform (клик/драг = seek) */}
			<div
				ref={containerRef}
				style={{ width: '100%', height: WAVE_H, flexShrink: 0, cursor: 'pointer' }}
			/>

			{/* Панель управления */}
			<div style={{
				height: CONTROLS_H, background: '#181818',
				display: 'flex', alignItems: 'center',
				padding: '0 16px', gap: 12, flexShrink: 0, borderTop: '1px solid #1e1e1e',
			}}>
				<button onClick={togglePlay} style={btnStyle}>
					{isPlaying ? '⏸' : '▶'}
				</button>
				<span style={{ color: '#777', fontSize: 12, fontFamily: 'monospace' }}>
					{formatTime(currentTime)} / {formatTime(duration)}
				</span>

				<div style={{ flex: 1 }} />

				{/* Громкость */}
				<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
					<span style={{ fontSize: 14, lineHeight: 1 }}>
						<VolumeIcon volume={volume} />
					</span>
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
							borderRadius: '50%', background: '#ccc', pointerEvents: 'none',
						}} />
					</div>
				</div>
			</div>
		</div>
	);
}
