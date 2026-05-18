import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { sendToMW } from '../_template/pluginSender';
import path from 'path';
import fs from 'fs';

export { onLoad } from '../_template/pluginSender';

const BASE_URL = 'https://ai-video-parse-xiprk.ondigitalocean.app/api';
const REVOICE_URL = `${BASE_URL}/revoice`;
const STATUS_URL_BASE = `${BASE_URL}/revoice/status/`;
const DOWNLOAD_URL_BASE = `${BASE_URL}/download_audio/`;
const VOICES_URL = `${BASE_URL}/voices`;
const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 5000;

export async function AIrevoicerFunc(_item: any, _description: any) {
	const finalFile: string[] = [];

	// ── Входные данные ────────────────────────────────────────────────
	const inputValues: string[] = _item.import?.inputFile ?? [];
	if (inputValues.length === 0) {
		throw new Error('inputFile is empty — подключи текст или файл');
	}

	// ── Имя голоса и его ID ──────────────────────────────────────────
	const voiceName: string = _item.voiseId || '';
	if (!voiceName.trim()) {
		throw new Error('voiseId is empty — укажи имя голоса');
	}

	sendToMW('log', { text: `🎙 Получаем voice_id для "${voiceName}"...` });
	const voiceId = await getVoiceIdByName(voiceName);

	const voiceOpt = {
		voice_id: voiceId,
		convert_timestamps: _item.convertTimeStamp === true,
		stability: _item.stability ?? 0.5,
		speed: _item.speed ?? 1.0,
		style: _item.style ?? 0.0,
		use_speaker_boost: _item.useSpeakerBoost === true,
		timing_mode: 'ffmpeg',
	};

	// ── Путь для сохранения ──────────────────────────────────────────
	const localTargetPath: string[] = Array.isArray(_item.targetPath) ? _item.targetPath : [];
	let curPath = localTargetPath.length === 0 ? ['$clearName ($random(3))'] : [...localTargetPath];

	if (_item.import?.targetPath?.length > 0) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	sendToMW('log', {
		text: `🔎 inputValues: count=${inputValues.length}, splitByLines raw=${JSON.stringify(_item.splitByLines)}`,
	});

	// ── Обработка каждого входного значения ──────────────────────────
	for (const inputValue of inputValues) {
		sendToMW('statusbar', {
			text: `${_description.infoText}: [AIrevoicer]`,
		});

		// Определяем: путь к файлу или строка
		const isFile = inputValue.length > 0 && fs.existsSync(inputValue);
		const textContent = isFile ? fs.readFileSync(inputValue, 'utf-8') : inputValue;

		sendToMW('log', {
			text: `📥 inputValue (isFile=${isFile}, len=${textContent.length}): ${JSON.stringify(textContent)}`,
		});

		// Для паттерна имени файла используем путь (или фиктивное имя для строки)
		const sourceRef = isFile ? inputValue : path.join(_description.localFolder ?? '.', 'revoice.txt');

		const targetFilePath = createPathForFileByPattern(curPath, _description, sourceRef);
		const targetDir = path.dirname(targetFilePath);
		const targetBaseName = path.basename(targetFilePath, path.extname(targetFilePath));

		testAndCreateFolder(targetDir);

		const splitByLines = _item.splitByLines === true || textContent.length > 9000;

		sendToMW('log', {
			text: `⚙️ splitByLines resolved=${splitByLines} (flag=${_item.splitByLines === true}, len>9000=${textContent.length > 9000})`,
		});

		if (splitByLines) {
			const rawLines = textContent.split(/\n/);
			const cleanLines = rawLines.filter((l: string) => l.trim().length > 0);

			sendToMW('log', {
				text: `✂️ split: rawLines=${rawLines.length}, cleanLines=${cleanLines.length}`,
			});

			for (let i = 0; i < cleanLines.length; i++) {
				const line = cleanLines[i];
				const prefix = ('000' + (i + 1)).slice(-4) + '-';
				const lineTargetBase = prefix + targetBaseName;

				sendToMW('log', {
					text: `📝 Строка ${i + 1}/${cleanLines.length} (len=${line.length}): ${JSON.stringify(line)}`,
				});

				const resultPath = await revoiceWithRetry({
					text: line,
					targetDir,
					targetBaseName: lineTargetBase,
					voiceOpt,
				});

				if (!resultPath) {
					throw new Error(`${_description.curItem} — не удалось обработать строку ${i + 1}`);
				}

				finalFile.push(resultPath);
			}
		} else {
			sendToMW('log', {
				text: `📤 Отправка одним куском (len=${textContent.length}): ${JSON.stringify(textContent.slice(0, 200))}${textContent.length > 200 ? '…' : ''}`,
			});

			const resultPath = await revoiceWithRetry({
				text: textContent,
				targetDir,
				targetBaseName,
				voiceOpt,
			});

			if (!resultPath) {
				throw new Error(`${_description.curItem} — не удалось обработать`);
			}

			finalFile.push(resultPath);
		}
	}
	sendToMW('log', { level: 'info', text: `Result:\n${finalFile}` });
	return finalFile;
}

// ── Отправка с retry ─────────────────────────────────────────────────

async function revoiceWithRetry(opts: {
	text: string;
	targetDir: string;
	targetBaseName: string;
	voiceOpt: Record<string, any>;
}): Promise<string | null> {
	let attempt = 0;

	while (attempt < MAX_ATTEMPTS) {
		attempt++;

		try {
			sendToMW('log', { text: `🚀 Revoice attempt ${attempt}/${MAX_ATTEMPTS}` });

			// ── Отправка задачи ──────────────────────────────────────
			const uploadResponse = await fetch(REVOICE_URL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json',
				},
				body: JSON.stringify({
					text: opts.text,
					...opts.voiceOpt,
				}),
			});

			if (!uploadResponse.ok) {
				const errText = await uploadResponse.text();
				throw new Error(`Upload error ${uploadResponse.status}: ${errText}`);
			}

			const jobData = await uploadResponse.json();

			if (!jobData.job_id) {
				throw new Error(`No job_id in response: ${JSON.stringify(jobData)}`);
			}

			const jobId: string = jobData.job_id;
			sendToMW('log', { text: `📦 Job accepted: ${jobId}` });

			// ── Polling статуса ──────────────────────────────────────
			const outputFilename = await pollRevoiceStatus(jobId);

			// ── Скачивание файла ─────────────────────────────────────
			const resultPath = path.join(opts.targetDir, opts.targetBaseName + path.extname(outputFilename));

			sendToMW('log', { text: `⬇️ Скачиваем: ${outputFilename}` });

			const downloadResponse = await fetch(`${DOWNLOAD_URL_BASE}${outputFilename}`);
			if (!downloadResponse.ok) {
				throw new Error(`Download error ${downloadResponse.status}`);
			}

			const arrayBuffer = await downloadResponse.arrayBuffer();
			fs.writeFileSync(resultPath, Buffer.from(arrayBuffer));

			sendToMW('log', { text: `✅ Saved: ${resultPath}` });
			return resultPath;
		} catch (err: any) {
			sendToMW('log', { text: `❌ Attempt ${attempt} failed: ${err.message}` });

			if (attempt >= MAX_ATTEMPTS) {
				sendToMW('log', { text: `⏭ Skipped after ${MAX_ATTEMPTS} attempts` });
				return null;
			}

			sendToMW('log', { text: '🔁 Retrying...' });
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}
	}

	return null;
}

// ── Polling статуса ──────────────────────────────────────────────────

async function pollRevoiceStatus(jobId: string): Promise<string> {
	const statusUrl = `${STATUS_URL_BASE}${jobId}`;

	while (true) {
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

		const statusResponse = await fetch(statusUrl, {
			headers: { Accept: 'application/json' },
		});

		let statusData: { status: string; output_filename?: string; error?: string };
		try {
			statusData = await statusResponse.json();
		} catch {
			sendToMW('log', { text: `⚠️ Failed to parse status response, retrying...` });
			continue;
		}

		const status = statusData.status?.toLowerCase();
		sendToMW('log', { text: `🔄 Job [${jobId}] status: ${status}` });

		if (status === 'success' || status === 'completed' || status === 'done' || status === 'finished') {
			if (!statusData.output_filename) {
				throw new Error('output_filename is missing after job completion');
			}
			return statusData.output_filename;
		}

		if (status === 'failed' || status === 'error' || status === 'failure') {
			throw new Error(`Job failed: ${statusData.error || 'Unknown error'}`);
		}
	}
}

// ── Получение voice_id по имени ──────────────────────────────────────

async function getVoiceIdByName(name: string): Promise<string> {
	const response = await fetch(VOICES_URL, {
		method: 'GET',
		headers: { Accept: 'application/json' },
	});

	if (!response.ok) {
		throw new Error(`Voices fetch error ${response.status}`);
	}

	const data = await response.json();
	const voice = data.voices?.find((v: any) => v.name === name);

	if (!voice) {
		throw new Error(`Голос с именем "${name}" не найден`);
	}

	sendToMW('log', { text: `🎤 Voice "${name}" → id: ${voice.voice_id}` });
	return voice.voice_id;
}
