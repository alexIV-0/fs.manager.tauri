// src/NODE_WIN/nodes/properties/KeyingEdit/types.ts

export interface ChromakeySettings {
	enabled: boolean;
	color: string;      // HEX, e.g. '#00ff00'
	similarity: number; // 0.0–1.0
	blend: number;      // 0.0–1.0
	yuv: boolean;
}

export interface ColorkeySettings {
	enabled: boolean;
	color: string;      // HEX
	similarity: number; // 0.0–1.0
	blend: number;      // 0.0–1.0
}

export interface LumakeySettings {
	enabled: boolean;
	threshold: number;  // 0.0–1.0
	tolerance: number;  // 0.0–1.0
	softness: number;   // 0.0–1.0
}

export interface DespillSettings {
	enabled: boolean;
	color: string;       // HEX — custom spill color
	mix: number;         // 0.0–1.0
	expand: number;      // 0.0–1.0
	brightness: number;  // 0.0–1.0
}

export interface EdgeSettings {
	erosion: number;    // 0–5
	dilation: number;   // 0–5
	blur: number;       // 0.0–3.0 — affects ONLY alpha channel edges
}

export interface KeyingSettings {
	chromakey: ChromakeySettings;
	colorkey: ColorkeySettings;
	lumakey: LumakeySettings;
	despill: DespillSettings;
	edge: EdgeSettings;
	filePath?: string;
}

export function defaultKeyingSettings(): KeyingSettings {
	return {
		chromakey: {
			enabled: true,
			color: '#00ff00',
			similarity: 0.1,
			blend: 0.0,
			yuv: false,
		},
		colorkey: {
			enabled: false,
			color: '#00ff00',
			similarity: 0.1,
			blend: 0.0,
		},
		lumakey: {
			enabled: false,
			threshold: 0.0,
			tolerance: 0.1,
			softness: 0.0,
		},
		despill: {
			enabled: false,
			color: '#00ff00',
			mix: 0.5,
			expand: 0.0,
			brightness: 0.0,
		},
		edge: {
			erosion: 0,
			dilation: 0,
			blur: 0.0,
		},
	};
}

/**
 * Convert RGB hex color to YUV hex string for ffmpeg chromakey yuv=1 mode.
 * ffmpeg with yuv=1 interprets the color bytes as Y, U (Cb), V (Cr).
 * BT.601 full-range conversion.
 */
function rgbHexToYuvHex(hex: string): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
	const y  = clamp( 0.299    * r + 0.587    * g + 0.114    * b);
	const cb = clamp(128 - 0.168736 * r - 0.331264 * g + 0.5      * b);
	const cr = clamp(128 + 0.5      * r - 0.418688 * g - 0.081312 * b);
	return `0x${y.toString(16).padStart(2, '0')}${cb.toString(16).padStart(2, '0')}${cr.toString(16).padStart(2, '0')}`;
}

/**
 * Detect despill type from color hue.
 * Returns 0 for green-ish, 1 for blue-ish, defaults to 0.
 */
function despillTypeFromColor(hex: string): number {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	if (b > g && b > r) return 1; // blue
	return 0; // green (default)
}

/**
 * Build ffmpeg -vf filter string from keying settings.
 * Filters are chained in order: chromakey/colorkey → lumakey → despill → edge.
 *
 * Edge blur uses split[rgb][a] → blur alpha only → alphamerge
 * to avoid blurring the entire image.
 */
export function buildKeyingFilterString(s: KeyingSettings): string {
	const filters: string[] = [];

	if (s.chromakey.enabled) {
		// When yuv=1, ffmpeg interprets the color bytes as YUV, not RGB —
		// so we must convert the user's RGB color to YUV before passing it.
		const hex = s.chromakey.yuv
			? rgbHexToYuvHex(s.chromakey.color)
			: s.chromakey.color.replace('#', '0x');
		let f = `chromakey=${hex}:${s.chromakey.similarity}:${s.chromakey.blend}`;
		if (s.chromakey.yuv) f += ':yuv=1';
		filters.push(f);
	}

	if (s.colorkey.enabled) {
		const hex = s.colorkey.color.replace('#', '0x');
		filters.push(`colorkey=${hex}:${s.colorkey.similarity}:${s.colorkey.blend}`);
	}

	if (s.lumakey.enabled) {
		filters.push(`lumakey=threshold=${s.lumakey.threshold}:tolerance=${s.lumakey.tolerance}:softness=${s.lumakey.softness}`);
	}

	if (s.despill.enabled) {
		const t = despillTypeFromColor(s.despill.color);
		const parts = [`type=${t}`, `mix=${s.despill.mix}`];
		if (s.despill.expand > 0) parts.push(`expand=${s.despill.expand}`);
		if (s.despill.brightness > 0) parts.push(`brightness=${s.despill.brightness}`);
		filters.push(`despill=${parts.join(':')}`);
	}

	// Edge refinement: erosion/dilation work on the whole frame (affects alpha visually)
	if (s.edge.erosion > 0) {
		const v = s.edge.erosion;
		filters.push(`erosion=${v}:${v}:${v}:${v}`);
	}
	if (s.edge.dilation > 0) {
		const v = s.edge.dilation;
		filters.push(`dilation=${v}:${v}:${v}:${v}`);
	}

	// Edge blur: split into rgb+alpha, blur ONLY alpha, merge back
	// This avoids blurring the entire visible image
	if (s.edge.blur > 0) {
		const b = s.edge.blur;
		// Use format=rgba to ensure alpha channel exists, then:
		// split → blur alpha only via alphaextract+boxblur+alphamerge
		filters.push(`format=rgba`);
		filters.push(`split[rgb][a]`);
		filters.push(`[a]alphaextract,boxblur=${b}:${b}[blurA]`);
		filters.push(`[rgb][blurA]alphamerge`);
	}

	return filters.join(',');
}
