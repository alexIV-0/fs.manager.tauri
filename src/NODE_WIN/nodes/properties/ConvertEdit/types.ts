// src/NODE_WIN/nodes/properties/ConvertEdit/types.ts

// ── Utility ────────────────────────────────────────────────────────────────

export function uid(): string {
	return Math.random().toString(36).slice(2, 10);
}

// ── Format types ───────────────────────────────────────────────────────────

// Both are dynamic strings from typeOfFile_store.
// Fallbacks used only when the store is empty.
export type ImageFormat    = string;
export type VideoContainer = string;

export const FALLBACK_IMAGE_FORMATS    = ['png', 'jpg', 'webp', 'tiff', 'bmp'];
export const FALLBACK_VIDEO_CONTAINERS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'mxf', 'ts'];

export const VIDEO_CODECS   = ['h264', 'h265', 'vp9', 'av1', 'prores', 'dnxhd', 'hap', 'hap_q', 'copy'] as const;
export type  VideoCodec     = (typeof VIDEO_CODECS)[number];

export const VIDEO_PRESETS  = [
	'ultrafast', 'superfast', 'veryfast', 'faster', 'fast',
	'medium', 'slow', 'slower', 'veryslow',
] as const;
export type  VideoPreset    = (typeof VIDEO_PRESETS)[number];

export const AUDIO_CODECS   = ['aac', 'mp3', 'opus', 'flac', 'pcm_s16le', 'copy'] as const;
export type  AudioCodec     = (typeof AUDIO_CODECS)[number];

export const AUDIO_BITRATES = ['64k', '96k', '128k', '192k', '256k', '320k'] as const;
export type  AudioBitrate   = (typeof AUDIO_BITRATES)[number];

export const AUDIO_SAMPLE_RATES = [22050, 44100, 48000, 96000] as const;
export type  AudioSampleRate    = (typeof AUDIO_SAMPLE_RATES)[number];

export const PIXEL_FORMATS  = ['yuv420p', 'yuv422p', 'yuv444p', 'yuv420p10le', 'yuv422p10le'] as const;
export type  PixelFormat    = (typeof PIXEL_FORMATS)[number];

export type ScaleMode = 'original' | 'pct' | 'fixed';

// ── Video / Image filter item types ───────────────────────────────────────
// Every filter has `enabled?: boolean`. Undefined = enabled.

export interface FilterScale {
	id: string; type: 'scale'; enabled?: boolean;
	mode: ScaleMode;
	widthPct: number; heightPct: number;
	fixedW: number;   fixedH: number;
	lockAspect: boolean;
}
export interface FilterCrop {
	id: string; type: 'crop'; enabled?: boolean;
	x: number; y: number; w: number; h: number;
	unit: 'pct' | 'px';
}
export interface FilterBlur        { id: string; type: 'blur';        enabled?: boolean; sigma: number; }
export interface FilterDeinterlace { id: string; type: 'deinterlace'; enabled?: boolean; mode: 'yadif' | 'bwdif'; }
export interface FilterEq {
	id: string; type: 'eq'; enabled?: boolean;
	brightness: number; contrast: number; saturation: number; gamma: number;
}
export interface FilterHFlip    { id: string; type: 'hflip';   enabled?: boolean; }
export interface FilterVFlip    { id: string; type: 'vflip';   enabled?: boolean; }
export interface FilterFps      { id: string; type: 'fps';     enabled?: boolean; value: number; smooth?: boolean; }
export interface FilterUnsharp  { id: string; type: 'unsharp'; enabled?: boolean; method?: 'unsharp' | 'cas'; lumaAmount: number; lumaSize: number; strength?: number; }
export interface FilterDenoise  { id: string; type: 'denoise'; enabled?: boolean; method?: 'hqdn3d' | 'fftdnoiz' | 'nlmeans' | 'atadenoise'; strength: number; }
export interface FilterPixFmt   { id: string; type: 'pixfmt';  enabled?: boolean; value: PixelFormat; }
export interface FilterRotate   { id: string; type: 'rotate';  enabled?: boolean; angle: 0 | 90 | 180 | 270; }
export interface FilterDeband   { id: string; type: 'deband';  enabled?: boolean; strength: number; }
export interface FilterCleanup  { id: string; type: 'cleanup'; enabled?: boolean; deblock: boolean; chromaNr: boolean; }
export interface FilterHue        { id: string; type: 'hue';          enabled?: boolean; degrees: number; saturation: number; }
export interface FilterCurves     { id: string; type: 'curves';       enabled?: boolean; preset: string; }
export interface FilterColorMix   { id: string; type: 'colormix';     enabled?: boolean; preset: 'grayscale' | 'sepia' | 'swapRB'; }
export interface FilterColorBal   { id: string; type: 'colorbalance'; enabled?: boolean; rs: number; gs: number; bs: number; rm: number; gm: number; bm: number; rh: number; gh: number; bh: number; }
export interface FilterLut3d      { id: string; type: 'lut3d';        enabled?: boolean; file: string; }
export interface FilterVignette   { id: string; type: 'vignette';     enabled?: boolean; amount: number; }

/** Position — places the source image inside the Frame canvas at xPct/yPct.
 *  0 = left/top, 50 = centered, 100 = right/bottom. */
export interface FilterPosition {
	id: string; type: 'position'; enabled?: boolean;
	xPct: number; // 0–100
	yPct: number;
}

/** Background colour for empty areas left by Position / shrink-Scale.
 *  When no bgcolor filter is present, black is used. */
export interface FilterBgColor {
	id: string; type: 'bgcolor'; enabled?: boolean;
	color: string; // '#rrggbb'
}

export type VideoFilterItem =
	| FilterScale | FilterCrop | FilterBlur | FilterDeinterlace
	| FilterEq    | FilterHFlip | FilterVFlip | FilterFps
	| FilterUnsharp | FilterDenoise | FilterPixFmt | FilterRotate
	| FilterPosition | FilterBgColor
	| FilterDeband | FilterCleanup
	| FilterHue | FilterCurves | FilterColorMix | FilterColorBal | FilterLut3d | FilterVignette;

/** Image filters = all video filters except deinterlace, fps, pixfmt */
export type ImageFilterItem = Exclude<VideoFilterItem, FilterDeinterlace | FilterFps | FilterPixFmt>;

export type VideoFilterType = VideoFilterItem['type'];
export type ImageFilterType = ImageFilterItem['type'];

export const VIDEO_FILTER_LABELS: Record<VideoFilterType, string> = {
	scale:       'Scale / Resize',
	crop:        'Crop',
	blur:        'Blur',
	deinterlace: 'Deinterlace',
	eq:          'Color Eq (brightness / contrast…)',
	hflip:       'Flip Horizontal',
	vflip:       'Flip Vertical',
	fps:         'Force FPS',
	unsharp:     'Sharpen / Unsharp Mask',
	denoise:     'Denoise',
	pixfmt:      'Pixel Format',
	rotate:      'Rotate',
	position:    'Position in Frame (X/Y)',
	bgcolor:     'Background Color',
	deband:      'Debanding (sky / gradients)',
	cleanup:     'Compression Cleanup',
	hue:         'Hue / Saturation',
	curves:      'Curves (presets)',
	colormix:    'Channel Mixer (b/w · sepia · swap)',
	colorbalance:'Color Balance (shadows/mids/highs)',
	lut3d:       'LUT (.cube)',
	vignette:    'Vignette',
};

export const IMAGE_FILTER_LABELS: Partial<Record<VideoFilterType, string>> = {
	scale:    'Scale / Resize',
	crop:     'Crop',
	blur:     'Blur',
	eq:       'Color Eq (brightness / contrast…)',
	hflip:    'Flip Horizontal',
	vflip:    'Flip Vertical',
	unsharp:  'Sharpen / Unsharp Mask',
	denoise:  'Denoise',
	rotate:   'Rotate',
	position: 'Position in Frame (X/Y)',
	hue:      'Hue / Saturation',
	curves:   'Curves (presets)',
	colormix: 'Channel Mixer (b/w · sepia · swap)',
	colorbalance: 'Color Balance',
	lut3d:    'LUT (.cube)',
	vignette: 'Vignette',
	bgcolor:  'Background Color',
};

// ── Audio filter item types ────────────────────────────────────────────────

export interface FilterLoudnorm {
	id: string; type: 'loudnorm'; enabled?: boolean;
	target: number; range: number; tp: number;
}
export interface FilterVolume   { id: string; type: 'volume';   enabled?: boolean; db:     number; }
export interface FilterHighpass { id: string; type: 'highpass'; enabled?: boolean; freq:   number; }
export interface FilterLowpass  { id: string; type: 'lowpass';  enabled?: boolean; freq:   number; }
export interface FilterAtempo   { id: string; type: 'atempo';   enabled?: boolean; factor: number; }
export interface FilterACompressor { id: string; type: 'acompressor'; enabled?: boolean; threshold: number; ratio: number; }
export interface FilterALimiter    { id: string; type: 'alimiter';    enabled?: boolean; limitDb: number; }
export interface FilterAGate       { id: string; type: 'agate';       enabled?: boolean; thresholdDb: number; }
export interface FilterAfftdn      { id: string; type: 'afftdn';      enabled?: boolean; noiseFloor: number; }
export interface FilterSpeechNorm  { id: string; type: 'speechnorm';  enabled?: boolean; peak: number; }
export interface FilterDynAudNorm  { id: string; type: 'dynaudnorm';  enabled?: boolean; strength: number; }
export interface FilterEqualizer   { id: string; type: 'equalizer';   enabled?: boolean; freq: number; gain: number; }
export interface FilterRubberband  { id: string; type: 'rubberband';  enabled?: boolean; tempo: number; pitch: number; }

export type AudioFilterItem =
	| FilterLoudnorm | FilterVolume | FilterHighpass | FilterLowpass | FilterAtempo
	| FilterACompressor | FilterALimiter | FilterAGate | FilterAfftdn
	| FilterSpeechNorm | FilterDynAudNorm | FilterEqualizer | FilterRubberband;
export type AudioFilterType = AudioFilterItem['type'];

export const AUDIO_FILTER_LABELS: Record<AudioFilterType, string> = {
	loudnorm: 'Loudness Normalize (LUFS)',
	volume:   'Volume Adjust (dB)',
	highpass: 'High-pass Filter',
	lowpass:  'Low-pass Filter',
	atempo:   'Tempo / Speed',
	acompressor: 'Compressor',
	alimiter:    'Limiter',
	agate:       'Noise Gate',
	afftdn:      'Denoise (FFT)',
	speechnorm:  'Speech Normalize',
	dynaudnorm:  'Dynamic Normalize',
	equalizer:   'Equalizer (1-band)',
	rubberband:  'Pitch / Tempo (rubberband)',
};

// ── Frame / Output Canvas ─────────────────────────────────────────────────

/** Defines the output frame (canvas) size for video.
 *  By default (no Position/Scale filters) source is scaled to *cover* the frame —
 *  centered, aspect preserved, overflow cropped. Use Position / Scale / Background
 *  filters to override this default behaviour. */
export interface FrameSettings {
	mode:       'original' | 'fixed';
	width:      number;     // 0 = auto (derive from source aspect using the other dimension)
	height:     number;     // 0 = auto
	lockAspect: boolean;    // deprecated / unused — aspect is now expressed via a 0 dimension
}

export function defaultFrameSettings(): FrameSettings {
	return { mode: 'original', width: 1920, height: 1080, lockAspect: false };
}

// ── Settings interfaces ────────────────────────────────────────────────────

export interface ImageConvertSettings {
	quality: number; // 0–100
	filters: ImageFilterItem[];
}

export interface VideoConvertSettings {
	enabled: boolean;
	frame:   FrameSettings;
	codec:   VideoCodec;
	preset:  VideoPreset;
	crf:     number; // 0–51
	pixFmt?: string;   // encode-level -pix_fmt (из ffmpegCaps); undefined = дефолт кодека
	alpha?:  boolean;  // сохранять альфу на выходе (только если кодек умеет — ffmpegCaps)
	filters: VideoFilterItem[];
}

export interface AudioConvertSettings {
	enabled:    boolean;
	codec:      AudioCodec;
	bitrate:    AudioBitrate;
	sampleRate: AudioSampleRate;
	channels:   number; // 1, 2, 6
	filters:    AudioFilterItem[];
}

export interface ConvertSettings {
	/** Output file extension — single source of truth for format.
	 *  Determines which sections to show: image/video/audio. */
	outputExtension: string;
	image: ImageConvertSettings;
	video: VideoConvertSettings;
	audio: AudioConvertSettings;
	filePath?: string;
}

// ── Default factories ──────────────────────────────────────────────────────

export function defaultVideoConvertSettings(): VideoConvertSettings {
	return { enabled: true, frame: defaultFrameSettings(), codec: 'h264', preset: 'fast', crf: 23, filters: [] };
}

export function defaultAudioConvertSettings(): AudioConvertSettings {
	return { enabled: true, codec: 'aac', bitrate: '192k', sampleRate: 48000, channels: 2, filters: [] };
}

export function defaultConvertSettings(): ConvertSettings {
	return {
		outputExtension: 'mp4',
		image: { quality: 85, filters: [] },
		video: defaultVideoConvertSettings(),
		audio: defaultAudioConvertSettings(),
	};
}

// ── Default filter factories ───────────────────────────────────────────────

export function defaultVideoFilter(type: VideoFilterType): VideoFilterItem {
	switch (type) {
		case 'scale':       return { id: uid(), type, enabled: true, mode: 'pct', widthPct: 100, heightPct: 100, fixedW: 1920, fixedH: 1080, lockAspect: true };
		case 'crop':        return { id: uid(), type, enabled: true, x: 0, y: 0, w: 100, h: 100, unit: 'pct' };
		case 'blur':        return { id: uid(), type, enabled: true, sigma: 2 };
		case 'deinterlace': return { id: uid(), type, enabled: true, mode: 'yadif' };
		case 'eq':          return { id: uid(), type, enabled: true, brightness: 0, contrast: 1, saturation: 1, gamma: 1 };
		case 'hflip':       return { id: uid(), type, enabled: true };
		case 'vflip':       return { id: uid(), type, enabled: true };
		case 'fps':         return { id: uid(), type, enabled: true, value: 25, smooth: false };
		case 'unsharp':     return { id: uid(), type, enabled: true, method: 'cas', lumaAmount: 1.5, lumaSize: 5, strength: 0.4 };
		case 'denoise':     return { id: uid(), type, enabled: true, method: 'hqdn3d', strength: 3 };
		case 'pixfmt':      return { id: uid(), type, enabled: true, value: 'yuv420p' };
		case 'rotate':      return { id: uid(), type, enabled: true, angle: 90 };
		case 'position':    return { id: uid(), type, enabled: true, xPct: 50, yPct: 50 };
		case 'bgcolor':     return { id: uid(), type, enabled: true, color: '#000000' };
		case 'deband':      return { id: uid(), type, enabled: true, strength: 20 };
		case 'cleanup':     return { id: uid(), type, enabled: true, deblock: true, chromaNr: false };
		case 'hue':         return { id: uid(), type, enabled: true, degrees: 0, saturation: 1 };
		case 'curves':      return { id: uid(), type, enabled: true, preset: 'increase_contrast' };
		case 'colormix':    return { id: uid(), type, enabled: true, preset: 'grayscale' };
		case 'colorbalance':return { id: uid(), type, enabled: true, rs: 0, gs: 0, bs: 0, rm: 0, gm: 0, bm: 0, rh: 0, gh: 0, bh: 0 };
		case 'lut3d':       return { id: uid(), type, enabled: true, file: '' };
		case 'vignette':    return { id: uid(), type, enabled: true, amount: 30 };
	}
}

export function defaultAudioFilter(type: AudioFilterType): AudioFilterItem {
	switch (type) {
		case 'loudnorm': return { id: uid(), type, enabled: true, target: -23, range: 11, tp: -1 };
		case 'volume':   return { id: uid(), type, enabled: true, db: 0 };
		case 'highpass': return { id: uid(), type, enabled: true, freq: 80 };
		case 'lowpass':  return { id: uid(), type, enabled: true, freq: 16000 };
		case 'atempo':   return { id: uid(), type, enabled: true, factor: 1.0 };
		case 'acompressor': return { id: uid(), type, enabled: true, threshold: -18, ratio: 3 };
		case 'alimiter':    return { id: uid(), type, enabled: true, limitDb: -1 };
		case 'agate':       return { id: uid(), type, enabled: true, thresholdDb: -40 };
		case 'afftdn':      return { id: uid(), type, enabled: true, noiseFloor: -25 };
		case 'speechnorm':  return { id: uid(), type, enabled: true, peak: 0.95 };
		case 'dynaudnorm':  return { id: uid(), type, enabled: true, strength: 50 };
		case 'equalizer':   return { id: uid(), type, enabled: true, freq: 1000, gain: 0 };
		case 'rubberband':  return { id: uid(), type, enabled: true, tempo: 1, pitch: 1 };
	}
}

// ── ffmpeg filter string builders ─────────────────────────────────────────

function findBgColor(filters: VideoFilterItem[] | ImageFilterItem[]): string {
	const f = (filters as VideoFilterItem[]).find((x) => x.type === 'bgcolor' && x.enabled !== false) as FilterBgColor | undefined;
	return f?.color ?? '#000000';
}

function colorToFfmpeg(hex: string): string {
	return hex.startsWith('#') ? `0x${hex.slice(1)}` : hex;
}

/** Snap a fixed pixel dimension down to the nearest even value. Most video codecs
 *  (h264 / h265 / yuv420p …) reject odd width/height, so every explicit size we emit
 *  must be even. Values ≤0 mean "auto" and are returned unchanged (the `-2` in the
 *  scale expression keeps the auto side even). */
function evenPx(n: number): number {
	return n <= 0 ? n : Math.max(2, Math.floor(n / 2) * 2);
}

/** Wrap a scale width/height *expression* (e.g. `iw*0.7`) so its result is even. */
function evenExpr(expr: string): string {
	return `trunc((${expr})/2)*2`;
}

function buildVideoFilterItems(filters: VideoFilterItem[], frame?: FrameSettings, bgColor: string = '#000000'): string[] {
	const parts: string[] = [];
	for (const f of filters) {
		if (f.enabled === false) continue; // disabled filter — skip
		switch (f.type) {
			case 'scale': {
				if (f.mode === 'original') break;
				if (f.mode === 'pct') {
					const wp = (f.widthPct / 100).toFixed(4);
					const w = evenExpr(`iw*${wp}`);
					const h = f.lockAspect ? '-2' : evenExpr(`ih*${(f.heightPct / 100).toFixed(4)}`);
					parts.push(`scale=${w}:${h}`);
				} else {
					parts.push(`scale=${evenPx(f.fixedW)}:${f.lockAspect ? '-2' : evenPx(f.fixedH)}`);
				}
				break;
			}
			case 'crop': {
				if (f.unit === 'pct') {
					const cw = `iw*${(f.w / 100).toFixed(4)}`;
					const ch = `ih*${(f.h / 100).toFixed(4)}`;
					const cx = `iw*${(f.x / 100).toFixed(4)}`;
					const cy = `ih*${(f.y / 100).toFixed(4)}`;
					parts.push(`crop=${cw}:${ch}:${cx}:${cy}`);
				} else {
					parts.push(`crop=${f.w}:${f.h}:${f.x}:${f.y}`);
				}
				break;
			}
			case 'blur':
				if (f.sigma > 0) parts.push(`gblur=sigma=${f.sigma}`);
				break;
			case 'deinterlace':
				parts.push(f.mode === 'bwdif' ? 'bwdif=0' : 'yadif=0');
				break;
			case 'eq': {
				const eq: string[] = [];
				if (f.brightness !== 0) eq.push(`brightness=${f.brightness.toFixed(3)}`);
				if (f.contrast   !== 1) eq.push(`contrast=${f.contrast.toFixed(3)}`);
				if (f.saturation !== 1) eq.push(`saturation=${f.saturation.toFixed(3)}`);
				if (f.gamma      !== 1) eq.push(`gamma=${f.gamma.toFixed(3)}`);
				if (eq.length > 0) parts.push(`eq=${eq.join(':')}`);
				break;
			}
			case 'hflip':   parts.push('hflip');                                        break;
			case 'vflip':   parts.push('vflip');                                        break;
			case 'fps':     if (f.value > 0) parts.push(f.smooth ? `minterpolate=fps=${f.value}` : `fps=${f.value}`); break;
			case 'unsharp':
					if (f.method === 'cas') parts.push(`cas=${(f.strength ?? 0.4).toFixed(2)}`);
					else parts.push(`unsharp=${f.lumaSize}:${f.lumaSize}:${f.lumaAmount.toFixed(2)}`);
					break;
			case 'denoise': {
					const s = f.strength;
					const m = f.method ?? 'hqdn3d';
					if (m === 'fftdnoiz') parts.push(`fftdnoiz=sigma=${s}`);
					else if (m === 'nlmeans') parts.push(`nlmeans=s=${s}`);
					else if (m === 'atadenoise') parts.push('atadenoise');
					else parts.push(`hqdn3d=${s}`);
				}                         break;
			case 'pixfmt':  parts.push(`format=${f.value}`);                            break;
			case 'rotate':
				if      (f.angle === 90)  parts.push('transpose=1');
				else if (f.angle === 180) parts.push('hflip,vflip');
				else if (f.angle === 270) parts.push('transpose=2');
				break;
			case 'position': {
				// Place the source into the Frame canvas at xPct/yPct, padding empty area with bgColor.
				// xPct/yPct can be ANY value (including outside 0–100) — values past 0 / 100 push the source
				// off the canvas edges (bgColor is shown in the gaps).
				//
				// Implementation: pad source to a large bounding box (iw + 4W) × (ih + 4H) with source
				// centred (offset 2W, 2H). Then crop W×H window at the right offset to show the source at
				// the requested xPct/yPct, clamped so ffmpeg never gets out-of-range crop offsets.
				if (!frame) break;
				const W = frame.mode === 'fixed' ? evenPx(frame.width) : 0;
				const H = frame.mode === 'fixed' ? evenPx(frame.height) : 0;
				if (W <= 0 || H <= 0) break;
				const color = colorToFfmpeg(bgColor);
				const xPct = f.xPct;
				const yPct = f.yPct;
				// In the crop expression: iw = padded width = iw_orig + 4W → iw_orig - W = iw - 5W
				const cropX = `trunc(min(max(${2 * W}+(iw-${5 * W})*${xPct}/100\\,0)\\,iw-${W}))`;
				const cropY = `trunc(min(max(${2 * H}+(ih-${5 * H})*${yPct}/100\\,0)\\,ih-${H}))`;
				parts.push(`pad=iw+${4 * W}:ih+${4 * H}:${2 * W}:${2 * H}:${color}`);
				parts.push(`crop=${W}:${H}:${cropX}:${cropY}`);
				break;
			}
			case 'bgcolor':
				// No-op as a filter line — its colour is consumed by Position / Frame.
				break;
			case 'deband': {
				const t = (f.strength / 1000).toFixed(4);
				parts.push(`deband=1thr=${t}:2thr=${t}:3thr=${t}:4thr=${t}`);
				break;
			}
			case 'cleanup':
				if (f.deblock) parts.push('deblock');
				if (f.chromaNr) parts.push('chromanr');
				break;
			case 'hue':
				parts.push(`hue=h=${f.degrees}:s=${f.saturation}`);
				break;
			case 'curves':
				if (f.preset && f.preset !== 'none') parts.push(`curves=preset=${f.preset}`);
				break;
			case 'colormix': {
				const mix = f.preset === 'sepia'
					? '0.393:0.769:0.189:0:0.349:0.686:0.168:0:0.272:0.534:0.131'
					: f.preset === 'swapRB'
						? '0:0:1:0:0:1:0:0:1:0:0'
						: '0.3:0.59:0.11:0:0.3:0.59:0.11:0:0.3:0.59:0.11';
				parts.push(`colorchannelmixer=${mix}`);
				break;
			}
			case 'colorbalance':
				if ([f.rs, f.gs, f.bs, f.rm, f.gm, f.bm, f.rh, f.gh, f.bh].some((v) => v !== 0))
					parts.push(`colorbalance=rs=${f.rs}:gs=${f.gs}:bs=${f.bs}:rm=${f.rm}:gm=${f.gm}:bm=${f.bm}:rh=${f.rh}:gh=${f.gh}:bh=${f.bh}`);
				break;
			case 'lut3d':
				if (f.file) parts.push(`lut3d='${f.file.replace(/\\/g, '/')}'`);
				break;
			case 'vignette':
				if (f.amount > 0) parts.push(`vignette=angle=${((f.amount / 100) * Math.PI / 2).toFixed(4)}`);
				break;
		}
	}
	return parts;
}

/** Compute the source's dimensions AFTER an enabled Scale filter (before Position pad).
 *  When no Scale filter is active, returns the original source dimensions. */
export function getScaledSourceDims(
	filters: ReadonlyArray<VideoFilterItem | ImageFilterItem>,
	origW: number,
	origH: number,
): { w: number; h: number } {
	const sf = (filters as VideoFilterItem[]).find((f) => f.type === 'scale' && f.enabled !== false) as FilterScale | undefined;
	if (!sf || sf.mode === 'original' || origW <= 0 || origH <= 0) return { w: origW, h: origH };
	if (sf.mode === 'pct') {
		const w = origW * sf.widthPct / 100;
		const h = sf.lockAspect ? (w * origH / origW) : (origH * sf.heightPct / 100);
		return { w, h };
	}
	const w = sf.fixedW;
	const h = sf.lockAspect ? (sf.fixedW * origH / origW) : sf.fixedH;
	return { w, h };
}

/** Output-frame sizing.
 *  - Both W and H > 0  → exact box: cover (scale to fill, preserving aspect) then crop overflow.
 *  - Exactly one > 0   → "auto": that dimension is fixed, the other is derived from the
 *                         source's aspect ratio at conversion time (`-2` = even auto). No crop, no pad.
 *  - Both 0            → no frame scaling. */
export function buildFrameFilterString(frame: FrameSettings): string {
	if (frame.mode !== 'fixed') return '';
	const W = evenPx(frame.width);
	const H = evenPx(frame.height);
	if (W > 0 && H <= 0) return `scale=${W}:-2`;
	if (H > 0 && W <= 0) return `scale=-2:${H}`;
	if (W <= 0 && H <= 0) return '';
	return `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
}

export function buildVideoFilterString(video: VideoConvertSettings): string {
	if (!video.enabled) return '';
	const frame = video.frame ?? defaultFrameSettings();
	const bgColor = findBgColor(video.filters);
	const positionActive = video.filters.some((f) => f.type === 'position' && f.enabled !== false);
	const scaleActive    = video.filters.some((f) => f.type === 'scale'    && f.enabled !== false);
	const parts = buildVideoFilterItems(video.filters, frame, bgColor);

	if (frame.mode === 'fixed') {
		// Cover / pad-crop only make sense for an exact W×H box. When one dimension is
		// "auto" (0), fall through to buildFrameFilterString (scale=W:-2 / scale=-2:H).
		const bothFixed = frame.width > 0 && frame.height > 0;
		if (bothFixed && positionActive) {
			// Position filter is responsible for placing the source inside the frame canvas.
		} else if (bothFixed && scaleActive) {
			// Scale controls the source size; center it inside the frame canvas, pad gaps, crop overflow.
			const W = evenPx(frame.width);
			const H = evenPx(frame.height);
			const color = colorToFfmpeg(bgColor);
			parts.push(`pad=max(iw\\,${W}):max(ih\\,${H}):(ow-iw)/2:(oh-ih)/2:${color}`);
			parts.push(`crop=${W}:${H}:(iw-${W})/2:(ih-${H})/2`);
		} else {
			const frameStr = buildFrameFilterString(frame);
			if (frameStr) parts.push(frameStr);
		}
	}
	return parts.join(',');
}

export function buildImageFilterString(image: ImageConvertSettings): string {
	const bgColor = findBgColor(image.filters);
	return buildVideoFilterItems(image.filters as VideoFilterItem[], undefined, bgColor).join(',');
}

export function buildAudioFilterString(audio: AudioConvertSettings): string {
	if (!audio.enabled) return '';
	const parts: string[] = [];
	for (const f of audio.filters) {
		if (f.enabled === false) continue;
		switch (f.type) {
			case 'loudnorm': parts.push(`loudnorm=I=${f.target}:LRA=${f.range}:TP=${f.tp}`);  break;
			case 'volume':   if (f.db !== 0) parts.push(`volume=${f.db}dB`);                  break;
			case 'highpass': if (f.freq > 0) parts.push(`highpass=f=${f.freq}`);              break;
			case 'lowpass':  if (f.freq > 0) parts.push(`lowpass=f=${f.freq}`);               break;
			case 'atempo':   if (f.factor !== 1) parts.push(`atempo=${f.factor.toFixed(3)}`); break;
			case 'acompressor': parts.push(`acompressor=threshold=${Math.pow(10, f.threshold / 20).toFixed(5)}:ratio=${f.ratio}`); break;
			case 'alimiter':    parts.push(`alimiter=limit=${Math.pow(10, f.limitDb / 20).toFixed(4)}`); break;
			case 'agate':       parts.push(`agate=threshold=${Math.pow(10, f.thresholdDb / 20).toFixed(5)}`); break;
			case 'afftdn':      parts.push(`afftdn=nf=${f.noiseFloor}`); break;
			case 'speechnorm':  parts.push(`speechnorm=p=${f.peak}`); break;
			case 'dynaudnorm':  { const g = Math.max(3, Math.min(301, Math.round((f.strength / 100) * 150) * 2 + 1)); parts.push(`dynaudnorm=g=${g}`); break; }
			case 'equalizer':   if (f.gain !== 0) parts.push(`equalizer=f=${f.freq}:t=o:w=1:g=${f.gain}`); break;
			case 'rubberband':  if (f.tempo !== 1 || f.pitch !== 1) parts.push(`rubberband=tempo=${f.tempo}:pitch=${f.pitch}`); break;
		}
	}
	return parts.join(',');
}

/**
 * Build the -vf filter string for the preview IPC call.
 * `outputMode` is derived by the caller from outputExtension + typeOfFile_store.
 */
export function buildPreviewFilterString(
	settings: ConvertSettings,
	outputMode: 'image' | 'video' | 'audio',
): string {
	if (outputMode === 'image') return buildImageFilterString(settings.image);
	if (outputMode === 'audio') return '';
	return buildVideoFilterString(settings.video);
}
