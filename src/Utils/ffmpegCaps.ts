// src/Utils/ffmpegCaps.ts
//
// Единый источник правды о совместимости ffmpeg-возможностей для редакторов плагинов
// (convert, keying, ffSwitch…). НЕ дублировать эти таблицы по плагинам — импортировать отсюда.
//
// Описывает ТОЛЬКО жёсткие правила выходного формата:
//   контейнер → допустимые кодеки → (альфа? pix_fmt? тип качества?) и аудио-кодеки.
//
// Alpha-safety ФИЛЬТРОВ здесь НЕТ намеренно: «держит ли фильтр альфу» проверяется не
// статической таблицей, а живым ffmpeg-превью кадра (как в keying) — результат, включая
// потерю альфы, виден сразу. Статика тут была бы хрупкой и быстро устаревала.

// ── Кодеки ───────────────────────────────────────────────────────────────────

export type VideoCodecId =
	| 'h264' | 'h265' | 'vp9' | 'av1' | 'prores' | 'dnxhd' | 'hap' | 'hap_q' | 'copy';
export type AudioCodecId = 'aac' | 'mp3' | 'opus' | 'flac' | 'pcm_s16le' | 'copy';

/** Тип параметра качества кодека → какой контрол показывать. */
export type QualityKind = 'crf' | 'prores' | 'qscale' | 'none';

export interface VideoCodecCaps {
	/** значение для `-c:v` */
	ffmpeg: string;
	/** несёт ли кодек альфу в принципе */
	alpha: boolean;
	/** допустимые pix_fmt (первый — дефолт без альфы) */
	pixFmts: string[];
	/** подмножество pixFmts с альфой (пусто = альфы нет) */
	alphaPixFmts: string[];
	/** тип параметра качества */
	quality: QualityKind;
	/** поддерживает ли `-preset` */
	preset: boolean;
}

export const VIDEO_CODECS: Record<VideoCodecId, VideoCodecCaps> = {
	h264:   { ffmpeg: 'libx264',    alpha: false, pixFmts: ['yuv420p', 'yuv422p', 'yuv444p'],  alphaPixFmts: [],               quality: 'crf',    preset: true  },
	h265:   { ffmpeg: 'libx265',    alpha: false, pixFmts: ['yuv420p', 'yuv420p10le'],         alphaPixFmts: [],               quality: 'crf',    preset: true  },
	vp9:    { ffmpeg: 'libvpx-vp9', alpha: true,  pixFmts: ['yuv420p', 'yuva420p'],            alphaPixFmts: ['yuva420p'],     quality: 'crf',    preset: false },
	av1:    { ffmpeg: 'libsvtav1',  alpha: false, pixFmts: ['yuv420p', 'yuv420p10le'],         alphaPixFmts: [],               quality: 'crf',    preset: false },
	prores: { ffmpeg: 'prores_ks',  alpha: true,  pixFmts: ['yuv422p10le', 'yuva444p10le'],    alphaPixFmts: ['yuva444p10le'], quality: 'prores', preset: false },
	dnxhd:  { ffmpeg: 'dnxhd',      alpha: false, pixFmts: ['yuv422p', 'yuv422p10le'],         alphaPixFmts: [],               quality: 'qscale', preset: false },
	// Hap: у энкодера ОДИН поддерживаемый pix_fmt — `rgba` (проверено `ffmpeg -h encoder=hap`).
	// Альфу решает не формат пикселей, а опция `-format`: hap (DXT1, без альфы) / hap_alpha /
	// hap_q (DXT5-YCoCg, без альфы). Поэтому у `hap` alphaPixFmts == pixFmts: выбирать нечего,
	// и панель этот ряд просто не показывает.
	hap:    { ffmpeg: 'hap',        alpha: true,  pixFmts: ['rgba'],                           alphaPixFmts: ['rgba'],         quality: 'none',   preset: false },
	hap_q:  { ffmpeg: 'hap',        alpha: false, pixFmts: ['rgba'],                           alphaPixFmts: [],               quality: 'none',   preset: false },
	copy:   { ffmpeg: 'copy',       alpha: false, pixFmts: [],                                 alphaPixFmts: [],               quality: 'none',   preset: false },
};

export const AUDIO_CODECS: Record<AudioCodecId, { ffmpeg: string; bitrate: boolean }> = {
	aac:       { ffmpeg: 'aac',        bitrate: true  },
	mp3:       { ffmpeg: 'libmp3lame', bitrate: true  },
	opus:      { ffmpeg: 'libopus',    bitrate: true  },
	flac:      { ffmpeg: 'flac',       bitrate: false },
	pcm_s16le: { ffmpeg: 'pcm_s16le',  bitrate: false },
	copy:      { ffmpeg: 'copy',       bitrate: false },
};

// ── Контейнеры ─────────────────────────────────────────────────────────────────

export interface ContainerCaps {
	/** допустимые видео-кодеки (первый — дефолт) */
	videoCodecs: VideoCodecId[];
	/** допустимые аудио-кодеки (первый — дефолт) */
	audioCodecs: AudioCodecId[];
}

export const CONTAINERS: Record<string, ContainerCaps> = {
	mp4:  { videoCodecs: ['h264', 'h265', 'av1', 'copy'],                            audioCodecs: ['aac', 'copy'] },
	mkv:  { videoCodecs: ['h264', 'h265', 'vp9', 'av1', 'copy'],                     audioCodecs: ['aac', 'opus', 'mp3', 'flac', 'copy'] },
	mov:  { videoCodecs: ['h264', 'h265', 'prores', 'dnxhd', 'hap', 'hap_q', 'copy'], audioCodecs: ['aac', 'pcm_s16le', 'copy'] },
	webm: { videoCodecs: ['vp9', 'av1', 'copy'],                                     audioCodecs: ['opus', 'copy'] },
	avi:  { videoCodecs: ['h264', 'h265', 'copy'],                                   audioCodecs: ['mp3', 'aac', 'copy'] },
	mxf:  { videoCodecs: ['dnxhd', 'h264', 'copy'],                                  audioCodecs: ['pcm_s16le', 'copy'] },
	ts:   { videoCodecs: ['h264', 'h265', 'copy'],                                   audioCodecs: ['aac', 'mp3', 'copy'] },
};

// ── Производные хелперы (UI дёргает их, а не таблицы напрямую) ───────────────────

const FALLBACK_VIDEO: VideoCodecId[] = ['h264', 'h265', 'copy'];
const FALLBACK_AUDIO: AudioCodecId[] = ['aac', 'copy'];

export function videoCodecsForContainer(container: string): VideoCodecId[] {
	return CONTAINERS[container]?.videoCodecs ?? FALLBACK_VIDEO;
}

export function defaultVideoCodec(container: string): VideoCodecId {
	return videoCodecsForContainer(container)[0];
}

export function audioCodecsForContainer(container: string): AudioCodecId[] {
	return CONTAINERS[container]?.audioCodecs ?? FALLBACK_AUDIO;
}

/** Возможна ли альфа на выходе при данном контейнере+кодеке (показывать ли тумблер). */
export function alphaAvailable(container: string, codec: VideoCodecId): boolean {
	return videoCodecsForContainer(container).includes(codec) && VIDEO_CODECS[codec]?.alpha === true;
}

/** Допустимые pix_fmt: нужна альфа → только alphaPixFmts, иначе обычные (без альфа-форматов). */
export function pixFmtsFor(codec: VideoCodecId, wantAlpha: boolean): string[] {
	const c = VIDEO_CODECS[codec];
	if (!c) return [];
	if (wantAlpha) return c.alphaPixFmts;
	return c.pixFmts.filter((p) => !c.alphaPixFmts.includes(p));
}

// ── Render-настройки (энкод-тема для плагинов: ffSwitch, overlay, merge…) ─────
// Общий тип + билдер аргументов, чтобы плагины не зашивали `-c:v libx264 …`.

export const VIDEO_PRESETS = [
	'ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow',
] as const;

/** Контейнеры для render-настроек: 'original' = сохранить исходный, иначе конкретный. */
export const ENCODE_CONTAINERS = ['original', 'mp4', 'mov', 'mkv', 'webm'] as const;

export interface EncodeSettings {
	/** 'original' (расширение источника) | 'mp4' | 'mov' | … — определяет выходное расширение. */
	container: string;
	codec: VideoCodecId;
	preset: string;
	crf: number;
	pixFmt: string;
	/**
	 * Нужна ли альфа на выходе. Осмысленно только там, где `alphaAvailable` = true
	 * (ProRes 4444, Hap Alpha, VP9 yuva420p) — иначе игнорируется.
	 *
	 * Необязательное: настройки, сохранённые до появления флага, его не знают.
	 */
	alpha?: boolean;
}

/**
 * Именованные наборы дефолтов. Плагин и шапка ноды обязаны брать дефолт ИЗ ОДНОГО МЕСТА:
 * иначе попап показывает mp4/h264, а рендер молча уходит в другой кодек, и «настройка не
 * работает» — при том что оба конца по-своему правы.
 *
 * Наборы повторяют то, чем плагины кодировали ДО появления попапа, — включение настройки
 * не должно менять результат у тех, кто её не трогал:
 *   • `standard` — ffSwitch, overlay (`libx264 -preset faster -crf 22`);
 *   • `quality`  — титры (`-preset fast -crf 18`): текст первым сыпется на артефактах;
 *   • `fastCut`  — нарезка (`-preset superfast`, crf 23 = дефолт x264: своего `-crf`
 *                  у нарезки не было вовсе, и профиль обязан это повторить);
 *   • `hapMov`   — кеинг (`mov` + Hap Q + snappy).
 */
export type EncodeProfileId = 'standard' | 'quality' | 'fastCut' | 'hapMov';

const ENCODE_PROFILES: Record<EncodeProfileId, EncodeSettings> = {
	standard: { container: 'mp4', codec: 'h264',  preset: 'faster',     crf: 22, pixFmt: 'yuv420p' },
	quality:  { container: 'mp4', codec: 'h264',  preset: 'fast',       crf: 18, pixFmt: 'yuv420p' },
	fastCut:  { container: 'mp4', codec: 'h264',  preset: 'superfast',  crf: 23, pixFmt: 'yuv420p' },
	hapMov:   { container: 'mov', codec: 'hap_q', preset: 'faster',     crf: 22, pixFmt: 'rgba'    },
};

/** Копия набора дефолтов — копия, а не сама запись: настройки правятся по месту. */
export function encodeProfile(id: EncodeProfileId): EncodeSettings {
	return { ...ENCODE_PROFILES[id] };
}

export function defaultEncodeSettings(): EncodeSettings {
	return encodeProfile('standard');
}

/**
 * Расширение выходного файла по настройкам. ОДНО правило на все плагины: `original`
 * означает «как у источника», иначе имя контейнера и есть расширение.
 *
 * Без `path` намеренно — модуль импортируется и в приложение, и в плагины (esbuild), и
 * тащить в него node-зависимости нельзя.
 */
export function encodeExt(enc: EncodeSettings, sourcePath: string, fallback = 'mp4'): string {
	if (enc.container && enc.container !== 'original') return enc.container;
	const name = String(sourcePath ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
	const dot = name.lastIndexOf('.');
	// В нижний регистр: `clip.MOV` не должен родить `result.MOV` — расширения в проекте
	// строчные, и на регистро-чувствительной ФС разнобой ловится потом масками.
	const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
	return ext || fallback;
}

/**
 * JSON из свойства ноды → `EncodeSettings`, поле за полем, с падением на профиль.
 *
 * Побитово, а не `{...base, ...parsed}`: в свойстве лежит то, что записал попап на
 * ЛЮБОЙ прошлой версии программы, и один пришедший `null` или строка вместо числа
 * ушли бы прямиком в аргументы ffmpeg. Дешевле проверить пять полей здесь, чем
 * разбирать «Invalid argument» из середины ночного прогона.
 */
export function parseEncodeSettings(raw: unknown, fallback: EncodeProfileId = 'standard'): EncodeSettings {
	const base = encodeProfile(fallback);
	let obj: unknown = raw;
	if (typeof raw === 'string') {
		try {
			obj = raw ? JSON.parse(raw) : null;
		} catch {
			obj = null;
		}
	}
	if (!obj || typeof obj !== 'object') return base;
	const o = obj as Record<string, unknown>;
	return {
		container: typeof o.container === 'string' && o.container ? o.container : base.container,
		codec: typeof o.codec === 'string' && o.codec ? (o.codec as VideoCodecId) : base.codec,
		preset: typeof o.preset === 'string' && o.preset ? o.preset : base.preset,
		crf: typeof o.crf === 'number' && Number.isFinite(o.crf) ? o.crf : base.crf,
		pixFmt: typeof o.pixFmt === 'string' ? o.pixFmt : base.pixFmt,
		alpha: typeof o.alpha === 'boolean' ? o.alpha : base.alpha,
	};
}

/** Аргументы видео-энкода (`-c:v … [-preset] [-crf|-profile] [-format] [-pix_fmt]`). */
export function buildEncodeArgs(enc: EncodeSettings): string[] {
	const caps = VIDEO_CODECS[enc.codec];
	// Альфу просят только там, где кодек её несёт: `alpha` у mp4/h264 — не ошибка
	// пользователя, а остаток от прежнего выбора кодека, и молча игнорировать его правильнее,
	// чем ронять рендер.
	const wantAlpha = Boolean(enc.alpha) && caps?.alpha === true;
	const out: string[] = ['-c:v', caps?.ffmpeg ?? enc.codec];
	if (caps?.preset) out.push('-preset', enc.preset);
	if (caps?.quality === 'crf') out.push('-crf', String(enc.crf));
	// ProRes: 4444 — единственный профиль с альфой, 3 (HQ) — обычный.
	if (caps?.quality === 'prores') out.push('-profile:v', wantAlpha ? '4444' : '3');
	// Hap: вариант — приватная опция энкодера, а не отдельный кодек. `-compressor snappy`
	// оставлен явно: это дефолт энкодера, но именно эту сборку проверяет ffmpeg-гейт
	// (`ffmpeg_requirements.json`), и явный аргумент делает требование видимым в команде.
	if (enc.codec === 'hap' || enc.codec === 'hap_q') {
		out.push('-format', enc.codec === 'hap_q' ? 'hap_q' : wantAlpha ? 'hap_alpha' : 'hap');
		out.push('-compressor', 'snappy');
	}
	// pix_fmt сверяем с кодеком, а не берём как есть: настройки могли пережить смену кодека
	// (был ProRes с yuva444p10le, стал h264) — и тогда ffmpeg отказался бы кодировать вовсе.
	const allowed = pixFmtsFor(enc.codec, wantAlpha);
	const pixFmt = allowed.includes(enc.pixFmt) ? enc.pixFmt : allowed[0];
	if (pixFmt) out.push('-pix_fmt', pixFmt);
	return out;
}
