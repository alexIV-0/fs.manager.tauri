import { fs, ffmpeg, exec, paths, system, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';
import path from 'path';

export { onLoad } from '../_template/tauri';

// ── Форматы вывода ─────────────────────────────────────────────────────────────

const FORMAT_MAP: Record<string, { flag: string; ext: string }> = {
	jsonfull: { flag: '--output-json-full', ext: '.json' },
	json:     { flag: '--output-json',      ext: '.json' },
	srt:      { flag: '--output-srt',       ext: '.srt'  },
	vtt:      { flag: '--output-vtt',       ext: '.vtt'  },
	txt:      { flag: '--output-txt',       ext: '.txt'  },
};

// Модели от наименьшей к наибольшей для детекта языка
const DETECT_MODELS = ['ggml-tiny.bin', 'ggml-base.bin', 'ggml-small.bin', 'ggml-medium.bin'];

// Длительности аудио для попыток детекта языка (ms)
const DETECT_DURATIONS = [20000, 30000, 40000, 50000, 60000];


// ── Путь к бинарнику ───────────────────────────────────────────────────────────

async function getWhisperBin(pluginsDevPath: string, platformTarget: string): Promise<string> {
	const isWin = platformTarget.startsWith('win-');
	const fileName = isWin ? 'whisper-cli.exe' : 'whisper-cli';
	return path.join(pluginsDevPath, 'transcribeVA', 'whisper', platformTarget, fileName);
}

// ── Наименьшая доступная модель ────────────────────────────────────────────────

async function findLightestModel(modelsFolder: string): Promise<string> {
	for (const modelName of DETECT_MODELS) {
		const modelPath = path.join(modelsFolder, modelName);
		if (await fs.exists(modelPath)) return modelPath;
	}
	throw new Error(`[whisper] no detect model found in: ${modelsFolder}`);
}

// ── Детект языка с нарастающей длительностью ──────────────────────────────────

async function detectLanguage(bin: string, modelPath: string, audioFile: string, threads: number, nodeId?: string): Promise<string> {
	for (const duration of DETECT_DURATIONS) {
		const args = [
			'-m', modelPath,
			'-f', audioFile,
			'--language', 'auto',
			'--duration', String(duration),
			'--threads', String(threads),
			'--print-special',
		];
		try {
			const result = await exec(bin, args, { nodeId });
			const output = (result?.stdout ?? '') + (result?.stderr ?? '');
			const langMatch = output.match(/auto-detected language:\s*(\w+)/i);
			if (langMatch?.[1]) {
				sendToMW('log', { text: `[whisper] language "${langMatch[1]}" detected at ${duration / 1000}s` });
				return langMatch[1];
			}
		} catch (e: any) {
			sendToMW('log', { level: 'error', text: `[whisper] detect error at ${duration / 1000}s: ${e?.message ?? String(e)}` });
		}
	}
	sendToMW('log', { text: '[whisper] language not detected, falling back to "en"' });
	return 'en';
}

// ── Аргументы для транскрипции ─────────────────────────────────────────────────

function buildTranscribeArgs(
	modelPath: string,
	audioFile: string,
	language: string,
	outputFile: string,
	outputFormat: string,
	threads: number,
): string[] {
	const format = FORMAT_MAP[outputFormat] ?? FORMAT_MAP['jsonfull'];
	const args = [
		'-m', modelPath,
		'-f', audioFile,
		'--language', language,
		'--threads', String(threads),
		'--beam-size', '5',
		'--temperature', '0',
		'--suppress-nst',
		'--no-speech-thold', '0.6',
		'--logprob-thold', '-1.0',
		format.flag,
		'--output-file', outputFile,
	];
	if (outputFormat === 'jsonfull' || outputFormat === 'json') {
		args.push('--max-len', '1', '--split-on-word');
	}
	return args;
}

// ── Основная функция плагина ───────────────────────────────────────────────────

export async function transcribeAudioFunc(_item: any, _description: any): Promise<string[]> {
	const finalFiles: string[] = [];
	const startTime = Date.now();
	const nodeId: string | undefined = _item?.id;

	const [pluginsDevPath, platformTarget, cpuCount] = await Promise.all([
		paths.pluginsDev(),
		paths.platformTarget(),
		system.cpuCount(),
	]);
	const bin = await getWhisperBin(pluginsDevPath, platformTarget);
	// Отдаём whisper-cli все логические ядра минус 2 (оставляем системе/UI).
	// hardwareConcurrency из WebView не подходит — Safari clamp'ит до 8.
	const threads = Math.max(4, cpuCount - 2);
	sendToMW('log', { text: `[whisper] using ${threads} threads (CPU: ${cpuCount} cores)` });

	const modelsFolder = _description?.folderPath?.whisper?.[0];
	if (!modelsFolder) {
		sendToMW('log', { level: 'error', text: '[whisper] whisper models folder not configured (Settings → Paths)' });
		return [];
	}

	if (!await fs.exists(bin)) {
		sendToMW('log', { level: 'error', text: `[whisper] binary not found: ${bin}` });
		return [];
	}

	let curPath: string[] = (_item.targetPath?.length > 0) ? [..._item.targetPath] : ['$clearName ($random(3))'];
	if (_item.import?.targetPath) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	const fileForName: string = _description?.pathForDelete ?? '';

	sendToMW('log', { text: '[whisper] 🎤 Initializing Whisper...' });
	sendToMW('statusbar', { text: `${_description?.infoText ?? ''}: [whisper] transcribe\n${_description?.curItem ?? ''}` });

	const inputFiles: string[] = _item.import?.inputFile ?? [];
	let iteration = 1;

	for (const fileFrom of inputFiles) {
		let fileTo: string;
		try {
			fileTo = createPathForFileByPattern(curPath, _description, fileForName);
		} catch {
			fileTo = path.join(path.dirname(fileFrom), 'transcription_result');
		}

		if (inputFiles.length > 1) {
			const ext = path.extname(fileTo);
			const base = path.basename(fileTo, ext);
			const dir = path.dirname(fileTo);
			fileTo = path.join(dir, `${base}_${iteration}${ext}`);
			iteration++;
		}

		// Проверяем наличие аудио потока
		let fileInfo: any;
		try {
			fileInfo = await ffmpeg.getInfo(fileFrom);
		} catch (e: any) {
			sendToMW('log', { level: 'warn', text: `[whisper] cannot probe file ${fileFrom}: ${e?.message}` });
			continue;
		}
		if (!fileInfo.hasAudio) {
			sendToMW('log', { level: 'warn', text: `[whisper] no audio stream in: ${fileFrom}` });
			continue;
		}
		sendToMW('log', { text: `[whisper] file: ${fileInfo.durationInTimcode} (${fileInfo.durationInSeconds}s)` });

		const fileDir = path.dirname(fileTo);
		await fs.mkdir(fileDir);
		const fileBaseName = path.basename(fileTo, path.extname(fileTo));

		// 1. Конвертируем в WAV 16kHz mono
		const pcmFile = path.join(fileDir, `${fileBaseName}_temp.wav`);
		await ffmpeg.run({
			command: ['-y', '-i', fileFrom, '-vn', '-ac', '1', '-ar', '16000', pcmFile],
			text: `${_description?.infoText ?? ''}: [whisper] preparing audio`,
		});

		// 2. Определяем язык
		const lightModel = await findLightestModel(modelsFolder);
		const detectedLang = await detectLanguage(bin, lightModel, pcmFile, threads, nodeId);

		// ── Режим "только детект языка" ───────────────────────────────────────
		const outputFormatRaw = (_item.outputFormat ?? 'jsonfull');
		if (outputFormatRaw === 'Detect Language') {
			const langFile = path.join(fileDir, `${fileBaseName} [${detectedLang}].txt`);
			await fs.write(langFile, '');
			sendToMW('log', { text: `[whisper] detected language: "${detectedLang}" → ${langFile}` });
			finalFiles.push(langFile);
			await tryRemove(pcmFile);
			continue;
		}

		// 3. Основная транскрипция
		const outputFormat = outputFormatRaw.toLowerCase();
		const format = FORMAT_MAP[outputFormat] ?? FORMAT_MAP['jsonfull'];
		const modelPath = path.join(modelsFolder, _item.whisperModel ?? 'ggml-large-v3-turbo.bin');

		if (!await fs.exists(modelPath)) {
			sendToMW('log', { level: 'error', text: `[whisper] model not found: ${modelPath}` });
			await tryRemove(pcmFile);
			continue;
		}

		const outputBase = path.join(fileDir, `${fileBaseName} (whisper)`);
		const transcribeArgs = buildTranscribeArgs(modelPath, pcmFile, detectedLang, outputBase, outputFormat, threads);
		sendToMW('log', { text: `[whisper] transcribing, model: ${_item.whisperModel}, lang: ${detectedLang}` });

		const transcribeResult = await exec(bin, transcribeArgs, { nodeId });
		if (transcribeResult.exit_code !== 0) {
			sendToMW('log', { level: 'error', text: `[whisper] transcription failed:\n${transcribeResult.stderr.slice(-500)}` });
		} else {
			finalFiles.push(`${outputBase}${format.ext}`);
		}

		// 4. Удаляем temp WAV
		await tryRemove(pcmFile);
	}

	const elapsed = msToTime(Date.now() - startTime);
	sendToMW('log', { level: 'info', text: `[whisper] ⏱ done in ${elapsed}\nResult:\n${finalFiles.join('\n')}` });
	return finalFiles;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function tryRemove(p: string) {
	try { await fs.remove(p); } catch {}
}

function msToTime(ms: number): string {
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	const h = Math.floor(m / 60);
	if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
	if (m > 0) return `${m}m ${s % 60}s`;
	return `${s}s`;
}
