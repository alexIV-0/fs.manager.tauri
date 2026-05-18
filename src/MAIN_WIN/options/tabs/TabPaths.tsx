import { filePathNamePattern } from '@/NODE_WIN/utils/searchTypes';
import { pathPattern_store, programPathPattern_store, folderPath_store } from '@/Store/MainWin/pathPattern_store';
import { CustomUserSettings } from '../CustomUserSettings';

export default function TabPaths() {
	const pathPattern = pathPattern_store();
	const programmPathPattern = programPathPattern_store();
	const folderPathStore = folderPath_store();

	const pathText = `Тут указываем кастомные маски для путей, которые будут потом использоваться как
маски с $ в начале.
Например $workingFolder'`;

	const programmText = `Пути до программ, которые будут запускаться с $ в начале. 
Например $moho или $afterEffect
`;
	const dopMatFolderText = `Добавим дополнительные папки для работы с материалами.
Например папку с моделями для whisper. т.к. они достаточно большие что бы класть их в плагин
`;

	return (
		<>
			<CustomUserSettings title={pathText} store={pathPattern} options={[...filePathNamePattern]} />
			<CustomUserSettings
				title={programmText}
				store={programmPathPattern}
				optionsOnly={true}
				multiselect={false}
				options={['Custom File...']}
			/>
			<CustomUserSettings
				title={dopMatFolderText}
				store={folderPathStore}
				optionsOnly={true}
				multiselect={false}
				options={['Custom Folder...']}
			/>
		</>
	);
}
