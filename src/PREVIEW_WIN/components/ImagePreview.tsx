import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
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
				overflow: 'hidden',
			}}
		>
			{/* scale=1 — картинка вписана в окно (objectFit:contain), полей нет (окно
			    ресайзится под аспект). Зум — колесо/double-click, пан — drag. minScale=1:
			    мельче fit'а не уезжаем; limitToBounds держит картинку в кадре. */}
			<TransformWrapper
				initialScale={1}
				minScale={1}
				maxScale={8}
				centerOnInit
				limitToBounds
				doubleClick={{ mode: 'toggle', step: 2 }}
				wheel={{ step: 0.15 }}
			>
				<TransformComponent
					wrapperStyle={{ width: '100%', height: '100%' }}
					contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
				>
					<img
						src={toFileUrl(filePath)}
						onLoad={handleLoad}
						style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
						alt={filePath}
					/>
				</TransformComponent>
			</TransformWrapper>
		</CheckerboardBg>
	);
}
