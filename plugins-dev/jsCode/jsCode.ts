// Нода jsCode — исполняет простой пользовательский JS один раз за вызов.
// Входы, добавленные в ноде через «+», прокидываются в код по имени-лейблу
// (динамические свойства в рантайме плоские, ключ = label — как в aeProcess).
// Код и логика исполнения общие с кнопкой ▶ Run в редакторе (src/Utils/runUserCode),
// поэтому тест в ноде и боевой прогон дают одинаковый результат.

import { runUserCode } from '../../src/Utils/runUserCode';
import defaultUi from './ui.json';


// Встроенные id из ui.json (code, inputs) — это НЕ пользовательские входы.
const DEFAULT_PROP_IDS = new Set<string>(((defaultUi as any)?.data?.properties ?? []).map((p: any) => p.id));

// Служебные поля, которые кладёт на _item сам пайплайн.
const SYSTEM_KEYS = new Set<string>([
	'id', 'nodeType', 'import', 'isTerminal', 'functionName', 'nodeLabel', 'pluginId', 'pluginVersion',
	'colorType', 'cost', 'costUnit', 'output', 'isValid', 'comment', 'label',
]);

const isUserParam = (key: string) => !DEFAULT_PROP_IDS.has(key) && !SYSTEM_KEYS.has(key);

export async function jsCodeFunc(_item: any, _description: any, ctx?: any) {
	const code: string = _item?.code ?? '';

	// Собираем scope так же, как фронтовый Run:
	const scope: Record<string, unknown> = {};
	// 1) литеральные динамические входы (TextEdit/Slider/NumberRange): _item[label]
	for (const key of Object.keys(_item ?? {})) {
		if (isUserParam(key)) scope[key] = _item[key];
	}
	// 2) коннектор-входы (Link) перекрывают литералы: _item.import[label] = массив выходов апстрима
	for (const key of Object.keys(_item?.import ?? {})) {
		if (isUserParam(key)) scope[key] = _item.import[key];
	}

	const res = await runUserCode(code, scope);

	// Прокидываем console.log/log() из кода в лог-окно.
	for (const line of res.logs) ctx?.log?.('info', line);

	if (!res.ok) {
		ctx?.log?.('error', `jsCode: ${res.error ?? 'unknown error'}`);
		throw new Error(res.error ?? 'jsCode execution failed');
	}

	// Возврат нормализуется хартнессом в массив, если это не массив.
	return res.result;
}
