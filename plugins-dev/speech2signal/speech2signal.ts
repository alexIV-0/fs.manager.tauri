import { fs, ffmpeg, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';
import { parseAstatsEnvelope, presentIntervals, energyPeak, arousal } from '../../src/Utils/audioEnvelope';
import path from 'path';

export { onLoad } from '../_template/tauri';

// ── speech2signal ───────────────────────────────────────────────────────────────────
// Анализ голосового стема → сигнальный JSON:
//   { dur, hopMs, rms[], speech[], energyPeak, arousal[] }
// arousal (Ярус A) — прокси возбуждённости: уровень + вариативность энергии по блокам.
// Питч/центроид/SER (Ярус B) — позже. Огибающая — тем же ffmpeg astats, что и music2signal.

function clampWindow(v: number): number {
	return Number.isFinite(v) && v >= 20 && v <= 500 ? Math.round(v) : 100;
}
function clampBlock(v: number): number {
	return Number.isFinite(v) && v >= 250 && v <= 4000 ? Math.round(v) : 1000;
}

export async function speech2signalFunc(_item: any, _description: any, _ctx?: any): Promise<string[]> {
	const finalFiles: string[] = [];
	const windowMs = clampWindow(Number(_item.windowMs));
	const blockMs = clampBlock(Number(_item.arousalBlockMs));

	const inputFiles: string[] = _item.import?.inputFile ?? [];
	if (!inputFiles.length) {
		sendToMW('log', { level: 'warn', text: '[speech2signal] нет входных файлов' });
		return [];
	}

	const curPath: string[] = _item.targetPath?.length > 0 ? [..._item.targetPath] : ['$clearName (speech2signal)'];
	if (_item.import?.targetPath) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	let iteration = 1;
	for (const fileFrom of inputFiles) {
		let info: any;
		try {
			info = await ffmpeg.getInfo(fileFrom);
		} catch (e: any) {
			sendToMW('log', { level: 'error', text: `[speech2signal] probe fail ${fileFrom}: ${e?.message ?? String(e)}` });
			continue;
		}
		if (!info.hasAudio) {
			sendToMW('log', { level: 'warn', text: `[speech2signal] нет аудио: ${fileFrom}` });
			continue;
		}
		const sr = info.audioSampleRate || 44100;
		const durMs = Math.round((info.durationInSeconds || 0) * 1000);
		const n = Math.max(1, Math.round((sr * windowMs) / 1000));

		let res: any;
		try {
			res = await ffmpeg.exec(
				['-hide_banner', '-i', fileFrom, '-af', `asetnsamples=n=${n}:p=0,astats=metadata=1:reset=1,ametadata=print:file=-`, '-f', 'null', '-'],
				{ nodeId: _item.id, statusText: `${_description?.infoText ?? ''}: [speech2signal] ${path.basename(fileFrom)}` },
			);
		} catch (e: any) {
			sendToMW('log', { level: 'error', text: `[speech2signal] ffmpeg fail: ${e?.message ?? String(e)}` });
			continue;
		}
		if (res.exit_code !== 0) {
			sendToMW('log', { level: 'error', text: `[speech2signal] ffmpeg exit ${res.exit_code}:\n${(res.stderr ?? '').slice(-300)}` });
			continue;
		}

		const env = parseAstatsEnvelope(res.stdout, -90, durMs || undefined);
		if (!env.rms.length) {
			sendToMW('log', { level: 'warn', text: `[speech2signal] пустая огибающая: ${fileFrom}` });
			continue;
		}

		const out = {
			dur: env.dur,
			hopMs: env.hopMs,
			rms: env.rms,
			speech: presentIntervals(env, -50, 300),
			energyPeak: energyPeak(env),
			arousal: arousal(env, blockMs),
		};

		const nameSrc = path.join(path.dirname(fileFrom), `${path.basename(fileFrom, path.extname(fileFrom))}.json`);
		let fileTo: string;
		try {
			fileTo = createPathForFileByPattern(curPath, _description, nameSrc);
		} catch {
			fileTo = path.join(path.dirname(fileFrom), `${path.basename(fileFrom, path.extname(fileFrom))} (speech2signal).json`);
		}
		if (inputFiles.length > 1) {
			const ext = path.extname(fileTo);
			fileTo = path.join(path.dirname(fileTo), `${path.basename(fileTo, ext)}_${iteration}${ext}`);
			iteration++;
		}

		try {
			await fs.mkdir(path.dirname(fileTo));
			await fs.write(fileTo, JSON.stringify(out, null, 2));
			sendToMW('log', {
				text: `[speech2signal] ${path.basename(fileFrom)} → ${env.rms.length} окон, речь ${out.speech.length} интервалов, arousal ${out.arousal.length} блоков → ${fileTo}`,
			});
			finalFiles.push(fileTo);
		} catch (e: any) {
			sendToMW('log', { level: 'error', text: `[speech2signal] не записать ${fileTo}: ${e?.message ?? String(e)}` });
		}
	}

	return finalFiles;
}
