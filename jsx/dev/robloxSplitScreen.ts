import { clearRenderQueue } from '../utils/aep/clearRenderQueue';
import { closeProject } from '../utils/aep/closeProject';
import { importFile } from '../utils/aep/importFile';
import { manyImportFile } from '../utils/aep/manyImportFile';
import { saveProject } from '../utils/aep/saveProject';
import { scaleCurLayer } from '../utils/aep/scaleCurLayer';
import { osSep } from '../utils/fs/osSep';
import { basename } from '../utils/fs/path/basename';
import { dirname } from '../utils/fs/path/dirname';
import { extname } from '../utils/fs/path/extname';
import { getDurationInSecconds } from '../utils/randomGen/getDurationInSecconds';
import { getRandomInt } from '../utils/randomGen/getRandomInt';

export function robloxSplitScreen() {
	var inObj: any = {};
	var input = inObj.aeInput;

	var _S = osSep();

	closeProject();

	var video = importFile(input.video[0]);
	if (!(video instanceof FootageItem)) {
		return false;
	}
	var fps = 25;
	var compW = 1080;
	var compH = 960;
	var mainCompDuration = getDurationInSecconds(input.compDuration, fps);

	var mainComp = app.project.items.addComp('mainComp', compW, 1920, 1, mainCompDuration, fps);

	var memComp = app.project.items.addComp('memComp', compW, compH, 1, mainCompDuration, fps);
	var videoComp = app.project.items.addComp('videoComp', compW, compH, 1, mainCompDuration, fps);

	var video = importFile(input.video[0]);

	var memVid = manyImportFile(input.mems).files;
	var statBGvid = manyImportFile(input.statBG).files;

	setVideoToComp([video], 20, videoComp);
	setVideoToComp(statBGvid, 0, memComp, memVid);

	var videoCompLay = mainComp.layers.add(videoComp);
	if (videoCompLay.hasAudio) {
		videoCompLay.audioEnabled = false;
	}
	var memCompLay = mainComp.layers.add(memComp);
	if (memCompLay.hasAudio) {
		memCompLay.audioEnabled = false;
	}

	var randPos = getRandomInt(100);

	if (randPos > 50) {
		videoCompLay.transform.position.setValue([compW / 2, compH / 2]);
		memCompLay.transform.position.setValue([compW / 2, mainComp.height - compH / 2]);
	} else {
		memCompLay.transform.position.setValue([compW / 2, compH / 2]);
		videoCompLay.transform.position.setValue([compW / 2, mainComp.height - compH / 2]);
	}

	var finalFile = [];
	var RQ = app.project.renderQueue;
	clearRenderQueue();
	var fileToRender = RQ.items.add(mainComp); //добавляем активный проект в RQ
	fileToRender.outputModule(1).file = File(
		dirname(inObj.targetPath) + _S + basename(inObj.targetPath, extname(inObj.targetPath)) + '.[fileExtension]',
	);
	// fileToRender.outputModule(1).applyTemplate('-=QT_alfa (hapQ)=-');

	finalFile.push(fileToRender.outputModule(1).file.fsName);

	saveProject(inObj, '(roblox)');
	RQ.render();

	closeProject();

	return finalFile;

	// _video - видео на BG, может быть массивом
	// _offet - смещение от начала/конца, для того что бы отрезать нежелательное с начала и с конца. нужно что бы отрезать запись экрана в OBSstudio я задал 20 сек +/- должно хватить
	// _comp - композиция, куда это все вставлять
	// _mems - массив из мемов. может быть и одним файлом, но в массиве. не обязательный параметр. если его нет, ничего происходить не будет

	function setVideoToComp(_video: any[], _offset: number, _comp: any, _mems?: any) {
		var prevTime = 0;
		while (prevTime < _comp.duration) {
			var randDur = getDurationInSecconds(input.randScenes, _comp.frameRate);
			if (_comp.duration - (prevTime + randDur) < 1) {
				randDur = _comp.duration - prevTime;
			}

			var video = _video[getRandomInt(_video.length - 1)];
			var vidLay = _comp.layers.add(video);

			var startTimeForVid = getDurationInSecconds([_offset, video.duration - _offset - randDur], _comp.frameRate);

			vidLay.inPoint = startTimeForVid;
			vidLay.outPoint = startTimeForVid + randDur;
			vidLay.startTime = prevTime - startTimeForVid;
			scaleCurLayer(vidLay, 'fill');

			if (typeof _mems != 'undefined') {
				var mems = _mems[getRandomInt(_mems.length - 1)];
				var memsLay = _comp.layers.add(mems);

				var startTimeForVid = getDurationInSecconds(mems.duration - randDur, _comp.frameRate);

				memsLay.inPoint = startTimeForVid;
				memsLay.outPoint = startTimeForVid + randDur;
				memsLay.startTime = prevTime - startTimeForVid;
				var randScale = getRandomInt(_comp.height, _comp.height / 1.3);
				var newScale = scaleCurLayer(memsLay, 'fit', [randScale, randScale]);
				var newH = (mems.height * newScale) / 100 / 2;
				var newW = (mems.width * newScale) / 100 / 2;
				var posX = getRandomInt(newW, _comp.width - newW);
				var posY = getRandomInt(newH, _comp.height - newH);
				memsLay.transform.position.setValue([posX, posY]);
			}
			prevTime += randDur;
		}
	}
}
