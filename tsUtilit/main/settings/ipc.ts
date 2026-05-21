import { ipcMain } from 'electron';
import {
	patchAppSettings,
	readAppSettings,
	writeAppSettings,
	AppSettingsPatch,
} from './appSettings';
import {
	addColorType,
	readColorTypes,
	removeColorType,
	rescanColorTypes,
	writeColorTypes,
} from './colorTypes';
import type { AppSettings, ColorTypesFile } from './types';
import { autoDeleteOldFolders } from '../fileSistem/autoDeleteOldFolders';

let registered = false;

export function registerSettingsIpc(): void {
	if (registered) return;
	registered = true;

	// ====== app-settings ======
	ipcMain.handle('app-settings:get', async (): Promise<AppSettings> => {
		return readAppSettings();
	});

	ipcMain.handle(
		'app-settings:set',
		async (_event, next: AppSettings): Promise<AppSettings> => {
			return writeAppSettings(next);
		},
	);

	ipcMain.handle(
		'app-settings:patch',
		async (_event, patch: AppSettingsPatch): Promise<AppSettings> => {
			return patchAppSettings(patch);
		},
	);

	// ====== color-types ======
	ipcMain.handle('color-types:get', async (): Promise<ColorTypesFile> => {
		return readColorTypes();
	});

	ipcMain.handle('color-types:rescan', async (): Promise<ColorTypesFile> => {
		return rescanColorTypes();
	});

	ipcMain.handle(
		'color-types:add',
		async (_event, name: string, defaultLimit?: number): Promise<ColorTypesFile> => {
			return addColorType(name, defaultLimit ?? 1);
		},
	);

	ipcMain.handle(
		'color-types:remove',
		async (_event, name: string): Promise<ColorTypesFile> => {
			return removeColorType(name);
		},
	);

	ipcMain.handle(
		'color-types:set',
		async (_event, next: ColorTypesFile): Promise<ColorTypesFile> => {
			return writeColorTypes(next);
		},
	);

	// ====== cleanup ======
	ipcMain.handle('cleanup:auto-delete', async (_event, localFolder: string): Promise<void> => {
		if (!localFolder) return;
		const { retentionDays } = readAppSettings().cleanup;
		if (!retentionDays || retentionDays <= 0) return;
		autoDeleteOldFolders(localFolder, retentionDays);
	});
}
