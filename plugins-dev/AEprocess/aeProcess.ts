// aeProcess — запускает JSX-скрипт в After Effects, ждёт результат через
// файловую "договорённость" (lock + result.json). Tauri-port: вся механика
// (build script, launch AE, poll result file) перенесена в Rust-команду
// run_script_in_ae — здесь только формируем args.

import path from 'path';
import type { PluginContext } from '../../src/PluginAPI/host';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';
// Дефолтный (встроенный) набор свойств ноды. esbuild инлайнит этот json в бандл.
// Всё, что юзер добавил через «+», в этом наборе отсутствует → это его параметры.
import defaultUi from './ui.json';


export async function aeProcess(_item: any, _description: any, ctx: PluginContext): Promise<any[]> {
	const { fs, ae, sendToMW } = ctx;
	let finalFile: any[] = [];

	let curPath: string[] = _item.targetPath.length === 0 ? ['$clearName ($random(3))'] : [..._item.targetPath];
	if (_item.import.targetPath?.length) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	const fileForName = _description.pathForDelete;
	const fileTo = createPathForFileByPattern(curPath, _description, fileForName);

	await fs.mkdir(path.dirname(fileTo));

	sendToMW('statusbar', { text: `${_description.infoText}: [AE process]\n ${_description.curItem}` });

	// Источник скрипта. Импорт перебивает ручной выбор в ноде:
	//   • _item.import.aeScript — путь, пришедший по соединению (массив);
	//   • _item.aeScript        — выбранный прямо в ноде pathNavigator'ом.
	const importedScript: string | undefined = _item.import?.aeScript?.[0];
	const pickedScript: string = typeof _item.aeScript === 'string' ? _item.aeScript : '';
	const rawScript = (importedScript || pickedScript || '').trim();
	if (!rawScript) {
		throw new Error('[aeProcess] AE-скрипт не задан — выбери файл в ноде или подай его на вход «AE script»');
	}
	// Абсолютный путь («Custom File...» / импорт) берём как есть; относительный
	// (листание папок в навигаторе) — от корня проекта на GD: pathNavigator листает
	// именно projectPathGD.
	const aeScript: string = path.isAbsolute(rawScript) ? rawScript : path.join(_description.projectPathGD, rawScript);
	if (!(await fs.existsFile(aeScript))) {
		throw new Error(`[aeProcess] AE-скрипт не найден: "${aeScript}"`);
	}

	const aePath: string = _description.programmPath?.afterEffect?.[0];
	if (!aePath) {
		throw new Error('[aeProcess] description.programmPath.afterEffect не указан — пропиши путь до After Effects в настройках');
	}

	// aeInput — все ПОЛЬЗОВАТЕЛЬСКИЕ входы/параметры ноды, по их лейблам. Юзер добавляет
	// их через «+» (Input files): файловые входы (Link) и значения (valueRange/timecode/
	// slider). В `_item` они лежат так:
	//   • прямое значение свойства   → _item[label]        (valueRange = [min,max] и т.п.);
	//   • пришедшее по коннектору     → _item.import[label] (массив путей).
	//
	// Что НЕ пускаем в aeInput:
	//   • дефолтные свойства ноды — берём их id прямо из ui.json (aeScript/targetPath/
	//     operation/maxWaitTime); они обрабатываются отдельно. Добавишь встроенное свойство
	//     в ui.json — оно исключится автоматически, править этот список не нужно;
	//   • служебные поля execObj/ноды (их кладёт processing-слой, не плагин).
	const DEFAULT_PROP_IDS = new Set<string>(((defaultUi as any)?.data?.properties ?? []).map((p: any) => p.id));
	const AE_SYSTEM_KEYS = new Set<string>([
		'id', 'nodeType', 'import', 'isTerminal', 'functionName',
		'nodeLabel', 'pluginId', 'pluginVersion', 'colorType', 'cost', 'costUnit',
	]);
	const isUserParam = (key: string) => !DEFAULT_PROP_IDS.has(key) && !AE_SYSTEM_KEYS.has(key);

	const aeInput: Record<string, any> = {};
	// 1) Прямые значения, заданные прямо в ноде (valueRange, timecode, slider, …).
	for (const key of Object.keys(_item)) {
		if (isUserParam(key)) aeInput[key] = _item[key];
	}
	// 2) Файловые входы по коннекторам перебивают прямое значение: в _item[label] лежит
	//    accepted-тип (напр. ["video"]), а реальный путь приходит в _item.import[label].
	for (const key of Object.keys(_item.import ?? {})) {
		if (isUserParam(key)) aeInput[key] = _item.import[key];
	}

	// inObj — что попадёт в JSX как `var inObj = {...}`. Берём ТОЛЬКО нужные поля
	// (whitelist) из description+item, плюс собранный aeInput. Всё остальное служебное
	// в скрипт не уходит. Поле добавляешь сюда — оно появляется в скрипте.
	const ALLOW: string[] = [
		'clearName',
		'curItem',
		'findTime',
		'localFolder',
		'mainFolderName',
		'mainFolderPath',
		'mainWorkFolder',
		'pathForDelete',
		'projectPathGD',
		'typeOfFile',
		'year',
	];
	const source: Record<string, any> = { ..._description, ..._item };
	const inObj: Record<string, any> = {};
	for (const key of ALLOW) {
		if (key in source) inObj[key] = source[key];
	}
	inObj.aeInput = aeInput;
	// targetPath — РЕЗОЛВНУТЫЙ полный путь вывода (маски вроде $fileName уже раскрыты),
	// это тот же fileTo. В его папке лежит временный скрипт; этот путь удобно
	// использовать для финального рендера. НЕ берём из whitelist — там сырой паттерн.
	inObj.targetPath = fileTo;

	// То, что РЕАЛЬНО уходит в скрипт. Печатаем в logwin как JSON — копируешь объект
	// в jsx/_playground/playground.js (поле inObj) и отлаживаешь скрипт локально через
	// ExtendScript Debugger (см. jsx/_playground/playground.js).
	sendToMW('log', { level: 'info', text: `[aeProcess] inObj → ${aeScript}\n${JSON.stringify(inObj, null, 2)}` });

	// Макс. время ожидания AE (НЕ время рендера — лимит «зависания», timecode-контрол
	// хранит секунды). Можно подать timecode-узлом на вход. Дефолт — 10 минут.
	const DEFAULT_MAX_WAIT_SEC = 600;
	const importMaxWait = Array.isArray(_item.import?.maxWaitTime) ? _item.import.maxWaitTime[0] : undefined;
	let maxWaitSec = toSeconds(importMaxWait) || toSeconds(_item.maxWaitTime);
	if (!Number.isFinite(maxWaitSec) || maxWaitSec <= 0) maxWaitSec = DEFAULT_MAX_WAIT_SEC;

	// Временный скрипт с подставленными параметрами кладём РЯДОМ с финальным файлом
	// (в папку target) и НЕ удаляем — чтобы можно было открыть и посмотреть, что
	// реально ушло в AE. Имя — ae_<uid>.jsx (уникальное, Rust). lock/result-файлы
	// удаляются сами (lock снимает сам скрипт, result — Rust после чтения).
	const tempScriptDir = path.dirname(fileTo);
	sendToMW('log', {
		level: 'info',
		text: `[aeProcess] запуск AE\n  скрипт: ${aeScript}\n  temp/output dir: ${tempScriptDir}\n  таймаут: ${Math.round(maxWaitSec / 60)} мин (${Math.round(maxWaitSec)} c)`,
	});

	// Дефолт true, если галку не трогали (в старых сохранённых пайплайнах поля не будет).
	const killPreviousAE = _item.killPreviousAE !== false;

	const result = await ae.runScript({
		aePath,
		scriptPath: aeScript,
		inObj,
		tempDir: tempScriptDir,
		keepTempFiles: true,
		timeoutSec: Math.round(maxWaitSec),
		killPreviousInstance: killPreviousAE,
	});

	if (result.success) {
		finalFile = Array.isArray(result.data) ? result.data : [result.data];
		if (result.temp_script_path) {
			sendToMW('log', { level: 'info', text: `[aeProcess] временный скрипт сохранён: ${result.temp_script_path}` });
		}
	} else {
		console.error('Ошибка AE:', result.error);
		sendToMW('log', { level: 'error', text: `[aeProcess] AE error: ${result.error}` });
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}

/** Таймкод → секунды. Принимает число (уже секунды), "HH:MM:SS", "MM:SS" или число строкой. */
function toSeconds(v: any): number {
	if (v == null) return 0;
	if (typeof v === 'number') return v;
	const s = String(v).trim();
	const m = s.match(/^(\d+):(\d{2}):(\d{2})$/) || s.match(/^(\d+):(\d{2})$/);
	if (m) {
		const p = m.slice(1).map(Number);
		return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
	}
	const n = parseFloat(s.replace(',', '.'));
	return Number.isFinite(n) ? n : 0;
}
