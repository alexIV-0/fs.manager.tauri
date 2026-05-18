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
import LoopGroupProperty from './LoopGroupProperty';
import TextEditPropertyComponent from '../properties/TextEditProperty';
import AddNewPropertyButtom from '../properties/AddNewPropertyButtom';
import SimpleDDMProperty from '../properties/SimpleDDM';
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
				return <ChipAutocompleteProperty property={property} onChange={handleChange} />;
			case 'ddm':
				return <SimpleDDMProperty property={property} onChange={handleChange} />;
			case 'link':
				return <TextProperty property={property} />;
			case 'addLink':
				return <AddNewPropertyButtom property={property} />;
			case 'slider':
				return <CustomSlider property={property} onChange={handleChange} />;
			case 'timecode':
				return <TimeCode property={property} onChange={handleChange} />;
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
			default:
				return null;
		}
	};

	return renderControl();
}

export default memo(GenericProperty);
