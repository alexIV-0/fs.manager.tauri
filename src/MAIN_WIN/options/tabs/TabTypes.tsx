import { typeOfdata_store, typeOfFile_store } from '@/Store/MainWin/pathPattern_store';
import { CustomUserSettings } from '../CustomUserSettings';
import { steelColor } from '@/Store/Color/grayColor';

export default function TabTypes() {
	const typeOfFile = typeOfFile_store();
	const typeOfData = typeOfdata_store();

	const fileTypeText = `Типы файлов для поиска.`;
	const TypeOfDataText = `Специальные типы данных. Настраивается только цвет`;
	const color = steelColor(50);

	return (
		<>
			<CustomUserSettings title={fileTypeText} store={typeOfFile} color={color} restoreButtom={true} options={[]} optionsOnly={false} />
			<CustomUserSettings
				title={TypeOfDataText}
				store={typeOfData}
				color={color}
				restoreButtom={true}
				options={[]}
				optionsOnly={true}
				multiselect={false}
				allowDuplicates={false}
			/>
		</>
	);
}
