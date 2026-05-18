import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { sendToMW } from '../_template/pluginSender';
import path from 'path';
import fs from 'fs';

export { onLoad } from '../_template/pluginSender';

const BASE_URL = 'https://ai-video-parse-xiprk.ondigitalocean.app';
const UPLOAD_URL = `${BASE_URL}/api/upload`;
const STATUS_URL_BASE = `${BASE_URL}/api/job_status/`;
const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 5000;

export async function AIparserFunc(_item: any, _description: any) {
	const finalFile: string[] = [];

	// ── Входные файлы ─────────────────────────────────────────────────
	const inputFiles: string[] = _item.import?.inputFile ?? [];
	if (inputFiles.length === 0) {
		throw new Error('inputFile is empty — подключи видео/аудио файл');
	}

	// ── Промпт ────────────────────────────────────────────────────────
	// Приоритет: linked value (или файл) > inline textedit
	let prompt = '';
	const linkedPrompt: string | undefined = _item.import?.inputPrompt?.[0];
	if (linkedPrompt) {
		prompt = fs.existsSync(linkedPrompt) ? fs.readFileSync(linkedPrompt, 'utf-8') : linkedPrompt;
	} else if (typeof _item.inputPrompt === 'string') {
		prompt = _item.inputPrompt;
	}
	if (!prompt.trim()) {
		throw new Error('inputPrompt is empty — укажи промпт');
	}

	const DEFAULT_MODEL = 'gemini-flash';
	const model: string = (typeof _item.modelName === 'string' && _item.modelName.trim()) || DEFAULT_MODEL;

	// ── Режим вывода: файл (true) или строка (false) ──────────────────
	const saveAsFile: boolean = _item.textOrString !== false;

	// ── Путь для сохранения (только в режиме файла) ───────────────────
	let curPath: string[] | null = null;
	if (saveAsFile) {
		const localTargetPath: string[] = Array.isArray(_item.targetPath) ? _item.targetPath : [];
		curPath = localTargetPath.length === 0 ? ['$clearName ($random(3))'] : [...localTargetPath];

		if (_item.import?.targetPath?.length > 0) {
			curPath.unshift(..._item.import.targetPath);
		} else {
			curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
		}
	}

	// ── Обрабатываем каждый входной файл ─────────────────────────────
	for (const videoFile of inputFiles) {
		sendToMW('statusbar', {
			text: `${_description.infoText}: [AIparser]\n ${path.basename(videoFile)}`,
		});

		if (saveAsFile) {
			const targetFilePath = createPathForFileByPattern(curPath!, _description, videoFile);
			const targetDir = path.dirname(targetFilePath);
			const targetBaseName = path.basename(targetFilePath, path.extname(targetFilePath));

			testAndCreateFolder(targetDir);

			const resultPath = await parseVideoWithRetry({ videoFile, prompt, model, targetDir, targetBaseName });

			if (!resultPath) {
				throw new Error(`${_description.curItem} — не удалось обработать: ${path.basename(videoFile)}`);
			}

			finalFile.push(resultPath);
		} else {
			const resultText = await parseVideoToStringWithRetry({ videoFile, prompt, model });

			if (resultText === null) {
				throw new Error(`${_description.curItem} — не удалось обработать: ${path.basename(videoFile)}`);
			}

			finalFile.push(resultText);
		}
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile}` });
	return finalFile;
}

// ── Отправка с retry ─────────────────────────────────────────────────

async function parseVideoWithRetry(opts: {
	videoFile: string;
	prompt: string;
	model: string;
	targetDir: string;
	targetBaseName: string;
}): Promise<string | null> {
	let attempt = 0;

	while (attempt < MAX_ATTEMPTS) {
		attempt++;

		try {
			sendToMW('log', { text: `🚀 AIparser attempt ${attempt}/${MAX_ATTEMPTS}: ${path.basename(opts.videoFile)}` });

			// ── Upload video ─────────────────────────────────────────
			const videoBuffer = fs.readFileSync(opts.videoFile);
			const videoBlob = new Blob([videoBuffer], { type: 'video/mp4' });

			const formData = new FormData();
			formData.append('video', videoBlob, path.basename(opts.videoFile));
			formData.append('model', opts.model);
			formData.append('prompt', opts.prompt);

			sendToMW('log', { text: `🌐 POST ${UPLOAD_URL}` });

			const uploadResponse = await fetch(UPLOAD_URL, {
				method: 'POST',
				body: formData,
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
			const { result: jobResult, costUsd } = await pollJobStatus(jobId);

			// ── Проверка на HttpError ────────────────────────────────
			const resultStr = typeof jobResult === 'string' ? jobResult : JSON.stringify(jobResult);
			if (resultStr.trimStart().startsWith('<HttpError') || resultStr.trimStart().startsWith('"<HttpError')) {
				throw new Error(`Server returned HttpError: ${resultStr.slice(0, 200)}`);
			}

			// ── Сохраняем результат ──────────────────────────────────
			const resultPath = path.join(opts.targetDir, `${opts.targetBaseName}.txt`);
			fs.writeFileSync(resultPath, JSON.stringify(jobResult, null, 2), 'utf-8');
			sendToMW('log', { text: `✅ Saved: ${resultPath}` });

			if (costUsd !== null) {
				sendToMW('node:siteCost', { cost: costUsd });
				sendToMW('log', { text: `💰 Cost: $${costUsd}` });
			}

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

// ── Отправка с retry, возврат строки ────────────────────────────────

async function parseVideoToStringWithRetry(opts: { videoFile: string; prompt: string; model: string }): Promise<string | null> {
	let attempt = 0;

	while (attempt < MAX_ATTEMPTS) {
		attempt++;

		try {
			sendToMW('log', { text: `🚀 AIparser attempt ${attempt}/${MAX_ATTEMPTS}: ${path.basename(opts.videoFile)}` });

			const videoBuffer = fs.readFileSync(opts.videoFile);
			const videoBlob = new Blob([videoBuffer], { type: 'video/mp4' });

			const formData = new FormData();
			formData.append('video', videoBlob, path.basename(opts.videoFile));
			formData.append('model', opts.model);
			formData.append('prompt', opts.prompt);

			sendToMW('log', { text: `🌐 POST ${UPLOAD_URL}` });

			const uploadResponse = await fetch(UPLOAD_URL, { method: 'POST', body: formData });

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

			const { result: jobResult, costUsd } = await pollJobStatus(jobId);

			const resultStr = typeof jobResult === 'string' ? jobResult : JSON.stringify(jobResult, null, 2);
			if (resultStr.trimStart().startsWith('<HttpError') || resultStr.trimStart().startsWith('"<HttpError')) {
				throw new Error(`Server returned HttpError: ${resultStr.slice(0, 200)}`);
			}

			if (costUsd !== null) {
				sendToMW('node:siteCost', { cost: costUsd });
				sendToMW('log', { text: `💰 Cost: $${costUsd}` });
			}

			sendToMW('log', { text: `✅ Result ready (string mode)` });
			return resultStr;
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

interface JobStatusResult {
	result: any;
	costUsd: number | null;
}

async function pollJobStatus(jobId: string): Promise<JobStatusResult> {
	const statusUrl = `${STATUS_URL_BASE}${jobId}`;

	let lastStatus = '';
	while (true) {
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

		const statusResponse = await fetch(statusUrl, {
			headers: { accept: 'application/json' },
		});

		let statusData: { status: string; result?: any; error_info?: string; cost_usd?: number | null };
		try {
			statusData = await statusResponse.json();
		} catch {
			sendToMW('log', { text: `⚠️ Failed to parse status response, retrying...` });
			continue;
		}

		const status = statusData.status?.toLowerCase();
		if (status !== lastStatus) {
			sendToMW('log', { text: `🔄 Job [${jobId}] status: ${status}` });
			lastStatus = status;
		}

		if (status === 'completed' || status === 'done' || status === 'success' || status === 'finished') {
			if (!statusData.result) {
				throw new Error('Result is empty after job completion');
			}
			const costUsd = typeof statusData.cost_usd === 'number' ? statusData.cost_usd : null;
			return { result: statusData.result, costUsd };
		}

		if (status === 'failed' || status === 'error') {
			throw new Error(`Job failed: ${statusData.error_info || 'Unknown error'}`);
		}
	}
}
