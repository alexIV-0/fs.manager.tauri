import { Property, OverlaySettingsProperty, VideoAdjustmentProperty, KeyingProperty, ConvertSettingsProperty } from '@/NODE_WIN/definitions/types';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { useUpdateFlow } from '@/NODE_WIN/hooks/useUpdateFlow';
import { useUpdateNodeInternals } from '@xyflow/react';
import { memo } from 'react';
import CheckboxProperty from '../properties/Checkbox';
import ChipAutocompleteProperty from '../properties/ChipAutocompleteProperty';
import CustomSlider from '../properties/CustomSlider';
import TextProperty from '../properties/LinkProperty';
import TimeCode from '../properties/TimeCode';
import ValueRange from '../properties/ValueRange';
import LoopGroupProperty from './LoopGroupProperty';
import TextEditPropertyComponent from '../properties/TextEditProperty';
import AddNewPropertyButtom from '../properties/AddNewPropertyButtom';
import SimpleDDMProperty from '../properties/SimpleDDM';
import ServiceAccountDDM from '@/NODE_WIN/nodes/properties/ServiceAccountDDM';
import { SERVICE_TAG_PREFIX } from '@/Utils/vendorServices';
import VkAccountDDM from '../properties/VkAccountDDM';
import YoutubeAccountDDM from '../properties/YoutubeAccountDDM';
import TgAccountDDM from '../properties/TgAccountDDM';
import TgChannelsProperty from '../properties/TgChannelsProperty';
import TgSourceProperty from '../properties/TgSourceProperty';
import CollectProperty from '../properties/CollectProperty';
import PathNavigator from '../properties/PathNavigator';
import JsonNavigator from '../properties/JsonNavigator';
import AddPathPropertyButton from '../properties/AddPathPropertyButton';
import OverlaySettingsPropertyComponent from '../properties/OverlaySettingsProperty';
import VideoAdjustmentPropertyComponent from '../properties/VideoAdjustmentProperty';
import KeyingPropertyComponent from '../properties/KeyingProperty';
import ConvertPropertyComponent from '../properties/ConvertProperty';
import TitleSettingsProperty from '../properties/TitleSettingsProperty';

function GenericProperty({ property }: { property: Property }) {
	const nodeId = useNodeContext();
	const updateNodeInternals = useUpdateNodeInternals();
	const { updateNodeProperty } = useUpdateFlow();

	const handleChange = (value: any) => {
		updateNodeProperty(nodeId, property.id, value);
	};

	const renderControl = () => {
		switch (property.controlType) {
			case 'checkbox':
				return <CheckboxProperty property={property} onChange={(_, checked) => handleChange(checked)} />;
			case 'autocomplete':
				return property.controlProps.options?.includes('#tgChannels') ? (
					<TgChannelsProperty property={property} onChange={handleChange} />
				) : (
					<ChipAutocompleteProperty property={property} onChange={handleChange} />
				);
			case 'ddm':
				// Учётка внешнего сервиса — тег параметризован слагом, поэтому startsWith,
				// а не includes (VENDOR_KEYS_CONTRACT.md §6.2).
				if (property.controlProps.options?.some((o) => typeof o === 'string' && o.startsWith(SERVICE_TAG_PREFIX)))
					return <ServiceAccountDDM property={property} onChange={handleChange} />;
				if (property.controlProps.options?.includes('#vkAccounts'))
					return <VkAccountDDM property={property} onChange={handleChange} />;
				if (property.controlProps.options?.includes('#youtubeAccounts'))
					return <YoutubeAccountDDM property={property} onChange={handleChange} />;
				if (property.controlProps.options?.includes('#tgAccounts'))
					return <TgAccountDDM property={property} onChange={handleChange} />;
				if (property.controlProps.options?.includes('#tgSources'))
					return <TgSourceProperty property={property} onChange={handleChange} />;
				return <SimpleDDMProperty property={property} onChange={handleChange} />;
			case 'link':
				return <TextProperty property={property} />;
			case 'addLink':
				return <AddNewPropertyButtom property={property} />;
			case 'slider':
				return <CustomSlider property={property} onChange={handleChange} />;
			case 'timecode':
				return <TimeCode property={property} onChange={handleChange} />;
			case 'valueRange':
				return <ValueRange property={property} onChange={handleChange} />;
			case 'loop':
				return <LoopGroupProperty property={property} />;
			case 'textedit':
				return <TextEditPropertyComponent property={property} />;
			case 'titleSettings':
				return <TitleSettingsProperty property={property} />;
			case 'pathNavigator':
				return <PathNavigator property={property} onChange={handleChange} />;
			case 'jsonNavigator':
				return <JsonNavigator property={property} onChange={handleChange} />;
			case 'addPathLink':
				return <AddPathPropertyButton property={property} />;
			case 'overlaySettings':
				return <OverlaySettingsPropertyComponent property={property as OverlaySettingsProperty} />;
			case 'videoAdjustment':
				return <VideoAdjustmentPropertyComponent property={property as VideoAdjustmentProperty} />;
			case 'keying':
				return <KeyingPropertyComponent property={property as KeyingProperty} />;
			case 'convertSettings':
				return <ConvertPropertyComponent property={property as ConvertSettingsProperty} />;
			case 'collectScheme':
				return <CollectProperty property={property} />;
			// Невидимое свойство: существует ради попапа «настройки кодирования» в шапке ноды
			// (`NodeEncodeSettings`). Ветка явная, а не через `default`, чтобы при чтении
			// свитча было видно, что тип учтён и рисовать его не забыли.
			case 'encodeSettings':
				return null;
			default:
				return null;
		}
	};

	return renderControl();
}

export default memo(GenericProperty);
