import { Property } from '../definitions/types';

function useProperty() {
	const getPropertyValueAndType = (property: Property, sourceValue?: any) => {
		let value: string | string[] = '';
		let type = '';
		if (property?.controlType === 'autocomplete') {
			if (property.outputType === 'array') {
				value = sourceValue?.[0] || property.controlProps.value[0] || '';
				type = value as string;
			}
			if (property.outputType === 'path') {
				value = sourceValue || property.controlProps.value;
				type = 'path';
			}
		}
		if (property?.controlType === 'link') {
			if (property.outputType === 'accepted') {
				value = sourceValue || property.controlProps.value;
				type = value as string;
			}
		}

		return { value, type };
	};
	return { getPropertyValueAndType };
}

export default useProperty;
