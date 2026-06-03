import { toFileUrl } from '@/Utils/mediaUtils';
import { CheckerboardBg } from '@/Utils/CheckerboardBg';
import { commands } from '@/Utils/specta';

const MAX_DIM = 1280;

export function ImagePreview({ filePath }: { filePath: string }) {
	const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
		const img = e.currentTarget;
		const nw = img.naturalWidth;
		const nh = img.naturalHeight;
		if (nw === 0 || nh === 0) return;

		let w = nw;
		let h = nh;

		// Масштабируем: макс 1280 по длинной стороне
		if (w >= h && w > MAX_DIM) {
			h = Math.round((h * MAX_DIM) / w);
			w = MAX_DIM;
		} else if (h > w && h > MAX_DIM) {
			w = Math.round((w * MAX_DIM) / h);
			h = MAX_DIM;
		}

		commands.previewResize({ width: w, height: h, aspectRatio: nw / nh });
	};

	return (
		<CheckerboardBg
			style={{
				height: '100vh',
				width: '100vw',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				overflow: 'hidden',
			}}
		>
			<img
				src={toFileUrl(filePath)}
				onLoad={handleLoad}
				style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
				alt={filePath}
			/>
		</CheckerboardBg>
	);
}
