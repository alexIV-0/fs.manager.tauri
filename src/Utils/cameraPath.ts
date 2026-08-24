// ── cameraPath ───────────────────────────────────────────────────────────────────
// «Виртуальная камера»: из трека субъекта (по кадрам) → сглаженный путь кропа
// camera(t) = (cx, cy, zoom) для реэрейма горизонтали в вертикаль 9:16.
// Чистая математика (без детекции и ffmpeg) — как в статье Habr 1021278: демпфированный
// осциллятор + мёртвая зона + клампы скорости/шага + композиция (eye-level). Портируется
// в Rust/бинарник; здесь — эталон для теста и превью.
//
// Координаты НОРМАЛИЗОВАНЫ (0..1 доля кадра источника), время — мс.
// Два режима:
//   pan  — окно во всю высоту, едет только по X (следим за субъектом), zoom=1.
//   zoom — окно меньше, подогнано под субъект (крупнее), едет по X/Y + меняет zoom.

export type TrackSample = { t: number; cx: number; cy: number; w: number; h: number; conf?: number };
export type CameraMode = 'pan' | 'zoom';

export type CameraParams = {
	mode: CameraMode;
	srcW: number;
	srcH: number;
	targetAspect?: number; // ширина/высота выхода (9:16 = 0.5625)
	fps?: number;          // выходной fps пути
	// zoom-режим:
	targetFill?: number;   // какую долю высоты окна занимает субъект (0..1)
	minZoom?: number;
	maxZoom?: number;
	// композиция:
	eyeLevelLift?: number; // поднять центр к «глазам», доля высоты субъекта
	deadZone?: number;     // мёртвая зона по позиции (норм.) — не гоняемся за микродвижением
	// физика (демпфированный осциллятор):
	stiffness?: number;    // жёсткость (реакция)
	damping?: number;      // демпфирование (гасит раскачку)
	maxSpeed?: number;     // норм/сек
	maxAccel?: number;     // норм/сек²
	maxStep?: number;      // норм/кадр (anti-jerk)
	cuts?: number[];       // смены сцен (мс) — на них камера сбрасывается (не «проезжает» через рез)
};

export type CameraKey = { t: number; cx: number; cy: number; zoom: number; w: number; h: number; hold?: boolean };

const DEF = {
	targetAspect: 9 / 16,
	fps: 30,
	targetFill: 0.6,
	minZoom: 1.0,
	maxZoom: 3.0,
	eyeLevelLift: 0.1,
	deadZone: 0.05,
	stiffness: 8.4,
	damping: 2.35,
	maxSpeed: 0.4,
	maxAccel: 0.85,
	maxStep: 0.04,
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// Линейная интерполяция трека к произвольному времени t (мс). Пропуски (нет валидных
// сэмплов) держим по последнему известному. Возвращает субъекта {cx,cy,w,h} или null.
function sampleTrack(track: TrackSample[], t: number): { cx: number; cy: number; w: number; h: number } | null {
	const valid = track.filter((s) => (s.conf ?? 1) > 0 && s.w > 0 && s.h > 0);
	if (!valid.length) return null;
	if (t <= valid[0].t) return pick(valid[0]);
	if (t >= valid[valid.length - 1].t) return pick(valid[valid.length - 1]);
	for (let i = 0; i < valid.length - 1; i++) {
		const a = valid[i], b = valid[i + 1];
		if (t >= a.t && t <= b.t) {
			const k = (t - a.t) / (b.t - a.t || 1);
			return {
				cx: a.cx + (b.cx - a.cx) * k,
				cy: a.cy + (b.cy - a.cy) * k,
				w: a.w + (b.w - a.w) * k,
				h: a.h + (b.h - a.h) * k,
			};
		}
	}
	return pick(valid[valid.length - 1]);
}
const pick = (s: TrackSample) => ({ cx: s.cx, cy: s.cy, w: s.w, h: s.h });

// Размер окна кропа (норм.) по zoom и аспектам.
function windowSize(zoom: number, targetAspect: number, srcAspect: number): { w: number; h: number } {
	const h = clamp(1 / zoom, 0, 1);        // высота окна = доля высоты источника
	const w = clamp((h * targetAspect) / srcAspect, 0, 1); // ширина из аспекта окна = targetAspect
	return { w, h };
}

export function buildCameraPath(track: TrackSample[], params: CameraParams): CameraKey[] {
	const p = { ...DEF, ...params };
	const srcAspect = p.srcW / p.srcH;
	const dt = 1 / p.fps;
	const durMs = track.length ? track[track.length - 1].t : 0;
	const nFrames = Math.max(1, Math.round((durMs / 1000) * p.fps));

	// Целевые (сырые) значения по кадрам + zoom.
	const rawCx: number[] = [], rawCy: number[] = [], rawZoom: number[] = [];
	for (let f = 0; f < nFrames; f++) {
		const t = (f / p.fps) * 1000;
		const s = sampleTrack(track, t);
		if (!s) { rawCx.push(0.5); rawCy.push(0.5); rawZoom.push(1); continue; }
		let zoom = 1;
		let cy = 0.5;
		if (p.mode === 'zoom') {
			zoom = clamp(p.targetFill / Math.max(1e-3, s.h), p.minZoom, p.maxZoom);
			cy = clamp(s.cy - s.h * p.eyeLevelLift, 0, 1); // поднять к глазам
		}
		rawCx.push(s.cx);
		rawCy.push(cy);
		rawZoom.push(zoom);
	}

	// Демпфированный осциллятор по оси с мёртвой зоной, клампами скорости/ускорения/шага.
	const cutFrames = new Set((p.cuts ?? []).map((ms) => Math.round((ms / 1000) * p.fps)));

	const drive = (raw: number[], active: boolean): number[] => {
		if (!active) return raw.slice();
		const out: number[] = [];
		let pos = raw[0];
		let vel = 0;
		let held = raw[0];
		for (let f = 0; f < raw.length; f++) {
			// На склейке (смена сцены) камера сбрасывается на новый план — без «проезда» через рез.
			if (cutFrames.has(f)) { pos = raw[f]; held = raw[f]; vel = 0; out.push(pos); continue; }
			if (Math.abs(raw[f] - held) >= p.deadZone) held = raw[f]; // за микро-движением не гоняемся
			const err = held - pos;
			let acc = err * p.stiffness - vel * p.damping;
			acc = clamp(acc, -p.maxAccel, p.maxAccel);
			vel = clamp(vel + acc * dt, -p.maxSpeed, p.maxSpeed);
			let step = clamp(vel * dt, -p.maxStep, p.maxStep);
			pos += step;
			out.push(pos);
		}
		return out;
	};

	const cxS = drive(rawCx, true);
	const cyS = drive(rawCy, p.mode === 'zoom');
	const zoomS = drive(rawZoom, p.mode === 'zoom');

	// Сборка + кламп окна в границы кадра.
	const path: CameraKey[] = [];
	for (let f = 0; f < nFrames; f++) {
		const zoom = p.mode === 'zoom' ? zoomS[f] : 1;
		const win = windowSize(zoom, p.targetAspect, srcAspect);
		const halfW = win.w / 2, halfH = win.h / 2;
		const cx = win.w >= 1 ? 0.5 : clamp(cxS[f], halfW, 1 - halfW);
		const cy = win.h >= 1 ? 0.5 : clamp(p.mode === 'zoom' ? cyS[f] : 0.5, halfH, 1 - halfH);
		path.push({
			t: Math.round((f / p.fps) * 1000),
			cx: Number(cx.toFixed(4)),
			cy: Number(cy.toFixed(4)),
			zoom: Number(zoom.toFixed(4)),
			w: Number(win.w.toFixed(4)),
			h: Number(win.h.toFixed(4)),
		});
	}
	return path;
}

// ── Прореживание пути в ключевые кадры (RDP) ────────────────────────────────────────
// Из по-кадрового пути оставляем только опорные ключи: старт/финиш каждого плана +
// смены направления. AE интерполирует между ними (безье). На стыке планов (cut) ключу
// ПЕРЕД резом ставим hold → мгновенный скачок. tolerance — норм. допуск отклонения.
function rdp1d(vals: number[], tol: number): number[] {
	const n = vals.length;
	if (n <= 2) return vals.map((_, i) => i);
	const keep = new Array(n).fill(false);
	keep[0] = keep[n - 1] = true;
	const stack: Array<[number, number]> = [[0, n - 1]];
	while (stack.length) {
		const seg = stack.pop();
		if (!seg) break;
		const [a, b] = seg;
		if (b <= a + 1) continue;
		let maxD = -1, idx = -1;
		const va = vals[a], vb = vals[b];
		for (let i = a + 1; i < b; i++) {
			const lin = va + (vb - va) * ((i - a) / (b - a));
			const d = Math.abs(vals[i] - lin);
			if (d > maxD) { maxD = d; idx = i; }
		}
		if (maxD > tol && idx > 0) { keep[idx] = true; stack.push([a, idx]); stack.push([idx, b]); }
	}
	const out: number[] = [];
	for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
	return out;
}

export function simplifyCameraPath(
	path: CameraKey[],
	opts: { cuts?: number[]; fps?: number; tolerance?: number } = {},
): CameraKey[] {
	if (path.length <= 2) return path.map((k) => ({ ...k }));
	const fps = opts.fps ?? 30;
	const tol = opts.tolerance ?? 0.005;

	// Границы планов (индексы кадров), включая старт и конец.
	const cutIdx = new Set<number>([0, path.length]);
	for (const ms of opts.cuts ?? []) {
		const f = Math.round((ms / 1000) * fps);
		if (f > 0 && f < path.length) cutIdx.add(f);
	}
	const bounds = Array.from(cutIdx).sort((a, b) => a - b);

	const kept = new Set<number>();
	const hold = new Set<number>();
	for (let s = 0; s < bounds.length - 1; s++) {
		const a = bounds[s], b = bounds[s + 1]; // сегмент [a, b)
		const seg = path.slice(a, b);
		if (!seg.length) continue;
		for (const i of rdp1d(seg.map((k) => k.cx), tol)) kept.add(a + i);
		for (const i of rdp1d(seg.map((k) => k.cy), tol)) kept.add(a + i);
		for (const i of rdp1d(seg.map((k) => k.zoom), tol)) kept.add(a + i);
		kept.add(a);
		kept.add(b - 1);
		if (s < bounds.length - 2) hold.add(b - 1); // ключ перед резом → hold
	}

	return Array.from(kept).sort((x, y) => x - y).map((i) => {
		const k: CameraKey = { ...path[i] };
		if (hold.has(i)) k.hold = true;
		return k;
	});
}
