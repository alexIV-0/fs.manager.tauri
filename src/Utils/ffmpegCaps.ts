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
	hap:    { ffmpeg: 'hap',        alpha: true,  pixFmts: ['rgb24', 'rgba'],                  alphaPixFmts: ['rgba'],         quality: 'none',   preset: false },
	hap_q:  { ffmpeg: 'hap',        alpha: false, pixFmts: ['rgb24'],                          alphaPixFmts: [],               quality: 'none',   preset: false },
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
}

export function defaultEncodeSettings(): EncodeSettings {
	return { container: 'mp4', codec: 'h264', preset: 'faster', crf: 22, pixFmt: 'yuv420p' };
}

/** Аргументы видео-энкода (`-c:v … [-preset] [-crf|-profile] [-pix_fmt]`) по настройкам. */
export function buildEncodeArgs(enc: EncodeSettings): string[] {
	const caps = VIDEO_CODECS[enc.codec];
	const out: string[] = ['-c:v', caps?.ffmpeg ?? enc.codec];
	if (caps?.preset) out.push('-preset', enc.preset);
	if (caps?.quality === 'crf') out.push('-crf', String(enc.crf));
	if (caps?.quality === 'prores') out.push('-profile:v', '3');
	if (enc.pixFmt) out.push('-pix_fmt', enc.pixFmt);
	return out;
}
