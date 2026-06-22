// ─────────────────────────────────────────────────────────────────────────────
// Types & Constants for PluginBuilder
// ─────────────────────────────────────────────────────────────────────────────

import { PatternKeys } from '@/types/searchType';

// ── Cost ─────────────────────────────────────────────────────────────────────

export type CostUnit = 'HH' | 'MM' | 'ss' | 'run' | 'fromSite';
export const COST_UNITS: CostUnit[] = ['HH', 'MM', 'ss', 'run', 'fromSite'];

// ── Plugin JSON ──────────────────────────────────────────────────────────────

export interface PluginJsonData {
	id: string;
	name: string;
	version: string;
	apiVersion: number;
	type: string[];
	description: string;
	main: string;
	ui: string;
	external: string[];
	cost: string;
	costUnit: CostUnit;
	/** Ресурсный пул. '' / отсутствует = дефолт по colorType. */
	resourcePool?: ResourcePool;
}

export type ResourcePool = '' | 'local' | 'online' | 'ffmpeg' | 'helpers';
export const RESOURCE_POOLS: ResourcePool[] = ['', 'local', 'online', 'ffmpeg', 'helpers'];

// ── UI JSON ──────────────────────────────────────────────────────────────────

export interface UiPropertyData {
	id: string;
	controlType: string;
	controlProps: Record<string, any>;
	isInput?: boolean;
	acceptedTypes?: string[];
	outputType?: string;
	outputMarker?: string;
	required?: boolean;
	outputTypeMap?: Record<string, string>;
}

export interface UiJsonData {
	type: string;
	position: { x: number; y: number };
	width: number;
	height: number;
	data: {
		label: string;
		colorType: string;
		comment: string;
		properties: UiPropertyData[];
		output?: { sourceProperty: string };
		isValid: boolean;
	};
}

// ── Constants ────────────────────────────────────────────────────────────────

export const OUTPUT_TYPES = ['array', 'path', 'boolean', 'accepted', 'string', 'timecode', 'typeByExtension', 'audio'];

// ⚠️ При добавлении нового #tag — также добавить его резолвер
// в src/NODE_WIN/hooks/useResolveOptions.ts (switch/case)
export const HASH_OPTIONS = [
	{ value: '#pathPattern', desc: 'Все паттерны путей ($keys)' },
	{ value: '#filePattern', desc: 'То же что #pathPattern' },
	{ value: '#typeOfFile', desc: 'Типы файлов из настроек' },
	{ value: '#folders', desc: 'Папки в текущем проекте' },
	{ value: '#whisperModels', desc: 'Модели Whisper' },
	{ value: '#vkAccounts', desc: 'Аккаунты VK для текущей главной папки' },
	{ value: '#vkGroups', desc: 'Админ-сообщества VK выбранного аккаунта' },
	{ value: '#recursiveFF', desc: 'Рекурсивный выбор файла/папки' },
	{ value: '#historyValue', desc: 'История введённых значений (по id свойства)' },
	{ value: '#historyValue(key)', desc: 'История введённых значений по произвольному ключу (shared между свойствами)' },
];

export const PATTERN_OPTIONS = Object.values(PatternKeys).map((k) => `$${k}`);
export const SPECIAL_OPTIONS = ['CustomFolder...', 'CustomFile...'];

// ── Control Type Registry ────────────────────────────────────────────────────
// Single source of truth for all sidebar-available control types.
// To add a new component: append one entry here — sidebar + colors update automatically.
// NOTE: loop is intentionally excluded (not user-droppable).

export interface ControlTypeConfig {
	controlType: string;
	label: string;
	color: string;
	defaultProps: Omit<UiPropertyData, 'id'>;
}

export const CONTROL_TYPE_REGISTRY: ControlTypeConfig[] = [
	{
		controlType: 'link',
		label: 'Link',
		color: '#4fc3f7',
		defaultProps: {
			controlType: 'link',
			controlProps: { label: 'Input File', tooltip: '', value: '' },
			isInput: true,
			acceptedTypes: ['video'],
			outputType: 'accepted',
			required: true,
		},
	},
	{
		controlType: 'autocomplete',
		label: 'Autocomplete',
		color: '#81c784',
		defaultProps: {
			controlType: 'autocomplete',
			controlProps: {
				label: 'Target Path',
				tooltip: '',
				options: ['#pathPattern', 'CustomFolder...'],
				multiSelect: true,
				allowDuplicates: true,
				value: [],
			},
			isInput: false,
			outputType: 'path',
			required: false,
		},
	},
	{
		controlType: 'ddm',
		label: 'Dropdown (DDM)',
		color: '#ffb74d',
		defaultProps: {
			controlType: 'ddm',
			controlProps: {
				label: 'Select Option',
				tooltip: '',
				options: ['option1', 'option2'],
				freeInput: false,
				value: 'option1',
			},
			outputType: 'typeByExtension',
			required: true,
		},
	},
	{
		controlType: 'checkbox',
		label: 'Checkbox',
		color: '#ce93d8',
		defaultProps: {
			controlType: 'checkbox',
			controlProps: { label: 'Enable', tooltip: '', value: false },
			outputType: 'boolean',
			required: false,
		},
	},
	{
		controlType: 'slider',
		label: 'Slider',
		color: '#80cbc4',
		defaultProps: {
			controlType: 'slider',
			controlProps: {
				label: 'Value',
				tooltip: '',
				value: 50,
				minValue: 0,
				maxValue: 100,
				step: 1,
				isTextInput: false,
				minMaxValueVisible: true,
			},
			outputType: 'string',
			required: false,
		},
	},
	{
		controlType: 'timecode',
		label: 'Timecode',
		color: '#fff176',
		defaultProps: {
			controlType: 'timecode',
			controlProps: { label: 'Timecode', tooltip: '', value: 0 },
			outputType: 'timecode',
			required: false,
		},
	},
	{
		controlType: 'valueRange',
		label: 'Value Range',
		color: '#5181b8',
		defaultProps: {
			controlType: 'valueRange',
			controlProps: {
				label: 'Time window',
				tooltip: '',
				value: [0, 1440],
				format: 'timecode',
				unit: 'minutes',
				step: 5,
				range: [0, 1440],
				decimals: 2,
				allowManualOverride: true,
			},
			outputType: 'array',
			required: false,
		},
	},
	{
		controlType: 'textedit',
		label: 'TextEdit',
		color: '#f48fb1',
		defaultProps: {
			controlType: 'textedit',
			controlProps: { label: 'Text', tooltip: '', value: '', language: 'plaintext' },
			outputType: 'string',
			required: false,
		},
	},
	{
		controlType: 'pathNavigator',
		label: 'PathNavigator',
		color: '#90caf9',
		defaultProps: {
			controlType: 'pathNavigator',
			controlProps: { label: 'Path', tooltip: '', value: '' },
			outputType: 'path',
			required: false,
		},
	},
	{
		controlType: 'jsonNavigator',
		label: 'JsonNavigator',
		color: '#a5d6a7',
		defaultProps: {
			controlType: 'jsonNavigator',
			controlProps: { label: 'JSON Path', tooltip: '', value: '', jsonSourcePropertyId: '' },
			outputType: 'string',
			required: false,
		},
	},
	{
		controlType: 'addPathLink',
		label: 'Add Path Link',
		color: '#4dd0e1',
		defaultProps: {
			controlType: 'addPathLink',
			controlProps: { label: 'Add JSON Path', tooltip: '', value: [] },
			outputType: 'string',
			required: false,
		},
	},
	{
		controlType: 'addLink',
		label: 'Add Link',
		color: '#f48fb1',
		defaultProps: {
			controlType: 'addLink',
			controlProps: { label: 'Add Link', tooltip: '', value: [] },
			outputType: 'string',
			required: false,
		},
	},
	{
		controlType: 'overlaySettings',
		label: 'Overlay Settings',
		color: '#ffcc80',
		defaultProps: {
			controlType: 'overlaySettings',
			controlProps: { label: 'Overlay Settings', tooltip: '', value: '' },
			outputType: 'string',
			required: false,
		},
	},
	{
		controlType: 'videoAdjustment',
		label: 'Video Adjustment',
		color: '#ef9a9a',
		defaultProps: {
			controlType: 'videoAdjustment',
			controlProps: { label: 'Video Adjustment', tooltip: '', value: '' },
			outputType: 'string',
			required: false,
		},
	},
	{
		controlType: 'titleSettings',
		label: 'Title Settings',
		color: '#b39ddb',
		defaultProps: {
			controlType: 'titleSettings',
			controlProps: { label: 'Title Settings', tooltip: '', value: '' },
			outputType: 'string',
			required: false,
		},
	},
	{
		controlType: 'keyingFFmpeg',
		label: 'Keying (FFmpeg)',
		color: '#61df6d',
		defaultProps: {
			controlType: 'keying',
			controlProps: { label: 'Keying (FFmpeg)', tooltip: '', value: '' },
			outputType: 'string',
			required: false,
		},
	},
	{
		controlType: 'convertSettings',
		label: 'Convert (FFmpeg)',
		color: '#61a4df',
		defaultProps: {
			controlType: 'convertSettings',
			controlProps: { label: 'Convert Settings', tooltip: '', value: '' },
			outputType: 'typeByExtension',
			required: false,
		},
	},
];

// Derived constants — kept for backward compatibility with existing consumers.
export const CONTROL_TYPES_LIST = CONTROL_TYPE_REGISTRY.map(({ controlType, label }) => ({ controlType, label }));

export const CONTROL_TYPE_COLORS: Record<string, string> = Object.fromEntries(
	CONTROL_TYPE_REGISTRY.map(({ controlType, color }) => [controlType, color]),
);

export const TEXT_EDIT_LANGUAGES = ['plaintext', 'javascript', 'typescript', 'json', 'python'];

// ── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_PLUGIN_JSON: PluginJsonData = {
	id: 'pluginId',
	name: 'Plugin Name',
	version: '0.1',
	apiVersion: 1,
	type: ['nodeui', 'processing'],
	description: 'Plugin description',
	main: 'pluginId.js',
	ui: 'ui.json',
	external: [],
	cost: '0',
	costUnit: 'run',
};

export function normalizeUiJson(raw: unknown): UiJsonData {
	const defaults = makeDefaultUiJson();
	const r = (raw as any) ?? {};
	const rd = r.data ?? {};
	return {
		type: r.type ?? defaults.type,
		position: r.position ?? defaults.position,
		width: r.width ?? defaults.width,
		height: r.height ?? defaults.height,
		data: {
			label: rd.label ?? defaults.data.label,
			colorType: rd.colorType ?? defaults.data.colorType,
			comment: rd.comment ?? defaults.data.comment,
			properties: Array.isArray(rd.properties) ? rd.properties : defaults.data.properties,
			output: rd.output,
			isValid: rd.isValid ?? defaults.data.isValid,
		},
	};
}

export function makeDefaultUiJson(): UiJsonData {
	return {
		type: 'pluginId',
		position: { x: 0, y: 0 },
		width: 380,
		height: 400,
		data: {
			label: 'Plugin Name',
			colorType: 'default',
			comment: '',
			properties: [
				{
					id: 'inputFile',
					controlType: 'link',
					controlProps: { label: 'Input File', tooltip: 'Input File', value: '' },
					isInput: true,
					acceptedTypes: ['video', 'audio'],
					outputType: 'accepted',
					required: true,
				},
				{
					id: 'targetPath',
					controlType: 'autocomplete',
					controlProps: {
						label: 'Target Path',
						tooltip:
							'Папка для сохранения. Указывается в виде маски. все маски начинаются с $.<br><div><font color="#ffff00">$clearName</font> - чистое имя найденного элемента в папке IN на GD без <font color="#ffff00">эмоджиков</font> и кавычек () []</div><div><font color="#ffff00">$findTime</font> - время когда был найден элемент в папке IN</div><div><font color="#ffff00">$curItemName</font> - текущий элемент в папке IN (с эмоджиками и кавычками). это может быть папка. но без расширения</div><div><font color="#ffff00">$id</font> - уникальный id для каждого элемента если он есть в имени найденного элемента в папке IN</div><div><font color="#ffff00">$projectName</font> - название проекта (имя папки в которой находится папка IN)</div><div><font color="#ffff00">$projectPathGD</font> - полный путь до папки проекта на GD</div><div><font color="#ffff00">$mainFolderName</font> - название папки, в которой находится проект на GD</div><div><font color="#ffff00">$mainFolderPath</font> - название папки, в которой находится проект на GD</div><div><br></div><div><span style="font-family: Montserrat, Roboto, -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, &quot;Helvetica Neue&quot;, Arial, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;;"><font color="#ffff00">$index</font> - индекс элемента если файл не единственный</span></div><div><font color="#ffff00">$fileName</font> - имя текущего файла без расширения как есть</div><div><font color="#ffff00">$clearFileName</font> - чистое имя текущего файла без расширения без кавычек, эмоджи и текста в круглых и квадратных скобках</div><div><br></div><div><font color="#ffff00">$curMonthStr</font> - текущий месяц в виде строки (January, February, ...)</div><div><font color="#ffff00">$localFolder</font> - рабочая папка на локальном дике (указывается в настройках)</div><div><br></div><div><font color="#ffff00">$YYYY</font> - год (4 цифры)</div><div><font color="#ffff00">$MM</font> - месяц (2 цифры)</div><div><font color="#ffff00">$DD - день (2 цифры)</font></div><div><font color="#ffff00">$HH</font> - часы (2 цифры)</div><div><font color="#ffff00">$mm</font> - минуты (2 цифры)</div><div><font color="#ffff00">$ss</font> - секунды (2 цифры)</div>',
						options: ['#pathPattern', 'CustomFolder...'],
						multiSelect: true,
						allowDuplicates: true,
						value: [],
					},
					isInput: true,
					acceptedTypes: ['path'],
					outputType: 'path',
					required: false,
				},
			],
			output: { sourceProperty: 'inputFile' },
			isValid: false,
		},
	};
}

// ── Utils ────────────────────────────────────────────────────────────────────

export function toCamelCase(str: string): string {
	return str
		.replace(/[^a-zA-Z0-9 ]/g, '')
		.split(' ')
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join('');
}

export function makeDefaultProperty(controlType: string, existingIds: string[]): UiPropertyData {
	let id = controlType;
	let n = 1;
	while (existingIds.includes(id)) id = `${controlType}${n++}`;

	const entry = CONTROL_TYPE_REGISTRY.find((e) => e.controlType === controlType);
	if (entry) {
		return { id, ...entry.defaultProps };
	}

	// Fallback for unknown / non-registry types (loop, addLink, addPathLink, etc.)
	return {
		id,
		controlType,
		controlProps: { label: 'New Property', tooltip: '', value: '' },
		outputType: 'string',
		required: false,
	};
}

export function validateUiJson(uiJson: UiJsonData): string[] {
	const errors: string[] = [];
	const props = uiJson.data.properties;

	if (!props.some((p) => p.required)) {
		errors.push('Нет ни одного параметра с required: true');
	}

	const srcId = uiJson.data.output?.sourceProperty;
	if (!srcId) {
		errors.push('Output handler: не выбран параметр-источник типа');
	} else {
		const src = props.find((p) => p.id === srcId);
		if (!src) {
			errors.push(`Output handler: параметр "${srcId}" не найден`);
		} else if (!src.outputType) {
			errors.push(`Output handler: у параметра "${srcId}" не задан outputType`);
		}
	}

	return errors;
}

export function generateScriptTemplate(funcName: string): string {
	return `
import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { sendToMW } from '../_template/pluginSender';
import path from 'path';

export { onLoad } from '../_template/pluginSender';

export async function ${funcName}(_item: any, _description: any) {
\tlet finalFile: any[] = [];

\tlet curPath = _item.targetPath.length == 0 ? ['$clearName ($random(3))'] : _item.targetPath;

\tif (_item.import.targetPath) {
\t\tcurPath.unshift(..._item.import.targetPath);
\t} else {
\t\tcurPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
\t}

\tconst fileForName = _description.pathForDelete;
\tconst fileTo = createPathForFileByPattern(curPath, _description, fileForName);

\ttestAndCreateFolder(path.dirname(fileTo));

\tsendToMW('statusbar', {
\t\ttext: \`\${_description.infoText}: [process]\\n \${_description.curItem}\`,
\t});
\tsendToMW('log', { level: 'info', text: \`Result:\n\${finalFile}\` });
\treturn finalFile;
}
`;
}
