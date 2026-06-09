import { useEffect, useRef, useState } from 'react';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { commands, unwrap } from '@/Utils/specta';
import { toFileUrl } from '@/Utils/mediaUtils';
import { checkerboardStyle } from '@/Utils/CheckerboardBg';

const MAX_DIM = 1280;

export function VideoPreview({ filePath }: { filePath: string }) {
	// hostRef — React-«лист»: внутрь React ничего не рендерит, <video> + обёртки Plyr
	// создаём императивно. Это разрывает конфликт с реконсиляцией React и переживает
	// двойной init/destroy в React.StrictMode (cleanup полностью чистит контейнер).
	const hostRef = useRef<HTMLDivElement>(null);
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const plyrRef = useRef<Plyr | null>(null);
	const transcodingRef = useRef(false);
	const transcodedPathRef = useRef('');

	const [hasAlpha, setHasAlpha] = useState(false);
	const [transcoding, setTranscoding] = useState(false);
	const [error, setError] = useState(false);

	// Ресайз окна под аспект видео.
	const resizeToVideo = (video: HTMLVideoElement) => {
		const vw = video.videoWidth || 1280;
		const vh = video.videoHeight || 720;
		let w = vw;
		let h = vh;
		if (w >= h && w > MAX_DIM) { h = Math.round((h * MAX_DIM) / w); w = MAX_DIM; }
		else if (h > w && h > MAX_DIM) { w = Math.round((w * MAX_DIM) / h); h = MAX_DIM; }
		commands.previewResize({ width: w, height: h, aspectRatio: vw / vh });
	};

	// Если <video> не смог декодировать формат — фоновый транскод в H.264 mp4.
	const handleVideoError = () => {
		if (transcodingRef.current) return;
		if (transcodedPathRef.current) { setError(true); return; } // транскод тоже упал
		setError(false);
		transcodingRef.current = true;
		setTranscoding(true);
		commands.previewTranscodeWebm(filePath)
			.then((r) => {
				const p = unwrap(r);
				if (p) {
					transcodedPathRef.current = p;
					const v = videoRef.current;
					if (v) {
						v.src = toFileUrl(p);
						v.load();
						v.play().catch(() => {});
					}
				} else {
					setError(true);
				}
				transcodingRef.current = false;
				setTranscoding(false);
			})
			.catch((err: any) => {
				console.error('[VideoPreview] transcode error:', err);
				setError(true);
				transcodingRef.current = false;
				setTranscoding(false);
			});
	};

	// Создаём <video> + Plyr императивно.
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		const video = document.createElement('video');
		video.src = toFileUrl(filePath);
		video.playsInline = true;
		video.preload = 'auto';
		videoRef.current = video;

		const onMeta = () => resizeToVideo(video);
		const onErr = () => handleVideoError();
		video.addEventListener('loadedmetadata', onMeta);
		video.addEventListener('error', onErr);
		host.appendChild(video);

		const player = new Plyr(video, {
			controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'fullscreen'],
			autoplay: true,
			clickToPlay: true,
			hideControls: true,
			keyboard: { focused: true, global: true },
			tooltips: { controls: false, seek: true },
			storage: { enabled: false },
		});
		plyrRef.current = player;
		video.play().catch(() => {});

		return () => {
			video.removeEventListener('loadedmetadata', onMeta);
			video.removeEventListener('error', onErr);
			try { player.destroy(); } catch { /* noop */ }
			plyrRef.current = null;
			videoRef.current = null;
			host.replaceChildren(); // полностью очищаем для повторного init в StrictMode
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filePath]);

	// Детекция альфа-канала (индикатор ALPHA) + чистка temp при размонтировании.
	useEffect(() => {
		let mounted = true;
		setHasAlpha(false);
		commands.previewDetectAlpha(filePath)
			.then((r) => { if (mounted) setHasAlpha(!!unwrap(r)); })
			.catch(() => {});
		return () => {
			mounted = false;
			if (transcodedPathRef.current) commands.previewDeleteTemp(transcodedPathRef.current).catch(() => {});
		};
	}, [filePath]);

	// Колёсико мыши регулирует громкость (Plyr сам этого не делает).
	const handleWheel = (e: React.WheelEvent) => {
		const p = plyrRef.current;
		if (!p) return;
		e.preventDefault();
		p.volume = Math.max(0, Math.min(1, p.volume - e.deltaY * 0.001));
	};

	return (
		<div
			className="vp-root"
			style={{
				height: '100vh',
				width: '100vw',
				position: 'relative',
				...checkerboardStyle,
				userSelect: 'none',
				overflow: 'hidden',
			}}
			onWheel={handleWheel}
		>
			{/* Plyr 1:1 в окно; фон прозрачный — под альфой виден checkerboard. Акцент — голубой. */}
			<style>{`
				.vp-root { --plyr-color-main: #4fc3f7; }
				.vp-root .plyr { width: 100%; height: 100%; }
				.vp-root .plyr--video, .vp-root .plyr__video-wrapper { height: 100%; background: transparent; }
				.vp-root .plyr video { width: 100%; height: 100%; object-fit: contain; }
			`}</style>

			{/* Императивный контейнер плеера (React внутрь не лезет) */}
			<div ref={hostRef} style={{ width: '100%', height: '100%' }} />

			{/* Оверлеи — отдельный слой, React-управляемый, без конфликта с DOM Plyr */}
			{hasAlpha && (
				<div style={{
					position: 'absolute', top: 8, right: 8, zIndex: 10,
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
					position: 'absolute', top: 8, left: 8, zIndex: 10,
					background: 'rgba(0,0,0,0.7)', color: '#bbb',
					fontSize: 11, fontFamily: 'system-ui, sans-serif',
					padding: '4px 10px', borderRadius: 4, pointerEvents: 'none',
				}}>
					transcoding...
				</div>
			)}

			{error && (
				<div style={{
					position: 'absolute', top: '40%', left: '50%', zIndex: 10,
					transform: 'translate(-50%, -50%)', color: '#f55', fontSize: 13,
					background: 'rgba(0,0,0,0.7)', padding: '8px 16px', borderRadius: 4,
				}}>
					Cannot decode this format. Try opening with the system player.
				</div>
			)}
		</div>
	);
}
