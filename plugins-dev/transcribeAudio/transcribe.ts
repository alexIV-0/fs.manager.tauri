import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { tryToUnlinkFile } from '../../electron/main/fileSistem/copyOrMoveItem';
import { sendToMW } from '../_template/pluginSender';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { getFullInfoFromVideoFile } from '../../electron/main/processing/ffmpeg/getFullInfoFromVideoFile';
import { spawnFFmpegCommand } from '../../electron/main/processing/ffmpeg/spawnFFmpegCommand';
import { exec } from 'child_process';
import { promisify } from 'util';
import { msToTime } from '../../jsx/utils/msToTime';

const execAsync = promisify(exec);

export { onLoad } from '../_template/pluginSender';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const threads = Math.max(4, os.cpus().length - 2);

// Модели от наименьшей к наибольшей для детекта языка
const DETECT_MODELS = ['ggml-tiny.bin', 'ggml-base.bin', 'ggml-small.bin', 'ggml-medium.bin'];

// Длительности для попыток определения языка (в мс)
const DETECT_DURATIONS = [20000, 30000, 40000, 50000, 60000];

const FORMAT_MAP: Record<string, { flag: string; ext: string }> = {
	jsonfull: { flag: '--output-json-full', ext: '.json' },
	json: { flag: '--output-json', ext: '.json' },
	srt: { flag: '--output-srt', ext: '.srt' },
	vtt: { flag: '--output-vtt', ext: '.vtt' },
	txt: { flag: '--output-txt', ext: '.txt' },
};

// Определяем бинарник под платформу
function getWhisperBin(): string {
	const platform = process.platform;
	const arch = process.arch;

	if (platform === 'darwin') {
		const folder = arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
		return path.join(__dirname, 'whisper', folder, 'whisper-cli');
	}
	if (platform === 'win32') {
		return path.join(__dirname, 'whisper', 'win-x64', 'whisper-cli.exe');
	}
	throw new Error(`Unsupported platform: ${platform}`);
}

// Находим наименьшую доступную модель
async function findLightestModel(modelsFolder: string): Promise<string> {
	for (const modelName of DETECT_MODELS) {
		const modelPath = path.join(modelsFolder, modelName);
		try {
			await fs.access(modelPath);
			return modelPath;
		} catch {}
	}
	throw new Error(`[whisper] no detect model found in: ${modelsFolder}`);
}

// Определяем язык с нарастающей длительностью
async function detectLanguage(bin: string, modelPath: string, audioFile: string): Promise<string> {
	for (const duration of DETECT_DURATIONS) {
		const args = [
			'-m',
			`"${modelPath}"`,
			'-f',
			`"${audioFile}"`,
			'--language',
			'auto',
			'--duration',
			String(duration),
			// '--threads',
			// String(threads),
			'--print-special',
		].join(' ');

		try {
			const { stdout, stderr } = await execAsync(`"${bin}" ${args}`);
			const langMatch = (stdout + stderr).match(/auto-detected language:\s*(\w+)/i);
			if (langMatch && langMatch[1]) {
				sendToMW('log', { text: `[whisper] language "${langMatch[1]}" detected at ${duration / 1000}s` });
				return langMatch[1];
			}
			// } catch (e) {
			// 	sendToMW('log', { text: `[whisper] detect failed at ${duration / 1000}s, trying longer...` });
			// }
		} catch (e: any) {
			sendToMW('log', {
				text: `[whisper] detect error at ${duration / 1000}s: ${e?.message}\nstderr: ${e?.stderr}\nstdout: ${e?.stdout}`,
			});
		}
	}

	sendToMW('log', { text: `[whisper] language not detected, falling back to "en"` });
	return 'en';
}

// Основной прогон — полная транскрипция
function buildTranscribeCommand(modelPath: string, audioFile: string, language: string, outputFile: string, outputFormat: string): string[] {
	const format = FORMAT_MAP[outputFormat] ?? FORMAT_MAP['jsonfull'];

	// Базовые флаги — общие для всех форматов
	const args = [
		'-m',
		modelPath,
		'-f',
		audioFile,
		'--language',
		language,
		// '--threads',
		// String(threads),
		'--beam-size',
		'5',
		'--temperature',
		'0',
		'--suppress-nst',
		'--no-speech-thold',
		'0.6',
		'--logprob-thold',
		'-1.0',
		format.flag,
		'--output-file',
		outputFile,
	];

	// Точные таймкоды по словам — только для json форматов
	if (outputFormat === 'jsonfull' || outputFormat === 'json') {
		args.push('--max-len', '1');
		args.push('--split-on-word');
	}

	return args;
}

export async function transcribe(_item: any, _description: any) {
	let finalFile: any[] = [];

	let curPath = _item.targetPath.length == 0 ? ['$clearName ($random(3))'] : _item.targetPath;

	if (_item.import.targetPath) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	// const fileForName = getPreferredFile(_item, _description) || '';
	const fileForName = _description.pathForDelete;
	let fileTo = createPathForFileByPattern(curPath, _description, fileForName);

	testAndCreateFolder(path.dirname(fileTo));

	// // Отправляем статус перед копированием
	sendToMW('statusbar', {
		text: `${_description.infoText}: [whisper transcribe]\n ${_description.curItem}`,
	});

	let iteration = 1;

	const DatStart = new Date().getTime();
	sendToMW('log', { text: `[whisper] 🎤 Initializing Whisper...` });

	for (let fileFrom of _item.import.inputFile) {
		const bin = getWhisperBin();
		const fileDir = path.dirname(fileTo);

		if (_item.import.inputFile.length > 1) {
			const fileExt = path.extname(fileTo);
			const fileName = path.basename(fileTo, fileExt);
			fileTo = path.join(fileDir, `${fileName}_${iteration}${fileExt}`);
			iteration++;
		}

		const fileInfo = await getFullInfoFromVideoFile(fileFrom, _description);
		if (!fileInfo.hasAudio) {
			continue;
		}
		sendToMW('log', { text: `[whisper] file length: ${fileInfo.durationInTimcode} (${fileInfo.durationInSeconds})` });

		const fileBaseName = path.basename(fileTo, path.extname(fileTo));
		const pcmFile = path.join(fileDir, `${fileBaseName}_temp.wav`);

		// 1. Конвертируем в WAV 16kHz mono
		const convertCommand = {
			text: `${_description.infoText}: [whisper] preparing audio`,
			duration: 0,
			command: ['-y', '-i', fileFrom, '-vn', '-ac', '1', '-ar', '16000', pcmFile],
		};
		await spawnFFmpegCommand(convertCommand, _description, sendToMW);

		// 2. Определяем язык
		const modelsFolder = _description.folderPath.whisper[0];
		const lightModel = await findLightestModel(modelsFolder);
		const language = await detectLanguage(bin, lightModel, pcmFile);

		// const language = langMatch ? langMatch[1] : 'en';
		sendToMW('log', { text: `[whisper] detected language: ${language},\nmodel: ${_item.whisperModel}` });

		// 3. Транскрипция
		const outputFormat = (_item.outputFormat ?? 'jsonfull').toLowerCase();
		const format = FORMAT_MAP[outputFormat] ?? FORMAT_MAP['jsonfull'];

		const outputBase = path.join(fileDir, `${fileBaseName} (wispher)`);
		const modelPath = path.join(_description.folderPath.whisper[0], _item.whisperModel);
		const transcribeArgs = buildTranscribeCommand(modelPath, pcmFile, language, outputBase, outputFormat);
		const transcribeCmd = `"${bin}" ${transcribeArgs.map((arg) => (arg.includes(' ') || arg.includes('(') ? `"${arg}"` : arg)).join(' ')}`;
		sendToMW('log', { text: `[whisper] outputFormat raw: "${_item.outputFormat}"` });
		sendToMW('log', { text: `[whisper] transcribe cmd:\n${transcribeCmd}` });
		await execAsync(transcribeCmd);

		// 4. Удаляем temp файл
		try {
			tryToUnlinkFile(pcmFile);
		} catch {}

		// 5. Кладём результат в массив
		finalFile.push(`${outputBase}${format.ext}`);
	}

	const DatEnd = new Date().getTime();
	const Rez = msToTime(DatEnd - DatStart);
	// sendToMW('log', { text: `[whisper] ⏱️  Transcription time: ${Rez}` });
	sendToMW('log', { level: 'info', text: `Result:\n${finalFile}` });
	return finalFile;
}
