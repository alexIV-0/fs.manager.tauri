import { Property } from '../definitions/types';
import { resolveTypeByExtension } from './resolveTypeByExtension';

export const getPropertyValueAndType = (property: Property, sourceValue?: any) => {
	let value: string | string[] = '';
	let type = '';
	if (property?.controlType === 'autocomplete') {
		if (property.outputType === 'array') {
			const propValue = property.controlProps.value;
			const arrayValue = Array.isArray(propValue) ? propValue[0] : '';
			value = sourceValue?.[0] || arrayValue || '';
			type = value as string;
		}
		if (property.outputType === 'path') {
			value = sourceValue || property.controlProps.value;
			type = 'path';
		}
		if (property.outputType === 'timecode') {
			value = sourceValue || property.outputType;
			type = 'timecode';
		}
	}
	if (property?.controlType === 'link') {
		if (property.outputType === 'accepted') {
			value = sourceValue || property.controlProps.value;
			type = Array.isArray(value) ? ((value[0] as string) ?? '') : (value as string);
		} else {
			// Фиксированный тип (например 'audio') — не зависит от входящего соединения
			value = property.controlProps.value || '';
			type = property.outputType;
		}
	}

	if (property?.controlType === 'addLink' || property?.controlType === 'addPathLink') {
		if (property.outputType === 'array') {
			const val = Array.isArray(property.controlProps.value) ? property.controlProps.value[0] : property.controlProps.value;
			value = val || '';
			type = value as string;
		}
	}
	if (property?.controlType === 'ddm') {
		const raw = Array.isArray(property.controlProps.value)
			? (property.controlProps.value[0] ?? '')
			: (property.controlProps.value ?? '');

		value = raw;

		if (property.outputType === 'typeByExtension') {
			type = resolveTypeByExtension(raw).color;
		} else {
			type = property.outputType;
		}
	}

	if (property?.controlType === 'pathNavigator') {
		value = property.controlProps.value || '';
		if (property.outputType === 'typeByExtension') {
			const ext = (value as string).match(/\.([^./\\]+)$/)?.[1] ?? '';
			type = ext ? resolveTypeByExtension(ext).color : '';
		} else {
			type = property.outputType;
		}
	}

	if (property?.controlType === 'textedit') {
		const inherited = property.controlProps?.inheritedValue;
		const staticValue = property.controlProps?.value;
		value = inherited || staticValue || '';
		type = property.outputType;
	}

	if (property?.controlType === 'checkbox' && property.outputTypeMap) {
		const boolVal = Boolean(property.controlProps.value);
		type = property.outputTypeMap[String(boolVal)] ?? '';
		value = type;
	}

	if (property?.controlType === 'convertSettings') {
		// Pass through the actual file paths from upstream, not the settings JSON
		const inherited = property.controlProps.inheritedValue;
		value = inherited?.length ? inherited : '';
		if (property.outputType === 'typeByExtension') {
			const raw = property.controlProps.value ?? '';
			if (raw) {
				try {
					const s = JSON.parse(raw);
					const ext: string | undefined = s.outputExtension;
					if (ext) {
						const resolved = resolveTypeByExtension(ext);
						type = resolved.color !== 'default' ? resolved.color : '';
					}
				} catch {
					type = '';
				}
			}
		} else {
			type = property.outputType;
		}
	}

	return { value, type };
};
