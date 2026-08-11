// AIparser — отправляет видео на AI-сервис парсинга, polling статуса, сохранение результата.
// HTTP-запросы выполняются через Rust (http_upload / http_fetch) — нет CORS.

import path from 'path';
import type { PluginContext } from '../../src/PluginAPI/host';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';


const BASE_URL = 'https://ai-video-parse-xiprk.ondigitalocean.app';
const UPLOAD_URL = `${BASE_URL}/api/upload`;
const STATUS_URL_BASE = `${BASE_URL}/api/job_status/`;
const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 5000;

export async function AIparserFunc(_item: any, _description: any, ctx: PluginContext): Promise<string[]> {
	const { fs, sendToMW } = ctx;
	const finalFile: string[] = [];

	const inputFiles: string[] = _item.import?.inputFile ?? [];
	if (inputFiles.length === 0) throw new Error('inputFile is empty — подключи видео/аудио файл');

	// ── Промпт: linked > existing file > inline textedit ─────────────────────
	let prompt = '';
	const linkedPrompt: string | undefined = _item.import?.inputPrompt?.[0];
	if (linkedPrompt) {
		prompt = (await fs.existsFile(linkedPrompt)) ? await fs.read(linkedPrompt) : linkedPrompt;
	} else if (typeof _item.inputPrompt === 'string') {
		prompt = _item.inputPrompt;
	}
	if (!prompt.trim()) throw new Error('inputPrompt is empty — укажи промпт');

	const DEFAULT_MODEL = 'gemini-flash';
	const model: string = (typeof _item.modelName === 'string' && _item.modelName.trim()) || DEFAULT_MODEL;

	const saveAsFile: boolean = _item.textOrString !== false;

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

	for (const videoFile of inputFiles) {
		sendToMW('statusbar', { text: `${_description.infoText}: [AIparser]\n ${path.basename(videoFile)}` });

		if (saveAsFile) {
			const targetFilePath = createPathForFileByPattern(curPath!, _description, videoFile);
			const targetDir = path.dirname(targetFilePath);
			const targetBaseName = path.basename(targetFilePath, path.extname(targetFilePath));

			await fs.mkdir(targetDir);

			const resultPath = await parseVideoWithRetry({ videoFile, prompt, model, targetDir, targetBaseName }, ctx);
			if (!resultPath) {
				throw new Error(`${_description.curItem} — не удалось обработать: ${path.basename(videoFile)}`);
			}
			finalFile.push(resultPath);
		} else {
			const resultText = await parseVideoToStringWithRetry({ videoFile, prompt, model }, ctx);
			if (resultText === null) {
				throw new Error(`${_description.curItem} — не удалось обработать: ${path.basename(videoFile)}`);
			}
			finalFile.push(resultText);
		}
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}

// ctx последним параметром: host-сервисы живут в нём, у модуля состояния нет → кэшируется.
async function uploadVideoAndPoll(videoFile: string, prompt: string, model: string, ctx: PluginContext): Promise<{ result: any; costUsd: number | null }> {
	const { http, sendToMW } = ctx;
	sendToMW('log', { text: `🌐 POST ${UPLOAD_URL}` });

	const res = await http.upload(UPLOAD_URL, {
		files: [{ field: 'video', path: videoFile, mime: 'video/mp4', filename: path.basename(videoFile) }],
		fields: [
			{ field: 'model', value: model },
			{ field: 'prompt', value: prompt },
		],
	});

	if (!res.ok) throw new Error(`Upload error ${res.status}: ${res.body}`);

	let jobData: any;
	try {
		jobData = JSON.parse(res.body);
	} catch {
		throw new Error(`Invalid JSON from upload: ${res.body.slice(0, 200)}`);
	}

	if (!jobData.job_id) throw new Error(`No job_id in response: ${res.body}`);

	sendToMW('log', { text: `📦 Job accepted: ${jobData.job_id}` });
	return await pollJobStatus(jobData.job_id, ctx);
}

async function parseVideoWithRetry(opts: {
	videoFile: string;
	prompt: string;
	model: string;
	targetDir: string;
	targetBaseName: string;
}, ctx: PluginContext): Promise<string | null> {
	const { fs, sendToMW } = ctx;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			sendToMW('log', { text: `🚀 AIparser attempt ${attempt}/${MAX_ATTEMPTS}: ${path.basename(opts.videoFile)}` });
			const { result: jobResult, costUsd } = await uploadVideoAndPoll(opts.videoFile, opts.prompt, opts.model, ctx);

			const resultStr = typeof jobResult === 'string' ? jobResult : JSON.stringify(jobResult);
			if (resultStr.trimStart().startsWith('<HttpError') || resultStr.trimStart().startsWith('"<HttpError')) {
				throw new Error(`Server returned HttpError: ${resultStr.slice(0, 200)}`);
			}

			const resultPath = path.join(opts.targetDir, `${opts.targetBaseName}.txt`);
			await fs.write(resultPath, JSON.stringify(jobResult, null, 2));
			sendToMW('log', { text: `✅ Saved: ${resultPath}` });

			if (costUsd !== null) {
				sendToMW('node:siteCost', { cost: costUsd } as any);
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
			await new Promise((r) => setTimeout(r, 3000));
		}
	}
	return null;
}

async function parseVideoToStringWithRetry(opts: { videoFile: string; prompt: string; model: string }, ctx: PluginContext): Promise<string | null> {
	const { sendToMW } = ctx;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			sendToMW('log', { text: `🚀 AIparser attempt ${attempt}/${MAX_ATTEMPTS}: ${path.basename(opts.videoFile)}` });
			const { result: jobResult, costUsd } = await uploadVideoAndPoll(opts.videoFile, opts.prompt, opts.model, ctx);

			const resultStr = typeof jobResult === 'string' ? jobResult : JSON.stringify(jobResult, null, 2);
			if (resultStr.trimStart().startsWith('<HttpError') || resultStr.trimStart().startsWith('"<HttpError')) {
				throw new Error(`Server returned HttpError: ${resultStr.slice(0, 200)}`);
			}

			if (costUsd !== null) {
				sendToMW('node:siteCost', { cost: costUsd } as any);
				sendToMW('log', { text: `💰 Cost: $${costUsd}` });
			}
			sendToMW('log', { text: `✅ Result ready (string mode)` });
			return resultStr;
		} catch (err: any) {
			sendToMW('log', { text: `❌ Attempt ${attempt} failed: ${err.message}` });
			if (attempt >= MAX_ATTEMPTS) return null;
			sendToMW('log', { text: '🔁 Retrying...' });
			await new Promise((r) => setTimeout(r, 3000));
		}
	}
	return null;
}

interface JobStatusResult {
	result: any;
	costUsd: number | null;
}

async function pollJobStatus(jobId: string, ctx: PluginContext): Promise<JobStatusResult> {
	const { http, sendToMW } = ctx;
	const statusUrl = `${STATUS_URL_BASE}${jobId}`;
	let lastStatus = '';
	while (true) {
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

		const res = await http.fetch(statusUrl, { headers: [['Accept', 'application/json']] });

		let statusData: { status: string; result?: any; error_info?: string; cost_usd?: number | null };
		try {
			statusData = JSON.parse(res.body);
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
			if (!statusData.result) throw new Error('Result is empty after job completion');
			const costUsd = typeof statusData.cost_usd === 'number' ? statusData.cost_usd : null;
			return { result: statusData.result, costUsd };
		}
		if (status === 'failed' || status === 'error') {
			throw new Error(`Job failed: ${statusData.error_info || 'Unknown error'}`);
		}
	}
}
