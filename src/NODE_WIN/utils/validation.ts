import { Property } from '../definitions/types';

export const isValueValid = (property: Property): boolean => {
	if (!property.controlProps) return false;

	// textedit проверяем до общего early return — value может быть пустым,
	// но нода всё равно валидна если подключён edge (inheritedValue задан)
	if (property.controlType === 'textedit') {
		if (property.controlProps.inheritedValue !== undefined && property.controlProps.inheritedValue !== '') return true;
		return typeof property.controlProps.value === 'string' ? property.controlProps.value !== '' : false;
	}

	if (!property.controlProps.value) {
		return false;
	}

	let value = property.controlProps.value;

	if (property.controlType === 'autocomplete') {
		if (property.controlProps.inheritedValue !== undefined) {
			value = property.controlProps.inheritedValue;
		}
		if (property.outputType === 'array' || property.outputType === 'string' || property.outputType === 'typeByExtension') {
			return Array.isArray(value) ? value.length > 0 : value !== '';
		}
		if (property.outputType === 'path') {
			return Array.isArray(value) ? value.join('/') !== '' : false;
		}
		if (property.outputType === 'timecode') {
			console.log('value', value);
			return Array.isArray(value) ? value.length > 0 : false;
		}
	}

	if (property.controlType === 'link') {
		return value !== '' && value !== undefined;
	}

	if (property.controlType === 'checkbox') {
		return Boolean(value);
	}

	if (property.controlType === 'pathNavigator') {
		return typeof value === 'string' ? value !== '' : false;
	}

	if (property.controlType === 'addLink' || property.controlType === 'addPathLink') {
		return Array.isArray(value) ? value.length > 0 && value[0] !== '' : value !== '';
	}

	if (property.controlType === 'ddm') {
		const val = Array.isArray(property.controlProps.value)
			? (property.controlProps.value[0] ?? '')
			: (property.controlProps.value ?? '');
		return val !== '';
	}

	// Modal-based components store their value as JSON string
	if (
		property.controlType === 'keying' ||
		property.controlType === 'overlaySettings' ||
		property.controlType === 'videoAdjustment' ||
		property.controlType === 'titleSettings' ||
		property.controlType === 'convertSettings'
	) {
		return typeof value === 'string' ? value !== '' : false;
	}

	// collectScheme (autoTGcollect) — value — объект { type, ... }; валиден если задан type.
	if (property.controlType === 'collectScheme') {
		return typeof value === 'object' && value !== null && typeof (value as any).type === 'string' && (value as any).type !== '';
	}

	return false;
};
