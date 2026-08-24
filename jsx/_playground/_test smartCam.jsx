function main() {
	// ── КОНФИГ ────────────────────────────────────────────────────────────────
	var SOURCE_FILE = '/Users/aleksey.ivanov/Downloads/26 - Елизавета Тринич, Алена Голубева - Серебряный возраст и креатив для этой аудитории.mp4'; // горизонтальный исходник
	var CAMERA_JSON = ''; // путь к camera.json (cameraPath→simplifyCameraPath); пусто → демо
	var AR_W = 9,
		AR_H = 16;

	// ── источник ──────────────────────────────────────────────────────────────
	var src = app.project.importFile(new ImportOptions(new File(SOURCE_FILE)));
	var srcW = src.width,
		srcH = src.height;
	var fps = src.frameRate || 30;
	var dur = src.duration;

	// ── путь камеры (опорные ключи; у ключа перед резом hold:true) ───────────────
	var path;
	if (CAMERA_JSON) {
		var f = new File(CAMERA_JSON);
		f.open('r');
		var txt = f.read();
		f.close();
		path = eval('(' + txt + ')'); // в ExtendScript нет JSON.parse
	} else {
		var wPan = (1 * AR_W) / AR_H / (srcW / srcH);
		path = [
			{ t: 0, cx: 0.3, cy: 0.5, zoom: 1, w: wPan, h: 1 },
			{ t: 1000, cx: 0.7, cy: 0.5, zoom: 1, w: wPan, h: 1, hold: true },
			{ t: 1033, cx: 0.3, cy: 0.5, zoom: 1, w: wPan, h: 1 },
			{ t: 2000, cx: 0.5, cy: 0.5, zoom: 1, w: wPan, h: 1 },
		];
	}

	// ── комп: высота = исходной, ширина авто под 9:16 (чётная) ───────────────────
	var compH = srcH;
	var compW = Math.round((srcH * AR_W) / AR_H);
	if (compW % 2 === 1) compW += 1;
	var comp = app.project.items.addComp('reframe_9x16', compW, compH, 1, dur, fps);
	var layer = comp.layers.add(src);
	var pos = layer.property('ADBE Transform Group').property('ADBE Position');
	var scl = layer.property('ADBE Transform Group').property('ADBE Scale');

	var HOLD = KeyframeInterpolationType.HOLD,
		BEZ = KeyframeInterpolationType.BEZIER;

	// ── ключи + интерполяция ─────────────────────────────────────────────────────
	app.beginUndoGroup('camera reframe');
	for (var k = 0; k < path.length; k++) {
		var p = path[k];
		var t = Math.round((p.t / 1000) * fps) / fps; // на сетку кадров
		var S = compH / (p.h * srcH); // масштаб (pan: =1; zoom: =zoom)
		pos.setValueAtTime(t, [compW / 2 - (p.cx - 0.5) * srcW * S, compH / 2 - (p.cy - 0.5) * srcH * S]);
		scl.setValueAtTime(t, [S * 100, S * 100]);

		var pk = pos.nearestKeyIndex(t),
			sk = scl.nearestKeyIndex(t);
		if (p.hold) {
			// держим до реза → скачок на стыке
			pos.setInterpolationTypeAtKey(pk, BEZ, HOLD);
			scl.setInterpolationTypeAtKey(sk, BEZ, HOLD);
		} else {
			// плавно: безье + гладкая пространственная кривая
			pos.setInterpolationTypeAtKey(pk, BEZ, BEZ);
			pos.setSpatialAutoBezierAtKey(pk, true);
			scl.setInterpolationTypeAtKey(sk, BEZ, BEZ);
		}
	}
	app.endUndoGroup();
}
main();
