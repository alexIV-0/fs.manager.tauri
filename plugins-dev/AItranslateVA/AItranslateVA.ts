// AItranslateVA — AI-дубляж видео/аудио на разные языки через сервис dubbing API.
// HTTP-запросы выполняются через Rust (http_upload / http_fetch / http_download) — нет CORS.

import path from 'path';
import { fs, http, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';

export { onLoad } from '../_template/tauri';

const BASE_URL = 'https://ai-video-parse-xiprk.ondigitalocean.app';
const SUBMIT_URL = `${BASE_URL}/api/dubbing/submit`;
const STATUS_URL_BASE = `${BASE_URL}/api/dubbing/status/`;
const DOWNLOAD_VIDEO_URL_BASE = `${BASE_URL}/api/dubbing/download/`;
const DOWNLOAD_AUDIO_URL_BASE = `${BASE_URL}/api/dubbing/download-audio/`;
const LANGUAGES_URL = `${BASE_URL}/api/dubbing/languages`;
const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 5000;
const AUDIO_EXT_RE = /\.(mp3|wav|m4a|ogg|aac|flac)$/i;

type LangMap = Record<string, string>;
let languagesCache: LangMap | null = null;

export async function AItranslateVAFunc(_item: any, _description: any): Promise<string[]> {
	const finalFile: string[] = [];

	const inputFiles: string[] = _item.import?.inputFile ?? [];
	if (inputFiles.length === 0) throw new Error('inputFile is empty — подключи видео/аудио файл');

	const targetLangNames: string[] = Array.isArray(_item.translateLang) ? _item.translateLang : [];
	if (targetLangNames.length === 0) throw new Error('translateLang is empty — выбери хотя бы один язык');

	const sourceLangRaw: string = typeof _item.sourceLang === 'string' ? _item.sourceLang : 'auto';
	const numSpeakers: number = Number.isFinite(_item.numSpeakers) ? Number(_item.numSpeakers) : 0;
	const dropBg: boolean = _item.dropBackgroundAudio === true;

	const langMap = await getLanguagesMap();
	const targetLangs = targetLangNames.map((name) => {
		const code = langMap[name];
		if (!code) throw new Error(`Неизвестный язык: ${name}`);
		return { name, code };
	});
	const sourceLangCode = sourceLangRaw === 'auto' || !sourceLangRaw ? 'auto' : langMap[sourceLangRaw] || 'auto';

	const localTargetPath: string[] = Array.isArray(_item.targetPath) ? _item.targetPath : [];
	let curPath = localTargetPath.length === 0 ? ['$fileName ($random(3))'] : [...localTargetPath];
	if (_item.import?.targetPath?.length > 0) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	const maskHasLangToken = curPath.some((p) => /\$ISO|\$language/.test(p));

	for (const videoFile of inputFiles) {
		const isAudioInput = AUDIO_EXT_RE.test(videoFile);
		const expectedExt = isAudioInput ? '.mp3' : '.mp4';

		for (const lang of targetLangs) {
			sendToMW('statusbar', {
				text: `${_description.infoText}: [AItranslateVA → ${lang.name}]\n ${path.basename(videoFile)}`,
			});

			const builtPath = createPathForFileByPattern(curPath, _description, videoFile);
			const resolvedPath = builtPath.replace(/\$ISO/g, lang.code).replace(/\$language/g, lang.name);

			const parsed = path.parse(resolvedPath);
			let baseName = parsed.name;
			if (!maskHasLangToken) baseName = `${baseName}_${lang.code}`;
			const targetFilePath = path.join(parsed.dir, baseName + expectedExt);
			const targetDir = parsed.dir;

			await fs.mkdir(targetDir);

			const ok = await dubWithRetry({
				videoFile,
				targetLangCode: lang.code,
				sourceLangCode,
				numSpeakers,
				dropBg,
				isAudioInput,
				targetFilePath,
			});

			if (!ok) {
				throw new Error(`${_description.curItem} — не удалось перевести ${path.basename(videoFile)} → ${lang.name}`);
			}
			finalFile.push(targetFilePath);
		}
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}

async function dubWithRetry(opts: {
	videoFile: string;
	targetLangCode: string;
	sourceLangCode: string;
	numSpeakers: number;
	dropBg: boolean;
	isAudioInput: boolean;
	targetFilePath: string;
}): Promise<boolean> {
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			sendToMW('log', {
				text: `🚀 Dubbing attempt ${attempt}/${MAX_ATTEMPTS}: ${path.basename(opts.videoFile)} → ${opts.targetLangCode}`,
			});

			const mime = opts.isAudioInput ? 'audio/mpeg' : 'video/mp4';
			sendToMW('log', { text: `🌐 POST ${SUBMIT_URL}` });

			const res = await http.upload(SUBMIT_URL, {
				files: [{ field: 'video', path: opts.videoFile, mime, filename: path.basename(opts.videoFile) }],
				fields: [
					{ field: 'target_language', value: opts.targetLangCode },
					{ field: 'source_language', value: opts.sourceLangCode },
					{ field: 'num_speakers', value: String(opts.numSpeakers) },
					{ field: 'drop_background_audio', value: String(opts.dropBg) },
				],
			});

			if (!res.ok) throw new Error(`Submit error ${res.status}: ${res.body}`);

			let jobData: any;
			try {
				jobData = JSON.parse(res.body);
			} catch {
				throw new Error(`Invalid JSON from submit: ${res.body.slice(0, 200)}`);
			}

			if (!jobData.job_id) throw new Error(`No job_id in response: ${res.body}`);

			const jobId: number = jobData.job_id;
			sendToMW('log', { text: `📦 Job accepted: ${jobId} (rq=${jobData.rq_job_id})` });

			const finalStatus = await pollDubbingStatus(jobId);

			const isAudioOnly = finalStatus.is_audio_only === true || opts.isAudioInput;
			const downloadUrl = (isAudioOnly ? DOWNLOAD_AUDIO_URL_BASE : DOWNLOAD_VIDEO_URL_BASE) + jobId;

			sendToMW('log', { text: `⬇️ GET ${downloadUrl}` });
			await http.download(downloadUrl, opts.targetFilePath);

			sendToMW('log', { text: `✅ Saved: ${opts.targetFilePath}` });
			return true;
		} catch (err: any) {
			sendToMW('log', { text: `❌ Attempt ${attempt} failed: ${err.message}` });
			if (attempt >= MAX_ATTEMPTS) return false;
			sendToMW('log', { text: '🔁 Retrying...' });
			await new Promise((r) => setTimeout(r, 3000));
		}
	}
	return false;
}

async function pollDubbingStatus(jobId: number): Promise<{ is_audio_only?: boolean; status?: string }> {
	const statusUrl = `${STATUS_URL_BASE}${jobId}`;
	let lastStatus = '';
	while (true) {
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

		const res = await http.fetch(statusUrl, { headers: [['Accept', 'application/json']] });

		let statusData: any;
		try {
			statusData = JSON.parse(res.body);
		} catch {
			sendToMW('log', { text: `⚠️ Failed to parse status response, retrying...` });
			continue;
		}

		const status: string = (statusData.status || '').toLowerCase();
		if (status !== lastStatus) {
			sendToMW('log', { text: `🔄 Job [${jobId}] status: ${status || 'unknown'}` });
			lastStatus = status;
		}

		if (status === 'success' || status === 'completed' || status === 'done' || status === 'finished') {
			return statusData;
		}
		if (status === 'failure' || status === 'failed' || status === 'error') {
			throw new Error(`Job failed: ${statusData.error_message || statusData.error || 'Unknown error'}`);
		}
	}
}

async function getLanguagesMap(): Promise<LangMap> {
	if (languagesCache) return languagesCache;

	const res = await http.fetch(LANGUAGES_URL, { headers: [['Accept', 'application/json']] });
	if (!res.ok) throw new Error(`Languages fetch error ${res.status}`);

	let data: any;
	try {
		data = JSON.parse(res.body);
	} catch {
		throw new Error(`Invalid JSON from languages: ${res.body.slice(0, 200)}`);
	}

	const map: LangMap = {};
	for (const item of data.languages ?? []) {
		if (item?.name && item?.code) map[item.name] = item.code;
	}
	if (Object.keys(map).length === 0) throw new Error('Languages list is empty');
	languagesCache = map;
	return map;
}
