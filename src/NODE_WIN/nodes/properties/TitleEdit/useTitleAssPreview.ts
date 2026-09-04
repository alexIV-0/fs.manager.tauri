// src/NODE_WIN/nodes/properties/TitleEdit/useTitleAssPreview.ts
//
// Готовит .ass для превью титров — ТЕМ ЖЕ кодом, которым плагин addTitle строит
// финальный файл (`@/Utils/titleAss`). Отсюда и смысл всей затеи: превью
// перестаёт быть похожим на результат и становится им — один и тот же ASS,
// один и тот же libass, разница только в том, что кадр один.
//
// Хук отдаёт путь к файлу и ключ графа; рендерит кадр общий движок превью
// (`usePreviewCache` → Rust `preview_render_frame`), как у keying/convert.

import { useEffect, useRef, useState } from 'react';
import { commands, unwrap } from '@/Utils/specta';
import { toFileUrl } from '@/Utils/mediaUtils';
import {
	TitleFormatSettings,
	buildAssFile,
	buildPreviewLines,
	buildPreviewPhrase,
	createMeasurer,
	resolveAssFontName,
	scaleSettingsToVideo,
} from '@/Utils/titleAss';

interface SystemFontLite {
	name: string;
	path: string;
}

// Список шрифтов один на окно: он не меняется, а Rust обходит системные папки.
let fontsPromise: Promise<SystemFontLite[]> | null = null;
function systemFonts(): Promise<SystemFontLite[]> {
	if (!fontsPromise) {
		fontsPromise = commands
			.fontsGetList()
			.then(unwrap)
			.catch(() => [] as SystemFontLite[]);
	}
	return fontsPromise;
}

/** Поиск как в `ctx.fonts.find`: без учёта регистра, дефисов и пробелов. */
function findFont(list: SystemFontLite[], name: string): SystemFontLite | undefined {
	const norm = (s: string) => s.toLowerCase().replace(/[-_ ]/g, '');
	const target = norm(name);
	return list.find((f) => norm(f.name) === target);
}

/** Короткий стабильный хэш содержимого — им же именуется файл и ключуется кэш кадров. */
function hash(text: string): string {
	let h = 5381;
	for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
	return (h >>> 0).toString(36);
}

interface Args {
	/** Настройки ОТКРЫТОЙ вкладки формата (в её design-пространстве). */
	settings: TitleFormatSettings;
	/** Строка-образец из превью. */
	text: string;
	/** Стороны кадра подложки — то, что реально увидит фильтр. 0 → превью выключено. */
	frameWidth: number;
	frameHeight: number;
	/** Пока правят текст на холсте, кадр всё равно скрыт — не гоняем ffmpeg впустую. */
	paused?: boolean;
}

export interface TitleAssPreview {
	/** Путь к .ass или null, пока он не готов. */
	assPath: string | null;
	/** Меняется вместе с содержимым — инвалидация кэша кадров. */
	graphKey: string;
	/** Текст ошибки подготовки (шрифт не найден, запись не удалась). */
	error: string | null;
}

/** Пауза перед пересборкой: тянуть слайдер — это десятки изменений в секунду. */
const DEBOUNCE_MS = 180;

export function useTitleAssPreview({ settings, text, frameWidth, frameHeight, paused }: Args): TitleAssPreview {
	const [state, setState] = useState<TitleAssPreview>({ assPath: null, graphKey: '', error: null });

	// Сторож против гонки: пока строился один ASS, настройки могли уехать дальше.
	const genRef = useRef(0);

	useEffect(() => {
		// Держим прежний результат: сбрасывать нечего, кадр под редактором не виден.
		if (paused) return;

		if (!frameWidth || !frameHeight || !text.trim()) {
			setState({ assPath: null, graphKey: '', error: null });
			return;
		}

		const gen = ++genRef.current;
		const timer = window.setTimeout(async () => {
			try {
				// Настройки формата масштабируются под реальный кадр подложки —
				// ровно так же, как плагин масштабирует их под обрабатываемое видео.
				const scaled = scaleSettingsToVideo(settings, frameWidth, frameHeight);

				const fonts = await systemFonts();
				const font = findFont(fonts, scaled.text.font);

				let fontName = scaled.text.font;
				if (font) {
					const { info } = await resolveAssFontName(font.path, font.name, toFileUrl);
					if (info) fontName = info.name;
				}

				const measurer = await createMeasurer(
					font?.path ?? null,
					fontName,
					scaled.text.size,
					scaled.text.bold,
					scaled.text.italic,
					toFileUrl,
				);

				const maxWidthPx = scaled.videoWidth * (scaled.text.wrapWidth / 100);
				const lines = buildPreviewLines(text, maxWidthPx, scaled.text.maxLines, measurer.width);
				const content = buildAssFile([buildPreviewPhrase(lines)], scaled, fontName, measurer);

				const key = hash(content);
				const dir = await commands.osTmpdir();
				// Имя от содержимого: одинаковые настройки → тот же файл → попадание
				// в дисковый кэш кадров вместо повторного прогона ffmpeg.
				const assPath = `${dir}/fsm-title-preview-${key}.ass`;
				unwrap(await commands.writeFile(assPath, content));

				if (gen !== genRef.current) return;
				setState({ assPath, graphKey: key, error: null });
			} catch (e) {
				if (gen !== genRef.current) return;
				setState({ assPath: null, graphKey: '', error: e instanceof Error ? e.message : String(e) });
			}
		}, DEBOUNCE_MS);

		return () => window.clearTimeout(timer);
	}, [settings, text, frameWidth, frameHeight, paused]);

	return state;
}
