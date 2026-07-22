// AIcomfyUI — отправка workflow на ComfyUI-сервер (https://x.kraslance.ru),
// polling статуса и скачивание outputs.
// HTTP-запросы выполняются через Rust (http_fetch / http_upload / http_download) — нет CORS.

import path from 'path';
import { fs, http, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';
import { formatNameByPattern } from '../../src/Utils/formatNameByPattern';

export { onLoad } from '../_template/tauri';

const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 10000;

let _userCancelled = false;
function checkUserCancelled(): boolean {
	return _userCancelled;
}
function resetCancelFlag() {
	_userCancelled = false;
}

function getMimeType(filename: string): string {
	const ext = path.extname(filename).toLowerCase();
	const map: Record<string, string> = {
		'.mp3': 'audio/mpeg',
		'.wav': 'audio/wav',
		'.ogg': 'audio/ogg',
		'.flac': 'audio/flac',
		'.m4a': 'audio/mp4',
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.webp': 'image/webp',
		'.gif': 'image/gif',
		'.mp4': 'video/mp4',
		'.webm': 'video/webm',
		'.mov': 'video/quicktime',
	};
	return map[ext] ?? 'application/octet-stream';
}

const FILE_TYPE_SUFFIXES = new Set(['video', 'image', 'audio', 'latent']);

export async function AIcomfyUIFunc(_item: any, _description: any): Promise<any[]> {
	let finalFile: any[] = [];
	resetCancelFlag();

	const localTargetPath: string[] = Array.isArray(_item.targetPath) ? _item.targetPath : [];
	let curPath = localTargetPath.length === 0 ? ['$clearName ($random(3))'] : [...localTargetPath];
	if (_item.import?.targetPath?.length > 0) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	const pathForDelete = typeof _item.description?.pathForDelete === 'string' ? _item.description?.pathForDelete : 'workflow.json';
	const targetFilePath = createPathForFileByPattern(curPath, _description, pathForDelete);
	const targetDir = path.dirname(targetFilePath);

	// Путь (папку) резолвим один раз выше. Само ИМЯ файла — последний чип маски —
	// раскрываем отдельно на КАЖДЫЙ пришедший от сервера файл (в downloadOutputs),
	// подставляя серверное имя в `file`. Так file-маски ($fileName / $clearFileName /
	// $index) считаются от РЕЗУЛЬТАТА обработки, а не от несуществующего входного файла,
	// а description-маски ($clearName / $id / $findTime) — от исходно найденного элемента.
	const namePattern = curPath[curPath.length - 1] ?? '$clearName';

	sendToMW('statusbar', { text: `${_description.infoText}: [ComfyUI Request]\n ${_description.curItem}` });

	// ── Workflow JSON ─────────────────────────────────────────────────────────
	const jsonPath: string = typeof _item.jsonPath === 'string' ? _item.jsonPath.trim() : '';
	if (!jsonPath) throw new Error('jsonPath is empty — укажи путь до workflow.json');

	const workflowFilePath = path.isAbsolute(jsonPath) ? jsonPath : path.join(_description.projectPathGD, ...jsonPath.split('/').filter(Boolean));

	if (!(await fs.existsFile(workflowFilePath))) {
		throw new Error(`Workflow JSON не найден: ${workflowFilePath}`);
	}
	const workflowJson = JSON.parse(await fs.read(workflowFilePath));

	// ── Overrides + file inputs ───────────────────────────────────────────────
	const inputFiles: { path: string; filename: string; nodeId: string; fieldName: string }[] = [];
	const overrides: Record<string, Record<string, any>> = {};
	const importData: Record<string, any[]> = _item.import ?? {};

	for (const [key, values] of Object.entries(importData)) {
		const navValue: string = typeof _item[key] === 'string' ? _item[key] : '';
		if (!navValue) continue;

		const colonIdx = navValue.lastIndexOf(':');
		const keysStr = colonIdx !== -1 ? navValue.slice(0, colonIdx) : navValue;
		const typeSuffix = colonIdx !== -1 ? navValue.slice(colonIdx + 1).toLowerCase() : '';
		const jsonKeys = keysStr.split('.').filter(Boolean);

		if (jsonKeys.length < 3 || jsonKeys[1] !== 'inputs') {
			sendToMW('log', { text: `⚠️ Пропущен "${key}": путь не в API-формате (nodeId.inputs.field)` });
			continue;
		}
		const nodeId = jsonKeys[0];
		const fieldName = jsonKeys[jsonKeys.length - 1];

		const valueArray = Array.isArray(values) ? values : [values];
		if (!valueArray.length) continue;
		const rawValue = valueArray[0];
		if (rawValue == null) continue;

		let resolvedFilePath: string | null = null;
		if (typeof rawValue === 'string') {
			if (await fs.existsFile(rawValue)) {
				resolvedFilePath = rawValue;
			} else if (!path.isAbsolute(rawValue)) {
				const abs = path.join(_description.projectPathGD, rawValue);
				if (await fs.existsFile(abs)) resolvedFilePath = abs;
			}
			if (!resolvedFilePath && FILE_TYPE_SUFFIXES.has(typeSuffix)) {
				sendToMW('log', { text: `⚠️ Файл не найден: ${rawValue}` });
			}
		}

		if (resolvedFilePath) {
			const filename = path.basename(resolvedFilePath);
			inputFiles.push({ path: resolvedFilePath, filename, nodeId, fieldName });
			if (!overrides[nodeId]) overrides[nodeId] = {};
			overrides[nodeId][fieldName] = filename;
			sendToMW('log', { text: `📁 File [${nodeId}.${fieldName}] = ${filename}` });
		} else {
			let value: any = rawValue;
			if (typeSuffix === 'number' || typeSuffix === 'float' || typeSuffix === 'int') {
				const num = Number(rawValue);
				value = isNaN(num) ? rawValue : num;
			} else if (typeSuffix === 'boolean') {
				value = rawValue === 'true' || rawValue === true;
			} else {
				value = String(rawValue);
			}
			if (!overrides[nodeId]) overrides[nodeId] = {};
			overrides[nodeId][fieldName] = value;
			sendToMW('log', { text: `📝 Override [${nodeId}.${fieldName}] = ${JSON.stringify(value)}` });
		}
	}

	sendToMW('log', { text: `📎 Input files: [${inputFiles.map((f) => f.filename).join(', ') || 'none'}]` });

	const serverUrl = 'https://x.kraslance.ru/v2/run';
	const serverToken = 'Bearer test-token';
	const baseUrl = new URL(serverUrl).origin;

	const result = await sendToComfyAsync({
		baseUrl,
		serverToken,
		workflowJson,
		inputFiles,
		overrides,
		targetDir,
		namePattern,
		description: _description,
	});

	if (result) finalFile.push(...result);
	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}

async function sendToComfyAsync(opts: {
	baseUrl: string;
	serverToken: string;
	workflowJson: any;
	inputFiles: { path: string; filename: string; nodeId: string; fieldName: string }[];
	overrides: Record<string, Record<string, any>>;
	targetDir: string;
	namePattern: string;
	description: any;
}): Promise<string[] | null> {
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			sendToMW('log', { text: `🚀 ComfyUI attempt ${attempt}/${MAX_ATTEMPTS}` });

			// Текстовые поля
			const fields = [
				{ field: 'workflow_json', value: JSON.stringify(opts.workflowJson) },
				{ field: 'timeout_sec', value: '0' },
			];
			if (Object.keys(opts.overrides).length > 0) {
				fields.push({ field: 'overrides_json', value: JSON.stringify(opts.overrides) });
			}

			// Файловые части
			const files = opts.inputFiles.map((f) => ({
				field: 'input_files',
				path: f.path,
				mime: getMimeType(f.filename),
				filename: f.filename,
			}));

			const headers: [string, string][] = [];
			if (opts.serverToken) headers.push(['Authorization', opts.serverToken]);

			sendToMW('log', { text: `📨 POST ${opts.baseUrl}/v2/run` });

			const res = await http.upload(`${opts.baseUrl}/v2/run`, { files, fields, headers });

			if (res.status !== 202) {
				throw new Error(`POST /v2/run failed (${res.status}): ${res.body}`);
			}

			const enqueue: any = JSON.parse(res.body);
			const jobId: string = enqueue.job_id;
			const statusUrl: string | null = enqueue.status_url || null;

			sendToMW('log', { text: `📦 Job accepted: ${jobId} (status: ${enqueue.status}, status_url: ${statusUrl || 'n/a'})` });

			return await pollAndDownload({
				jobId,
				statusUrl,
				baseUrl: opts.baseUrl,
				serverToken: opts.serverToken,
				targetDir: opts.targetDir,
				namePattern: opts.namePattern,
				description: opts.description,
				infoText: opts.description?.infoText,
				curItem: opts.description?.curItem,
			});
		} catch (err: any) {
			sendToMW('log', { text: `❌ Attempt ${attempt} failed: ${err.message}` });
			if (attempt >= MAX_ATTEMPTS) return null;
			sendToMW('log', { text: '🔁 Retrying in 5s…' });
			await new Promise((r) => setTimeout(r, 5000));
		}
	}
	return null;
}

async function pollAndDownload(opts: {
	jobId: string;
	statusUrl: string | null;
	baseUrl: string;
	serverToken: string;
	targetDir: string;
	namePattern: string;
	description: any;
	infoText?: string;
	curItem?: string;
}): Promise<string[]> {
	const statusPath = opts.statusUrl && opts.statusUrl.startsWith('/') ? opts.statusUrl : `/v2/jobs/${opts.jobId}`;
	const statusFullUrl = `${opts.baseUrl}${statusPath}`;

	const authHeaders: [string, string][] = opts.serverToken ? [['Authorization', opts.serverToken]] : [];
	const statusLabel = opts.infoText ? `${opts.infoText}: [ComfyUI]` : 'ComfyUI';
	const itemLabel = opts.curItem || '';

	sendToMW('log', { text: `🔍 Polling: ${statusFullUrl}` });

	let lastStatus = '';
	while (true) {
		if (checkUserCancelled()) {
			sendToMW('log', { text: `🛑 User cancelled job [${opts.jobId}]` });
			throw new Error(`Job ${opts.jobId} cancelled by user`);
		}

		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

		const statusRes = await http.fetch(statusFullUrl, { headers: authHeaders });
		if (!statusRes.ok) throw new Error(`GET ${statusPath} failed: ${statusRes.status}`);

		let statusData: any;
		try {
			statusData = JSON.parse(statusRes.body);
		} catch {
			sendToMW('log', { text: `⚠️ Failed to parse status response, retrying...` });
			continue;
		}

		const status: string = (statusData.status || '').toLowerCase();
		const progress: number = statusData.progress ?? 0;

		sendToMW('statusbar', { text: `${statusLabel}\n${itemLabel} — ${progress}%` });
		if (status !== lastStatus) {
			sendToMW('log', { text: `🔄 Job [${opts.jobId}] status: ${status} (${progress}%)` });
			lastStatus = status;
		}

		if (status === 'done') {
			sendToMW('log', { text: `📋 Full status response:\n${JSON.stringify(statusData, null, 2)}` });
			return await downloadOutputs(statusData.outputs, opts.targetDir, opts.namePattern, opts.baseUrl, authHeaders, opts.description);
		}
		if (status === 'failed' || status === 'error' || status === 'cancelled') {
			throw new Error(`Job ${opts.jobId} failed: ${statusData.error || 'Unknown error'}`);
		}
	}
}

async function downloadOutputs(
	outputs: Array<{ url: string; filename: string; output_type: string }>,
	targetDir: string,
	namePattern: string,
	baseUrl: string,
	headers: [string, string][],
	description: any,
): Promise<string[]> {
	const results: string[] = [];
	await fs.mkdir(targetDir);

	const usedNames = new Set<string>();
	// Список пришедших имён — для $index (позиция файла среди результатов).
	const serverNames = outputs.map((o) => o.filename);

	for (let i = 0; i < outputs.length; i++) {
		const output = outputs[i];
		const fileUrl = output.url.startsWith('http') ? output.url : `${baseUrl}${output.url}`;
		const serverExt = path.extname(output.filename);

		// Раскрываем имя-чип для КОНКРЕТНОГО серверного файла:
		//   $fileName → серверное имя как есть, $clearFileName → почищенное,
		//   $index → номер файла, $clearName/$id/$findTime → от исходно найденного элемента.
		const perFileDesc = { ...description, finalFile: serverNames };
		const resolved = formatNameByPattern({ string: namePattern, description: perFileDesc, file: output.filename }).trim();
		const base = path.basename(resolved || path.basename(output.filename, serverExt));

		let fileName = `${base}${serverExt}`;
		let dup = 1;
		while (usedNames.has(fileName)) {
			fileName = `${base}_${dup}${serverExt}`;
			dup++;
		}
		usedNames.add(fileName);

		const targetPath = path.join(targetDir, fileName);

		sendToMW('log', { text: `⬇️ Downloading: ${output.filename} → ${fileName}` });
		sendToMW('log', { text: `   URL: ${fileUrl}` });

		const startTime = Date.now();
		await http.download(fileUrl, targetPath, { headers });
		const stat = await fs.stat(targetPath);
		const size = stat.size;
		const durationMs = Date.now() - startTime;

		sendToMW('log', {
			text: `✅ Saved (${(size / 1024 / 1024).toFixed(2)} MB in ${(durationMs / 1000).toFixed(1)}s): ${targetPath}`,
		});
		results.push(targetPath);
	}

	return results;
}
