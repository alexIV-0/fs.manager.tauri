import { useEffect, useRef, useState } from 'react';
import { toFileUrl, formatTime } from '@/Utils/mediaUtils';
import { commands } from '@/Utils/specta';

const CANVAS_H = 180;
const CONTROLS_H = 68;
const WINDOW_W = 640;

function VolumeIcon({ volume }: { volume: number }) {
	if (volume === 0) return <span>🔇</span>;
	if (volume < 0.4) return <span>🔈</span>;
	if (volume < 0.8) return <span>🔉</span>;
	return <span>🔊</span>;
}

export function AudioPreview({ filePath }: { filePath: string }) {
	const audioRef = useRef<HTMLAudioElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const animRef = useRef<number>(0);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const audioCtxRef = useRef<AudioContext | null>(null);
	const progressRef = useRef<HTMLDivElement>(null);
	const volumeRef = useRef<HTMLDivElement>(null);
	const draggingRef = useRef(false);
	const draggingVolRef = useRef(false);
	const isSetupRef = useRef(false);

	const [playing, setPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [volume, setVolume] = useState(1);

	// Применяем громкость к audio элементу
	useEffect(() => {
		if (audioRef.current) audioRef.current.volume = volume;
	}, [volume]);

	useEffect(() => {
		commands.previewResize({ width: WINDOW_W, height: CANVAS_H + CONTROLS_H });

		const audio = audioRef.current;
		if (!audio) return;

		audio.onloadedmetadata = () => setDuration(audio.duration);
		audio.play().catch(() => {});

		return () => {
			cancelAnimationFrame(animRef.current);
			audioCtxRef.current?.close();
			audioCtxRef.current = null;
			analyserRef.current = null;
			isSetupRef.current = false;
		};
	}, [filePath]);

	const setupVisualizer = () => {
		if (isSetupRef.current || !audioRef.current) return;
		isSetupRef.current = true;

		const audioCtx = new AudioContext();
		audioCtxRef.current = audioCtx;

		const source = audioCtx.createMediaElementSource(audioRef.current);
		const analyser = audioCtx.createAnalyser();
		analyser.fftSize = 512;
		source.connect(analyser);
		analyser.connect(audioCtx.destination);
		analyserRef.current = analyser;

		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d')!;
		const bufLen = analyser.frequencyBinCount;
		const dataArr = new Uint8Array(bufLen);
		const barCount = Math.floor(bufLen * 0.7);

		const draw = () => {
			animRef.current = requestAnimationFrame(draw);
			analyser.getByteFrequencyData(dataArr);

			const { width, height } = canvas;
			ctx.fillStyle = '#0d0d0d';
			ctx.fillRect(0, 0, width, height);

			const barW = (width / barCount) * 0.85;
			const gap = (width / barCount) * 0.15;

			for (let i = 0; i < barCount; i++) {
				const v = dataArr[i] / 255;
				const barH = Math.max(2, v * height * 0.92);
				const hue = 200 + v * 40;
				const light = 30 + v * 35;
				ctx.fillStyle = `hsl(${hue}, 75%, ${light}%)`;
				ctx.fillRect(i * (barW + gap), height - barH, barW, barH);
			}
		};
		draw();
	};

	// Drag-to-seek + drag volume
	useEffect(() => {
		const onMove = (e: MouseEvent) => {
			if (draggingRef.current && progressRef.current && audioRef.current && duration) {
				const rect = progressRef.current.getBoundingClientRect();
				audioRef.current.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
			}
			if (draggingVolRef.current && volumeRef.current) {
				const rect = volumeRef.current.getBoundingClientRect();
				setVolume(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
			}
		};
		const onUp = () => { draggingRef.current = false; draggingVolRef.current = false; };
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
		return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
	}, [duration]);

	const togglePlay = () => {
		const a = audioRef.current;
		if (!a) return;
		if (a.paused) a.play(); else a.pause();
	};

	const handleProgressDown = (e: React.MouseEvent<HTMLDivElement>) => {
		if (!progressRef.current || !audioRef.current || !duration) return;
		draggingRef.current = true;
		const rect = progressRef.current.getBoundingClientRect();
		audioRef.current.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
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

	const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

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
			{/* Канвас визуализатора */}
			<canvas
				ref={canvasRef}
				width={WINDOW_W}
				height={CANVAS_H}
				style={{ width: '100%', height: CANVAS_H, display: 'block', flexShrink: 0 }}
			/>

			<audio
				ref={audioRef}
				src={toFileUrl(filePath)}
				onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
				onPlay={() => { setPlaying(true); setupVisualizer(); }}
				onPause={() => setPlaying(false)}
				onEnded={() => setPlaying(false)}
				style={{ display: 'none' }}
			/>

			{/* Панель управления */}
			<div style={{
				height: CONTROLS_H, background: '#181818',
				display: 'flex', flexDirection: 'column', justifyContent: 'center',
				padding: '0 16px', gap: 10, flexShrink: 0, borderTop: '1px solid #1e1e1e',
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
		</div>
	);
}
