import { CustomNodeSettings } from '../CustomNodeSettings';

export default function TabNodes() {
	const nodesTypeText = `Типы нод.`;

	return (
		<CustomNodeSettings
			title={nodesTypeText}
			color={null}
			restoreButton={true}
			multiselect={true}
			optionsOnly={true}
			allowDuplicates={false}
		/>
	);
}
