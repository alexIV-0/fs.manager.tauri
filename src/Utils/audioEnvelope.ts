// ── audioEnvelope ──────────────────────────────────────────────────────────────────
// Чистые функции анализа аудио-огибающей. Побочка (запуск ffmpeg) — в плагинах
// (music2signal / speach2signal), сюда приходит уже снятый stdout `astats`.
//
// Как снимается огибающая (в плагине):
//   ffmpeg -i <stem> -af "asetnsamples=n=<sr*hop>:p=0,astats=metadata=1:reset=1,ametadata=print:file=-" -f null -
// asetnsamples режет на РОВНЫЕ окна (n сэмплов), astats считает RMS по окну, ametadata
// печатает метаданные в stdout (как detectScenes). Тишина → RMS_level=-inf (клампим к полу).
// Время везде — целые мс (как в остальных сигналах), огибающая — плоский массив dBFS.

export type Envelope = {
	hopMs: number;      // шаг окна, мс
	floorDb: number;    // пол (тишина/-inf свёрнуты сюда)
	dur: number;        // мс
	rms: number[];      // dBFS по окнам; время окна i = i * hopMs
};

export type Interval = { from: number; to: number };
export type MusicEvent = { t: number; to?: number; type: 'onset' | 'buildup' | 'drop' | 'dropout'; strength?: number };
export type ArousalSeg = { from: number; to: number; value: number };

// ── Парс stdout astats → огибающая ─────────────────────────────────────────────────
export function parseAstatsEnvelope(stdout: string, floorDb = -90, durMs?: number): Envelope {
	const times: number[] = [];
	const rms: number[] = [];
	let curT = 0;

	for (const line of stdout.split('\n')) {
		const fm = line.match(/^frame:\d+\s+pts:\S+\s+pts_time:([-\d.]+)/);
		if (fm) {
			curT = Math.round(parseFloat(fm[1]) * 1000);
			continue;
		}
		const rm = line.match(/Overall\.RMS_level=(\S+)/);
		if (rm) {
			let v = parseFloat(rm[1]);           // '-inf'/'nan' → NaN
			if (!Number.isFinite(v) || v < floorDb) v = floorDb;
			times.push(curT);
			rms.push(Number(v.toFixed(2)));
		}
	}

	// hop берём из реальных pts (asetnsamples делает окна ровными), с фолбэком 100мс.
	let hopMs = 100;
	if (times.length > 1) {
		const d: number[] = [];
		for (let i = 1; i < times.length; i++) d.push(times[i] - times[i - 1]);
		d.sort((a, b) => a - b);
		hopMs = d[Math.floor(d.length / 2)] || 100;
	}
	const dur = durMs ?? (rms.length ? times[times.length - 1] + hopMs : 0);
	return { hopMs, floorDb, dur, rms };
}

// ── Интервалы «звучит» (RMS выше порога) ────────────────────────────────────────────
// Для музыки — где есть музыка; для голоса — где есть речь. Мелкие дырки/островки
// короче minMs схлопываем, чтобы не дробить.
export function presentIntervals(env: Envelope, thresholdDb = -50, minMs = 300): Interval[] {
	const { rms, hopMs } = env;
	const raw: Interval[] = [];
	let start = -1;
	for (let i = 0; i < rms.length; i++) {
		const on = rms[i] > thresholdDb;
		if (on && start < 0) start = i;
		if (!on && start >= 0) {
			raw.push({ from: start * hopMs, to: i * hopMs });
			start = -1;
		}
	}
	if (start >= 0) raw.push({ from: start * hopMs, to: rms.length * hopMs });

	// склейка близких + отсев коротких
	const merged: Interval[] = [];
	for (const iv of raw) {
		const last = merged[merged.length - 1];
		if (last && iv.from - last.to < minMs) last.to = iv.to;
		else merged.push({ ...iv });
	}
	return merged.filter(iv => iv.to - iv.from >= minMs);
}

export function coverageRatio(intervals: Interval[], dur: number): number {
	if (dur <= 0) return 0;
	const sum = intervals.reduce((s, iv) => s + (iv.to - iv.from), 0);
	return Number((sum / dur).toFixed(3));
}

export function energyPeak(env: Envelope): { t: number; db: number } {
	let bi = 0;
	for (let i = 1; i < env.rms.length; i++) if (env.rms[i] > env.rms[bi]) bi = i;
	return { t: bi * env.hopMs, db: env.rms[bi] ?? env.floorDb };
}

// ── Сглаживание (скользящее среднее ±k окон) ────────────────────────────────────────
function smooth(rms: number[], k: number): number[] {
	if (k <= 0) return rms.slice();
	const out = new Array(rms.length);
	for (let i = 0; i < rms.length; i++) {
		let s = 0, n = 0;
		for (let j = Math.max(0, i - k); j <= Math.min(rms.length - 1, i + k); j++) { s += rms[j]; n++; }
		out[i] = s / n;
	}
	return out;
}

// ── События музыкальной динамики ────────────────────────────────────────────────────
// buildup — устойчивый рост энергии на окне; drop — резкий скачок вверх; dropout —
// падение из «звучит» в пол (тишину). Пороги в dB/мс, тюнятся.
export function detectEvents(
	env: Envelope,
	opts: { presenceDb?: number; gapMs?: number; dropDb?: number; dropWindowMs?: number; buildDb?: number; buildWindowMs?: number; minGapMs?: number } = {},
): MusicEvent[] {
	const { rms, hopMs } = env;
	const presenceDb = opts.presenceDb ?? -50;
	const gapMs = opts.gapMs ?? 300;                 // мин. тишина, чтобы считать onset/dropout
	const dropDb = opts.dropDb ?? 8;
	const dropW = Math.max(1, Math.round((opts.dropWindowMs ?? 400) / hopMs));
	const buildDb = opts.buildDb ?? 8;
	const buildW = Math.max(2, Math.round((opts.buildWindowMs ?? 2000) / hopMs));
	const minGap = opts.minGapMs ?? 800;

	const present = presentIntervals(env, presenceDb, Math.max(100, Math.round(gapMs / 2)));
	const events: MusicEvent[] = [];

	// onset / dropout — из границ present-интервалов (надёжно, без dB-порогов):
	// музыка «входит» после тишины / «уходит» в тишину.
	for (let k = 0; k < present.length; k++) {
		const iv = present[k];
		const prevEnd = k > 0 ? present[k - 1].to : 0;
		const nextStart = k < present.length - 1 ? present[k + 1].from : env.dur;
		if (iv.from - prevEnd >= gapMs) events.push({ t: iv.from, type: 'onset' });
		if (nextStart - iv.to >= gapMs) events.push({ t: iv.to, type: 'dropout' });
	}

	// drop / buildup — динамика ВНУТРИ звучащих участков (стартовый уровень заведомо
	// слышимый, поэтому подъём из тишины не считается «дропом» — это onset выше).
	const sm = smooth(rms, 2);
	let lastDrop = -Infinity;
	let lastBuild = -Infinity;
	for (const iv of present) {
		const a = Math.round(iv.from / hopMs);
		const b = Math.min(sm.length, Math.round(iv.to / hopMs));
		for (let i = a + dropW; i < b; i++) {
			if (sm[i] - sm[i - dropW] >= dropDb && i * hopMs - lastDrop >= minGap) {
				events.push({ t: i * hopMs, type: 'drop', strength: Number(Math.min(1, (sm[i] - sm[i - dropW]) / 20).toFixed(2)) });
				lastDrop = i * hopMs;
			}
		}
		for (let i = a + buildW; i < b; i++) {
			if (sm[i] - sm[i - buildW] >= buildDb && (i - buildW) * hopMs - lastBuild >= minGap) {
				events.push({ t: (i - buildW) * hopMs, to: i * hopMs, type: 'buildup' });
				lastBuild = i * hopMs;
			}
		}
	}

	return events.sort((a, b) => a.t - b.t);
}

// ── Прокси возбуждённости (для speach2signal) ───────────────────────────────────────
// Блоками по blockMs: value = 0.6*уровень + 0.4*вариативность (обе нормированы). 0..1.
export function arousal(env: Envelope, blockMs = 1000): ArousalSeg[] {
	const { rms, hopMs, floorDb } = env;
	if (!rms.length) return [];
	const peak = rms.reduce((m, v) => Math.max(m, v), floorDb);
	const span = Math.max(1, peak - floorDb);
	const perBlock = Math.max(1, Math.round(blockMs / hopMs));

	const segs: ArousalSeg[] = [];
	for (let b = 0; b < rms.length; b += perBlock) {
		const chunk = rms.slice(b, b + perBlock);
		const mean = chunk.reduce((s, v) => s + v, 0) / chunk.length;
		const variance = chunk.reduce((s, v) => s + (v - mean) ** 2, 0) / chunk.length;
		const std = Math.sqrt(variance);
		const level = (mean - floorDb) / span;                 // 0..1
		const dyn = Math.min(1, std / 12);                     // ~12 dB разброса → максимум
		const value = Number(Math.max(0, Math.min(1, 0.6 * level + 0.4 * dyn)).toFixed(2));
		segs.push({ from: b * hopMs, to: Math.min((b + perBlock) * hopMs, env.dur || (b + perBlock) * hopMs), value });
	}
	return segs;
}
