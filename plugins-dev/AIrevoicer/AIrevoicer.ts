// AIrevoicer — AI-озвучка текста (TTS) с retry и polling.
// HTTP-запросы выполняются через Rust (http_fetch / http_download) — нет CORS.

import path from 'path';
import type { PluginContext } from '../../src/PluginAPI/host';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';


const BASE_URL = 'https://ai-video-parse-xiprk.ondigitalocean.app/api';
const REVOICE_URL = `${BASE_URL}/revoice`;
const STATUS_URL_BASE = `${BASE_URL}/revoice/status/`;
const DOWNLOAD_URL_BASE = `${BASE_URL}/download_audio/`;
const VOICES_URL = `${BASE_URL}/voices`;
const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 5000;

export async function AIrevoicerFunc(_item: any, _description: any, ctx: PluginContext): Promise<string[]> {
	const { fs, sendToMW } = ctx;
	const finalFile: string[] = [];

	const inputValues: string[] = _item.import?.inputFile ?? [];
	if (inputValues.length === 0) throw new Error('inputFile is empty — подключи текст или файл');

	const voiceName: string = _item.voiseId || '';
	if (!voiceName.trim()) throw new Error('voiseId is empty — укажи имя голоса');

	sendToMW('log', { text: `🎙 Получаем voice_id для "${voiceName}"...` });
	const voiceId = await getVoiceIdByName(voiceName, ctx);

	const voiceOpt = {
		voice_id: voiceId,
		convert_timestamps: _item.convertTimeStamp === true,
		stability: _item.stability ?? 0.5,
		speed: _item.speed ?? 1.0,
		style: _item.style ?? 0.0,
		use_speaker_boost: _item.useSpeakerBoost === true,
		timing_mode: 'ffmpeg',
		tts_model: _item.voiceModel,
	};

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

	for (const inputValue of inputValues) {
		sendToMW('statusbar', { text: `${_description.infoText}: [AIrevoicer]` });

		const isFile = inputValue.length > 0 && (await fs.existsFile(inputValue));
		const textContent = isFile ? await fs.read(inputValue) : inputValue;

		sendToMW('log', {
			text: `📥 inputValue (isFile=${isFile}, len=${textContent.length})`,
		});

		const sourceRef = isFile ? inputValue : path.join(_description.localFolder ?? '.', 'revoice.txt');

		const targetFilePath = createPathForFileByPattern(curPath, _description, sourceRef);
		const targetDir = path.dirname(targetFilePath);
		const targetBaseName = path.basename(targetFilePath, path.extname(targetFilePath));

		await fs.mkdir(targetDir);

		const splitByLines = _item.splitByLines === true || textContent.length > 9000;
		sendToMW('log', {
			text: `⚙️ splitByLines resolved=${splitByLines} (flag=${_item.splitByLines === true}, len>9000=${textContent.length > 9000})`,
		});

		if (splitByLines) {
			const rawLines = textContent.split(/\n/);
			const cleanLines = rawLines.filter((l: string) => l.trim().length > 0);

			sendToMW('log', { text: `✂️ split: rawLines=${rawLines.length}, cleanLines=${cleanLines.length}` });

			for (let i = 0; i < cleanLines.length; i++) {
				const line = cleanLines[i];
				const prefix = ('000' + (i + 1)).slice(-4) + '-';
				const lineTargetBase = prefix + targetBaseName;

				sendToMW('log', { text: `📝 Строка ${i + 1}/${cleanLines.length} (len=${line.length})` });

				const resultPath = await revoiceWithRetry({
					text: line,
					targetDir,
					targetBaseName: lineTargetBase,
					voiceOpt,
				}, ctx);
				if (!resultPath) {
					throw new Error(`${_description.curItem} — не удалось обработать строку ${i + 1}`);
				}
				finalFile.push(resultPath);
			}
		} else {
			sendToMW('log', { text: `📤 Отправка одним куском (len=${textContent.length})` });

			const resultPath = await revoiceWithRetry({
				text: textContent,
				targetDir,
				targetBaseName,
				voiceOpt,
			}, ctx);
			if (!resultPath) throw new Error(`${_description.curItem} — не удалось обработать`);
			finalFile.push(resultPath);
		}
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}

async function revoiceWithRetry(opts: {
	text: string;
	targetDir: string;
	targetBaseName: string;
	voiceOpt: Record<string, any>;
}, ctx: PluginContext): Promise<string | null> {
	const { http, sendToMW } = ctx;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			sendToMW('log', { text: `🚀 Revoice attempt ${attempt}/${MAX_ATTEMPTS}` });

			const res = await http.fetch(REVOICE_URL, {
				method: 'POST',
				headers: [
					['Content-Type', 'application/json'],
					['Accept', 'application/json'],
				],
				body: JSON.stringify({ text: opts.text, ...opts.voiceOpt }),
			});

			if (!res.ok) throw new Error(`Upload error ${res.status}: ${res.body}`);

			let jobData: any;
			try {
				jobData = JSON.parse(res.body);
			} catch {
				throw new Error(`Invalid JSON from revoice: ${res.body.slice(0, 200)}`);
			}

			if (!jobData.job_id) throw new Error(`No job_id in response: ${res.body}`);

			const jobId: string = jobData.job_id;
			sendToMW('log', { text: `📦 Job accepted: ${jobId}` });

			const outputFilename = await pollRevoiceStatus(jobId, ctx);
			const resultPath = path.join(opts.targetDir, opts.targetBaseName + path.extname(outputFilename));

			sendToMW('log', { text: `⬇️ Скачиваем: ${outputFilename}` });
			await http.download(`${DOWNLOAD_URL_BASE}${outputFilename}`, resultPath);

			sendToMW('log', { text: `✅ Saved: ${resultPath}` });
			return resultPath;
		} catch (err: any) {
			sendToMW('log', { text: `❌ Attempt ${attempt} failed: ${err.message}` });
			if (attempt >= MAX_ATTEMPTS) return null;
			sendToMW('log', { text: '🔁 Retrying...' });
			await new Promise((r) => setTimeout(r, 3000));
		}
	}
	return null;
}

async function pollRevoiceStatus(jobId: string, ctx: PluginContext): Promise<string> {
	const { http, sendToMW } = ctx;
	const statusUrl = `${STATUS_URL_BASE}${jobId}`;
	while (true) {
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

		const res = await http.fetch(statusUrl, { headers: [['Accept', 'application/json']] });

		let statusData: { status: string; output_filename?: string; error?: string };
		try {
			statusData = JSON.parse(res.body);
		} catch {
			sendToMW('log', { text: `⚠️ Failed to parse status response, retrying...` });
			continue;
		}

		const status = statusData.status?.toLowerCase();
		sendToMW('log', { text: `🔄 Job [${jobId}] status: ${status}` });

		if (status === 'success' || status === 'completed' || status === 'done' || status === 'finished') {
			if (!statusData.output_filename) throw new Error('output_filename is missing after job completion');
			return statusData.output_filename;
		}
		if (status === 'failed' || status === 'error' || status === 'failure') {
			throw new Error(`Job failed: ${statusData.error || 'Unknown error'}`);
		}
	}
}

async function getVoiceIdByName(name: string, ctx: PluginContext): Promise<string> {
	const { http, sendToMW } = ctx;
	const res = await http.fetch(VOICES_URL, {
		method: 'GET',
		headers: [['Accept', 'application/json']],
	});
	if (!res.ok) throw new Error(`Voices fetch error ${res.status}`);

	let data: any;
	try {
		data = JSON.parse(res.body);
	} catch {
		throw new Error(`Invalid JSON from voices: ${res.body.slice(0, 200)}`);
	}

	const voice = data.voices?.find((v: any) => v.name === name);
	if (!voice) throw new Error(`Голос с именем "${name}" не найден`);
	sendToMW('log', { text: `🎤 Voice "${name}" → id: ${voice.voice_id}` });
	return voice.voice_id;
}
