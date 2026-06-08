import { clearRenderQueue } from '../utils/aep/clearRenderQueue';
import { closeProject } from '../utils/aep/closeProject';
import { compFromFootage } from '../utils/aep/compFromFootage';
import { getEffectsFromLayer } from '../utils/aep/getEffectFromLayer';
import { importFile } from '../utils/aep/importFile';
import { saveProject } from '../utils/aep/saveProject';
import { osSep } from '../utils/fs/osSep';
import { basename, dirname, extname } from '../utils/fs/path';

export function scaleAvatarByAudio() {
	var inObj: any = {};

	closeProject();
	var input = inObj.aeInput;
	var _S = osSep();

	var video = importFile(input.video[0]);
	if (!(video instanceof FootageItem)) {
		return false;
	}

	var mainComp = compFromFootage(video);
	var videoLay = mainComp.layers.add(video);

	if (videoLay.audioEnabled == false) {
		videoLay.audioEnabled = true;
	}
	videoLay.solo = true;

	mainComp.openInViewer(); // делаем comp активной/переднего плана — иначе команде не на что воздействовать

	var command = app.findMenuCommandId('Convert Audio to Keyframes');
	app.executeCommand(command);
	var audioAmp = mainComp.layer(1);

	var audKeyEff = getEffectsFromLayer(audioAmp, ['Both Channels']);

	var audKey = audKeyEff['Both Channels']('Slider');
	var pause = 2; // минимальная пауза (сек) тишины, после которой речь считается законченной.
	var addCut = 1; // добавочное время (сек) до начала и после конца речи.
	var audLevel = 0.3; // минимальный порог фонового шума, выше которого считается речь.

	// 1. Анализируем ключи и собираем сегменты речи { start, end } в секундах.
	var segments: Array<{ start: number; end: number }> = [];
	var inSpeech = false;
	var speechStart = 0;
	var lastVoiceTime = 0; // время последнего ключа с речью в текущем сегменте.

	// ключи в AE 1-based: индекс от 1 до numKeys.
	for (var i = 1; i <= audKey.numKeys; i++) {
		var t = audKey.keyTime(i);
		var v = audKey.keyValue(i);

		if (v >= audLevel) {
			if (!inSpeech) {
				speechStart = t;
				inSpeech = true;
			}
			lastVoiceTime = t;
		} else if (inSpeech && t - lastVoiceTime >= pause) {
			// тишина дольше pause — закрываем текущий сегмент.
			segments.push({ start: speechStart, end: lastVoiceTime });
			inSpeech = false;
		}
	}
	// последний незакрытый сегмент (речь шла до конца клипа).
	if (inSpeech) {
		segments.push({ start: speechStart, end: lastVoiceTime });
	}

	// 2. Чистим служебные слои: и audioAmp (источник ключей audKey), и оригинальный videoLay.
	audioAmp.remove();
	videoLay.remove();

	// 3. По каждому сегменту добавляем подрезанный слой video и вешаем выражение на Scale.
	var scaleExpr =
		'v=0.5;\n' + 's=ease(time, inPoint, inPoint+v, 0,100) + ease(time, outPoint-v, outPoint, 100,0) - 100;\n' + '[s,s]';

	for (var s = 0; s < segments.length; s++) {
		var inPoint = Math.max(0, segments[s].start - addCut);
		var outPoint = Math.min(mainComp.duration, video.duration, segments[s].end + addCut);

		var segLay = mainComp.layers.add(video);
		segLay.inPoint = inPoint; // сначала inPoint (current outPoint = video.duration, конфликта нет)
		segLay.outPoint = outPoint;
		var scaleProp = segLay.property('ADBE Transform Group').property('ADBE Scale') as Property;
		scaleProp.expression = scaleExpr;
	}

	var finalFile = [];
	var RQ = app.project.renderQueue;
	clearRenderQueue();
	var fileToRender = RQ.items.add(mainComp); //добавляем активный проект в RQ
	fileToRender.outputModule(1).file = File(
		dirname(inObj.targetPath) + _S + basename(inObj.targetPath, extname(inObj.targetPath)) + '.[fileExtension]',
	);
	fileToRender.outputModule(1).applyTemplate('-=QT_alfa (hapQ)=-');

	finalFile.push(fileToRender.outputModule(1).file.fsName);

	// debugger;
	saveProject(inObj, '(scale)');
	RQ.render();

	closeProject();

	return finalFile;
}
