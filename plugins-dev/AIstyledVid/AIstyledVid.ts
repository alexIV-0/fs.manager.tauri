// AIstyledVid — AI-стилизация видео через api.video-transformer.tsp.ai.
// HTTP-запросы выполняются через Rust (http_upload / http_fetch / http_download) — нет CORS.

import path from 'path';
import { fs, ffmpeg, http, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';

export { onLoad } from '../_template/tauri';

const BASE_URL = 'https://api.video-transformer.tsp.ai';
const UPLOAD_URL = `${BASE_URL}/api/job/add`;
const STATUS_URL_BASE = `${BASE_URL}/api/job/`;
const POLL_INTERVAL_MS = 5000;
const TARGET_FPS = 16;

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

	const configName: string =
		(typeof _item.modelName === 'string' && _item.modelName.trim()) || 'default_video_generation_config';

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

		const durationSec =
			typeof _item.finalDuration === 'number' && _item.finalDuration > 0
				? _item.finalDuration
				: info.durationInSeconds;
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
	sendToMW('log', { text: `🚀 AIstyledVid uploading: ${path.basename(opts.videoFile)}` });
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

		if (!res.ok) throw new Error(`Upload error ${res.status}: ${res.body}`);

		let jobData: any;
		try {
			jobData = JSON.parse(res.body);
		} catch {
			throw new Error(`Invalid JSON from upload: ${res.body.slice(0, 200)}`);
		}

		if (!jobData.job_id) throw new Error(`No job_id in response: ${res.body}`);
		jobId = jobData.job_id as string;
		sendToMW('log', { text: `📦 Job accepted: ${jobId}` });
	} catch (err: any) {
		sendToMW('log', { text: `❌ Upload failed: ${err.message}` });
		return null;
	}

	// Phase 2: poll until server confirms success or failure — no timeout, no retry limit.
	// Transient network errors are swallowed; only explicit server errors stop the loop.
	try {
		const resultUrls = await pollJobStatus(jobId);
		const latestUrl = getLatestUrl(resultUrls);
		if (!latestUrl) throw new Error('Result file URL not found in job result');

		const urlPath = (() => { try { return new URL(latestUrl).pathname; } catch { return latestUrl; } })();
		const ext = path.extname(urlPath) || path.extname(opts.videoFile) || '.mp4';
		const finalName = `AI_${path.basename(opts.videoFile, path.extname(opts.videoFile))}${ext}`;
		const finalPath = path.join(opts.targetDir, finalName);

		sendToMW('log', { text: `⬇️ Downloading: ${latestUrl}` });
		await http.download(latestUrl, finalPath);
		sendToMW('log', { text: `✅ Saved: ${finalPath}` });
		return finalPath;
	} catch (err: any) {
		sendToMW('log', { text: `❌ Job [${jobId}] failed: ${err.message}` });
		return null;
	}
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

		let statusData: { status: string; result?: any; error?: string };
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
			return Array.isArray(statusData.result) ? statusData.result : [statusData.result];
		}
		if (status === 'failed' || status === 'error') {
			throw new Error(`Job failed: ${statusData.error || 'Unknown error'}`);
		}
	}
}
