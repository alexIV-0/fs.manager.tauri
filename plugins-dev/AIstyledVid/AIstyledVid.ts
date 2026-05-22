// AIstyledVid — AI-стилизация видео через api.video-transformer.tsp.ai.
// HTTP-запросы выполняются через Rust (http_upload / http_fetch / http_download) — нет CORS.

import path from 'path';
import { fs, ffmpeg, http, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';

export { onLoad } from '../_template/tauri';

const BASE_URL = 'https://api.video-transformer.tsp.ai';
const UPLOAD_URL = `${BASE_URL}/api/job/add`;
const STATUS_URL_BASE = `${BASE_URL}/api/job/`;
const POLL_INTERVAL_MS = 5000;
const TARGET_FPS = 16;
const MAX_ATTEMPTS = 3;

// Сервер шлёт: queued / в очереди / started / finish (+ страховочные синонимы).
const DONE_STATUSES = new Set(['finish', 'finished', 'completed', 'complete', 'done', 'success', 'succeeded']);
const FAIL_STATUSES = new Set(['failed', 'failure', 'error', 'errored', 'cancelled', 'canceled']);
const PROGRESS_STATUSES = new Set([
	'queued',
	'pending',
	'waiting',
	'в очереди',
	'started',
	'starting',
	'running',
	'processing',
	'in_progress',
	'in-progress',
	'progress',
]);

const FORMAT_RESOLUTION: Record<string, string> = {
	vertical: '480x832',
	horizontal: '832x480',
	square: '512x512',
};

function getFormatType(width: number, height: number): string {
	if (width > height) return 'horizontal';
	if (height > width) return 'vertical';
	return 'square';
}

function getLatestUrl(urls: string[]): string | null {
	if (!Array.isArray(urls) || urls.length === 0) return null;
	let latestUrl: string | null = null;
	let latestTime = 0;
	for (const url of urls) {
		const match = url.match(/(\d{4}-\d{2}-\d{2}-\d{2}h\d{2}m\d{2}s)/);
		if (!match) continue;
		const iso = match[1].replace(/(\d{4})-(\d{2})-(\d{2})-(\d{2})h(\d{2})m(\d{2})s/, '$1-$2-$3T$4:$5:$6');
		const time = new Date(iso).getTime();
		if (time > latestTime) {
			latestTime = time;
			latestUrl = url;
		}
	}
	return latestUrl;
}

export async function AIstyledVidFunc(_item: any, _description: any): Promise<string[]> {
	const finalFile: string[] = [];

	const inputFiles: string[] = _item.import?.inputFile ?? [];
	if (inputFiles.length === 0) throw new Error('inputFile is empty — подключи видео файл');

	const configName: string = (typeof _item.modelName === 'string' && _item.modelName.trim()) || 'default_video_generation_config';

	const localTargetPath: string[] = Array.isArray(_item.targetPath) ? _item.targetPath : [];
	let curPath = localTargetPath.length === 0 ? ['$clearName ($random(3))'] : [...localTargetPath];
	if (_item.import?.targetPath?.length > 0) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	for (const videoFile of inputFiles) {
		sendToMW('statusbar', { text: `${_description.infoText}: [AIstyledVid]\n ${path.basename(videoFile)}` });

		const info = await ffmpeg.getInfo(videoFile);
		const formatType = getFormatType(info.width, info.height);
		const resolution = FORMAT_RESOLUTION[formatType];

		const durationSec = typeof _item.finalDuration === 'number' && _item.finalDuration > 0 ? _item.finalDuration : info.durationInSeconds;
		const videoLength = Math.round(durationSec * TARGET_FPS) + 1;

		sendToMW('log', {
			text: `📐 Format: ${formatType} → ${resolution}, duration: ${durationSec.toFixed(2)}s → ${videoLength} frames`,
		});

		const targetFilePath = createPathForFileByPattern(curPath, _description, videoFile);
		const targetDir = path.dirname(targetFilePath);
		await fs.mkdir(targetDir);

		const resultPath = await styleVideo({
			videoFile,
			configName,
			resolution,
			videoLength,
			targetDir,
		});

		if (!resultPath) {
			throw new Error(`${_description.curItem} — не удалось обработать: ${path.basename(videoFile)}`);
		}
		finalFile.push(resultPath);
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}

async function styleVideo(opts: {
	videoFile: string;
	configName: string;
	resolution: string;
	videoLength: number;
	targetDir: string;
}): Promise<string | null> {
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		sendToMW('log', { text: `🚀 AIstyledVid attempt ${attempt}/${MAX_ATTEMPTS}: ${path.basename(opts.videoFile)}` });
		sendToMW('log', { text: `🌐 POST ${UPLOAD_URL}` });

		let jobId: string;
		try {
			const res = await http.upload(UPLOAD_URL, {
				files: [{ field: 'video_file', path: opts.videoFile, mime: 'video/mp4', filename: path.basename(opts.videoFile) }],
				fields: [
					{ field: 'config_name', value: opts.configName },
					{ field: 'config_overrides', value: JSON.stringify({ resolution: opts.resolution, video_length: opts.videoLength }) },
				],
			});

			if (!res.ok) throw new Error(`Upload error ${res.status}: ${res.body.slice(0, 500)}`);

			let jobData: any;
			try {
				jobData = JSON.parse(res.body);
			} catch {
				throw new Error(`Invalid JSON from upload: ${res.body.slice(0, 500)}`);
			}

			const extractedId = jobData?.job_id ?? jobData?.jobId ?? jobData?.id ?? jobData?.task_id ?? jobData?.taskId;
			if (!extractedId) throw new Error(`No job_id in response: ${res.body.slice(0, 500)}`);
			jobId = String(extractedId);
			sendToMW('log', { text: `📦 Job accepted: ${jobId}` });
		} catch (err: any) {
			sendToMW('log', { text: `❌ Upload failed: ${err.message}` });
			if (attempt < MAX_ATTEMPTS) {
				sendToMW('log', { text: `🔁 Retrying upload...` });
				continue;
			}
			return null;
		}

		try {
			const resultUrls = await pollJobStatus(jobId);
			const latestUrl = getLatestUrl(resultUrls);
			if (!latestUrl) throw new Error('Result file URL not found in job result');

			const urlPath = (() => {
				try {
					return new URL(latestUrl).pathname;
				} catch {
					return latestUrl;
				}
			})();
			const ext = path.extname(urlPath) || path.extname(opts.videoFile) || '.mp4';
			const finalName = `AI_${path.basename(opts.videoFile, path.extname(opts.videoFile))}${ext}`;
			const finalPath = path.join(opts.targetDir, finalName);

			sendToMW('log', { text: `⬇️ Downloading: ${latestUrl}` });
			await http.download(latestUrl, finalPath);
			sendToMW('log', { text: `✅ Saved: ${finalPath}` });
			return finalPath;
		} catch (err: any) {
			sendToMW('log', { text: `❌ Job [${jobId}] failed: ${err.message}` });
			if (attempt < MAX_ATTEMPTS) {
				sendToMW('log', { text: `🔁 Re-uploading for retry ${attempt + 1}/${MAX_ATTEMPTS}...` });
				continue;
			}
			sendToMW('log', { text: `⏭ Skipped after ${MAX_ATTEMPTS} attempts` });
			return null;
		}
	}

	return null;
}

async function pollJobStatus(jobId: string): Promise<string[]> {
	const statusUrl = `${STATUS_URL_BASE}${jobId}/status`;
	let lastStatus = '';

	while (true) {
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

		let res: Awaited<ReturnType<typeof http.fetch>>;
		try {
			res = await http.fetch(statusUrl, { headers: [['Accept', 'application/json']] });
		} catch (err: any) {
			// Transient network error — keep polling, do not abort the job.
			sendToMW('log', { text: `⚠️ Network error polling [${jobId}]: ${err.message}, retrying...` });
			continue;
		}

		// 5xx и временные 4xx (например, 404 пока задача ещё не зарегистрирована) — продолжаем опрос.
		if (!res.ok) {
			sendToMW('log', { text: `⚠️ Status HTTP ${res.status} for [${jobId}], retrying... body: ${res.body.slice(0, 200)}` });
			continue;
		}

		let statusData: any;
		try {
			statusData = JSON.parse(res.body);
		} catch {
			sendToMW('log', { text: `⚠️ Failed to parse status response, retrying... body: ${res.body.slice(0, 200)}` });
			continue;
		}

		const rawStatus: string | undefined = statusData?.status ?? statusData?.state ?? statusData?.job_status;
		const status = (rawStatus ?? '').toString().trim().toLowerCase();

		if (status !== lastStatus) {
			sendToMW('log', { text: `🔄 Job [${jobId}] status: ${status || '(empty)'}` });
			lastStatus = status;
		}

		if (DONE_STATUSES.has(status)) {
			const result = statusData?.result ?? statusData?.results ?? statusData?.urls ?? statusData?.output;
			if (!result) throw new Error(`Result is empty after job completion. Body: ${res.body.slice(0, 500)}`);
			return Array.isArray(result) ? result : [result];
		}
		if (FAIL_STATUSES.has(status)) {
			throw new Error(`Job failed: ${statusData?.error || statusData?.message || res.body.slice(0, 300)}`);
		}
		if (!status || (!PROGRESS_STATUSES.has(status) && !DONE_STATUSES.has(status))) {
			// Незнакомый статус — не падаем, просто продолжаем ждать (вдруг сервер добавил новое состояние).
			sendToMW('log', { text: `ℹ️ Unknown status "${status}" for [${jobId}], keep polling...` });
		}
	}
}
