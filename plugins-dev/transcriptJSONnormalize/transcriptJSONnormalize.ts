import { fs, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';
import { parseTranscript, buildSentences } from '../../src/Utils/whisperTranscript';
import path from 'path';

export { onLoad } from '../_template/tauri';

// ── Transcript JSON normalize ──────────────────────────────────────────────────────
// Облегчает пословный jsonFull whisper (--output-json-full --max-len 1) в сигнальный вид:
//   { lang, dur, words?, sentences }
// • words     — тяжёлый пословный слой (тайминги для снапа границ реза/караоке); по чекбоксу.
// • sentences — предложения (maxLineLength=0) либо титр-блоки с \r-переносами под текстовый
//               слой After Effects (maxLineLength>0). Всегда присутствуют.
// В режиме «без words» из предложений убираем указатель w (ссылаться не на что).
// Разбор/сборка — в src/Utils/whisperTranscript.ts (bundled esbuild'ом). transcribeVA не трогаем.

export async function transcriptJSONnormalizeFunc(_item: any, _description: any, _ctx?: any): Promise<string[]> {
	const finalFiles: string[] = [];

	const includeWords = !(_item.words === false || _item.words === 'false');
	const maxLineLength = Math.max(0, Number(_item.maxLineLength) || 0);
	const maxLine = (() => {
		const v = Number(_item.maxLine);
		return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
	})();

	const inputFiles: string[] = _item.import?.inputFile ?? [];
	if (!inputFiles.length) {
		sendToMW('log', { level: 'warn', text: '[normalize] нет входных файлов' });
		return [];
	}

	// Путь вывода: как в transcribeVA — targetPath перекрывает, иначе стандартная структура.
	const curPath: string[] = _item.targetPath?.length > 0 ? [..._item.targetPath] : ['$clearName (normalized)'];
	if (_item.import?.targetPath) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	let iteration = 1;
	for (const fileFrom of inputFiles) {
		if (path.extname(fileFrom).toLowerCase() !== '.json') {
			sendToMW('log', { level: 'warn', text: `[normalize] пропуск (не .json): ${fileFrom}` });
			continue;
		}

		let raw: string;
		try {
			raw = await fs.read(fileFrom);
		} catch (e: any) {
			sendToMW('log', { level: 'error', text: `[normalize] не читается ${fileFrom}: ${e?.message ?? String(e)}` });
			continue;
		}

		let lang: string | null;
		let dur: number;
		let words: ReturnType<typeof parseTranscript>['words'];
		try {
			({ lang, dur, words } = parseTranscript(raw));
		} catch (e: any) {
			sendToMW('log', { level: 'error', text: `[normalize] битый JSON ${fileFrom}: ${e?.message ?? String(e)}` });
			continue;
		}
		if (!words.length) {
			sendToMW('log', { level: 'warn', text: `[normalize] ни одного слова не извлечено: ${fileFrom}` });
			continue;
		}

		const sentences = buildSentences(words, { maxLineLength, maxLine });

		const out: Record<string, any> = { lang, dur };
		if (includeWords) {
			out.words = words;
			out.sentences = sentences;
		} else {
			// без слоя words указатель w повисает — убираем.
			out.sentences = sentences.map(({ w, ...rest }) => rest);
		}

		let fileTo: string;
		try {
			fileTo = createPathForFileByPattern(curPath, _description, fileFrom);
		} catch {
			const base = path.basename(fileFrom, path.extname(fileFrom));
			fileTo = path.join(path.dirname(fileFrom), `${base} (normalized).json`);
		}
		if (inputFiles.length > 1) {
			const ext = path.extname(fileTo);
			const base = path.basename(fileTo, ext);
			fileTo = path.join(path.dirname(fileTo), `${base}_${iteration}${ext}`);
			iteration++;
		}

		try {
			await fs.mkdir(path.dirname(fileTo));
			await fs.write(fileTo, JSON.stringify(out, null, 2));
			sendToMW('log', {
				text: `[normalize] ${path.basename(fileFrom)} → ${words.length} слов, ${sentences.length} предложений (words: ${includeWords ? 'on' : 'off'}) → ${fileTo}`,
			});
			finalFiles.push(fileTo);
		} catch (e: any) {
			sendToMW('log', { level: 'error', text: `[normalize] не записать ${fileTo}: ${e?.message ?? String(e)}` });
		}
	}

	return finalFiles;
}
