import { app } from 'electron';
import path from 'path';

export let optionsFolderPath = path.join(app.getPath('appData'), app.getName());

export const pluginsPath = path.join(optionsFolderPath, 'plugins');
export const settingsPath = path.join(optionsFolderPath, 'settings');
