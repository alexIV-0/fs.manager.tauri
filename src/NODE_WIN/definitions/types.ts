import { CheckboxProps } from '@mui/material';
import { Edge, Node, Viewport } from '@xyflow/react';

export enum HandlerType {
	TARGET = 'target',
	SOURCE = 'source',
}

export interface OutputConfig {
	functionName?: string; // legacy: нужен только built-in search-нодам (mainSearch); плагинам — нет

	execute?: {
		functionName?: string;
		arguments?: string[];
	};
	sourceProperty: string;
}

export interface Handler {
	id: string;
	color: any;
	type: HandlerType;
	maxConnections: number;
	data: any[];
	isValid: boolean;
	isError: boolean;
	allowedTypes?: string[];
	[key: string]: unknown;
}

export interface CustomNodeData {
	isUnique?: boolean;
	required?: boolean;
	colorType: string;
	label: string;
	comment: string;
	inheritedValue?: string;
	properties: Property[];
	output?: OutputConfig;
	isValid: boolean;

	// Нода выключена пользователем — не исполняется, downstream остаётся без входа.
	// Отсутствие поля = false (старые флоу).
	disabled?: boolean;

	// 🔥 НОВЫЕ ПОЛЯ ДЛЯ ПЛАГИНОВ
	pluginId?: string; // ID плагина (если нода из плагина)
	pluginVersion?: string; // Версия плагина (если нода из плагина)

	[key: string]: unknown;
}

export interface CustomNode extends Node {
	type: string;
	data: CustomNodeData;
}

export interface NodeOptions {
	type: string;
	bounds: {
		x: number;
		y: number;
		width?: number;
		height?: number;
	};
	data: CustomNodeData;
}

export interface PropertyBase<CT extends string, CP> {
	id: string;
	controlType: CT;
	controlProps: CP;
	isInput?: boolean;
	isOutput?: boolean;
	acceptedTypes?: string[];
	outputType: 'array' | 'path' | 'boolean' | 'accepted' | 'string' | 'timecode' | 'typeByExtension' | 'audio';
	outputTypeMap?: Record<string, string>;
	outputMarker?: string;
	required?: boolean;
	output?: OutputConfig;
}

export interface CheckboxPropertyControlProps extends CheckboxProps {
	label?: string;
	tooltip?: string;
	value: boolean;
	editLabel?: boolean; // если true — двойной клик по label позволяет его редактировать
}

export interface AutocompletePropertyControlProps {
	label?: string;
	tooltip?: string;
	options: string[];
	multiSelect?: boolean;
	optionsOnly?: boolean;
	allowDuplicates?: boolean;
	value: string[];
	inheritedValue?: string[];
	onChange?: (value: string[]) => void;
	editLabel?: boolean;
}

export interface LinkPropertyControlProps {
	label?: string;
	tooltip?: string;
	value: string;
	editLabel?: boolean; // если true — двойной клик по label позволяет его редактировать
}

export interface SliderPropertyControlProps {
	label?: string;
	tooltip?: string;
	value?: number;
	minValue?: number;
	maxValue?: number;
	step?: number;
	useValuesAsLabels?: boolean; // true = разрешить ручной ввод, false = только просмотр
	minMaxValueVisible?: boolean; // true = показывать min/max метки, false = скрывать
	isTextInput?: boolean;
	initValue?: number;
	minLabelWidth?: string;
	editLabel?: boolean; // если true — двойной клик по label позволяет его редактировать
	onChange?: (value: number) => void;
}

export interface TimeCodePropertyControlProps {
	label?: string;
	tooltip?: string;
	value?: number; // значение в секундах
	editLabel?: boolean; // если true — двойной клик по label позволяет его редактировать
}

export interface LoopPropertyControlProps {
	label?: string;
	tooltip?: string;
	value: string;
}

export type TextEditLanguage = 'plaintext' | 'javascript' | 'typescript' | 'json' | 'python';

export interface TextEditPropertyControlProps {
	label?: string;
	tooltip?: string;
	value: string;
	inheritedValue?: string;
	language?: TextEditLanguage;
	editLabel?: boolean; // если true — двойной клик по label позволяет его редактировать
}

export type AddableType = 'Link' | 'TextEdit' | 'Timecode' | 'Slider' | 'Checkbox';
export const ALL_ADDABLE_TYPES: AddableType[] = ['Link', 'TextEdit', 'Timecode', 'Slider', 'Checkbox'];

export interface AddNewPropertyControlProps {
	label?: string;
	tooltip?: string;
	value: string[];
	allowedTypes?: AddableType[];
}

export interface AddPatchPropertyControlProps {
	label?: string;
	tooltip?: string;
	value: string[]; // путь в json: ["21", "widgets_values", "0"]
	editLabel?: boolean;
}

export interface DDMItem {
	value: string | string[];
	label?: string;
	color?: string;
}

export interface DDMPropertyControlProps {
	label?: string;
	tooltip?: string;
	value: string;
	options: string[];
	freeInput?: boolean;
	placeholder?: string;
}

export interface TitleSettingsPropertyControlProps {
	label?: string;
	tooltip?: string;
	value: string; // JSON string с полными настройками титров (TitleSettings)
}

// Добавить после TextEditPropertyControlProps:

export interface PathNavigatorControlProps {
	label?: string;
	tooltip?: string;
	value: string; // итоговый путь: "folder/subfolder/file.json"
	editLabel?: boolean;
}

export interface JsonNavigatorControlProps {
	label?: string;
	tooltip?: string;
	value: string; // путь по ключам: "key.subkey:video"
	jsonSourcePropertyId?: string; // id property в этой же ноде, где лежит путь до json файла
	editLabel?: boolean;
}

export interface AutocompletePathPropertyControlProps {
	label?: string;
	tooltip?: string;
	multiSelect?: boolean;
	allowDuplicates?: boolean;
	value: string[];
	inheritedValue?: string[];
	onChange?: (value: string[]) => void;
	editLabel?: boolean;
}

export interface AddPathPropertyControlProps {
	label?: string;
	tooltip?: string;
	value: string[]; // выбранный тип файла
}

export type AddNewProperty = PropertyBase<'addLink', AddNewPropertyControlProps>;

export type CheckboxProperty = PropertyBase<'checkbox', CheckboxPropertyControlProps>;

export type AutocompleteProperty = PropertyBase<'autocomplete', AutocompletePropertyControlProps>;

export type LinkProperty = PropertyBase<'link', LinkPropertyControlProps>;

export type SliderProperty = PropertyBase<'slider', SliderPropertyControlProps>;

export type TimeCodeProperty = PropertyBase<'timecode', TimeCodePropertyControlProps>;

export type LoopProperty = PropertyBase<'loop', LoopPropertyControlProps>;

export type TextEditProperty = PropertyBase<'textedit', TextEditPropertyControlProps>;

export type DDMProperty = PropertyBase<'ddm', DDMPropertyControlProps>;

export type TitleSettingsProperty = PropertyBase<'titleSettings', TitleSettingsPropertyControlProps>;

export type AddPatchProperty = PropertyBase<'addPatch', AddPatchPropertyControlProps>;

export type PathNavigatorProperty = PropertyBase<'pathNavigator', PathNavigatorControlProps>;
export type JsonNavigatorProperty = PropertyBase<'jsonNavigator', JsonNavigatorControlProps>;

export type AddPathProperty = PropertyBase<'addPathLink', AddPathPropertyControlProps>;

export interface OverlaySettingsPropertyControlProps {
	label?: string;
	tooltip?: string;
	value: string; // JSON string с настройками наложения (OverlaySettings)
}

export type OverlaySettingsProperty = PropertyBase<'overlaySettings', OverlaySettingsPropertyControlProps>;

export interface VideoAdjustmentPropertyControlProps {
	label?: string;
	tooltip?: string;
	value: string; // JSON string с настройками VideoAdjustSettings
}

export type VideoAdjustmentProperty = PropertyBase<'videoAdjustment', VideoAdjustmentPropertyControlProps>;

export interface KeyingPropertyControlProps {
	label?: string;
	tooltip?: string;
	value: string; // JSON string с настройками KeyingSettings
}

export type KeyingProperty = PropertyBase<'keying', KeyingPropertyControlProps>;

export interface ConvertSettingsPropertyControlProps {
	label?: string;
	tooltip?: string;
	value: string; // JSON string с настройками ConvertSettings
	inheritedValue?: string[]; // file paths from upstream connection
}

export type ConvertSettingsProperty = PropertyBase<'convertSettings', ConvertSettingsPropertyControlProps>;

export interface TimeRangePropertyControlProps {
	label?: string;
	tooltip?: string;
	value: [number, number]; // [startMin, endMin] — минуты от полуночи (0..1440)
	editLabel?: boolean;
}

export type TimeRangeProperty = PropertyBase<'timeRange', TimeRangePropertyControlProps>;

export type Property =
	| CheckboxProperty
	| AutocompleteProperty
	| LinkProperty
	| SliderProperty
	| TimeCodeProperty
	| LoopProperty
	| TextEditProperty
	| AddNewProperty
	| DDMProperty
	| TitleSettingsProperty
	| AddPatchProperty
	| PathNavigatorProperty
	| JsonNavigatorProperty
	| AddPathProperty
	| OverlaySettingsProperty
	| VideoAdjustmentProperty
	| KeyingProperty
	| ConvertSettingsProperty
	| TimeRangeProperty;

// export enum SearchType {
// 	IMAGE = 'image',
// 	VIDEO = 'video',
// 	AUDIO = 'audio',
// 	TEXT = 'text',
// 	AEP = 'aep',
// 	MOHO = 'moho',
// 	FILES = 'files',
// 	FOLDERS = 'folders',
// 	ALL = 'all',
// }

export type NodeComponent = React.ComponentType<any>;
export type NodeRegistry = Partial<Record<string, NodeComponent>>;

export interface SavedState {
	nodes: Node[];
	edges: Edge[];
	viewport: Viewport;
}
