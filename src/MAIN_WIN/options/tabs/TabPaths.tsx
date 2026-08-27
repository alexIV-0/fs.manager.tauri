import { filePathNamePattern } from '@/NODE_WIN/utils/searchTypes';
import { pathPattern_store, programPathPattern_store, folderPath_store } from '@/Store/MainWin/pathPattern_store';
import { commands, unwrap } from '@/Utils/specta';
import { cyanColor, greyColor } from '@/Store/Color/grayColor';
import { Box, Button } from '@mui/material';
import { FolderOpen } from 'lucide-react';
import { CustomUserSettings } from '../CustomUserSettings';
import { LocalOnlyNote, SettingsSyncRow } from '../SettingsSyncRow';
import { FfmpegDownloadSection, WhisperModelsSection, TgServerSection } from './DepsDownloadPanel';

export default function TabPaths() {
	const pathPattern = pathPattern_store();
	const programmPathPattern = programPathPattern_store();
	const folderPathStore = folderPath_store();

	// Папка настроек = app_data_dir (settings.json, fileTypes.json и т.п.); открываем её в проводнике.
	const handleOpenSettingsFolder = async () => {
		try {
			const dir = unwrap(await commands.getUserDataPath());
			if (dir) await commands.shellOpenPath(dir);
		} catch {
			/* игнорируем — не критично */
		}
	};

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
			<SettingsSyncRow />
			<CustomUserSettings title={pathText} store={pathPattern} options={[...filePathNamePattern]} />
			<LocalOnlyNote why='пути к ffmpeg / After Effects у каждой машины свои' />
			<CustomUserSettings
				title={programmText}
				store={programmPathPattern}
				optionsOnly={true}
				multiselect={false}
				options={['Custom File...']}
			/>
			<FfmpegDownloadSection />
			<LocalOnlyNote why='локальные папки доп-материалов' />
			<CustomUserSettings
				title={dopMatFolderText}
				store={folderPathStore}
				optionsOnly={true}
				multiselect={false}
				options={['Custom Folder...']}
			/>
			<WhisperModelsSection />
			<TgServerSection />
			<Box sx={{ px: 1, pt: 1, pb: 2 }}>
				<Button
					variant='outlined'
					size='small'
					onClick={handleOpenSettingsFolder}
					startIcon={<FolderOpen size={16} />}
					sx={{ textTransform: 'none', borderColor: cyanColor(60), color: greyColor(90) }}
				>
					Открыть папку с настройками
				</Button>
			</Box>
		</>
	);
}
