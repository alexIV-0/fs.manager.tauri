import { create } from 'zustand';
import {
	AppSettings,
	AppSettingsPatch,
	ColorTypesFile,
	DEFAULT_APP_SETTINGS,
	DEFAULT_COLOR_TYPES,
} from '@/types/appSettings';

// Клиентский доступ к AppSettings и ColorTypes через IPC.
// Кэшируем в Zustand, чтобы не дергать main на каждый чих.
// Лимиты применяются при старте приложения — поэтому hot-reload не делаем.

type SettingsStore = {
	settings: AppSettings;
	colorTypes: ColorTypesFile;
	loaded: boolean;
	load: () => Promise<void>;
	patch: (p: AppSettingsPatch) => Promise<void>;
	setFull: (s: AppSettings) => Promise<void>;
	rescanColorTypes: () => Promise<void>;
	addColorType: (name: string, defaultLimit?: number) => Promise<void>;
	removeColorType: (name: string) => Promise<void>;
	setColorTypes: (t: ColorTypesFile) => Promise<void>;
};

export const appSettings_client = create<SettingsStore>((set, get) => ({
	settings: { ...DEFAULT_APP_SETTINGS },
	colorTypes: { ...DEFAULT_COLOR_TYPES, types: [] },
	loaded: false,

	load: async () => {
		try {
			const [s, ct] = await Promise.all([
				window.electronAPI.invoke<AppSettings>('app-settings:get'),
				window.electronAPI.invoke<ColorTypesFile>('color-types:get'),
			]);
			set({ settings: s, colorTypes: ct, loaded: true });
		} catch (e) {
			console.warn('[appSettings_client] load failed:', e);
			set({ loaded: true });
		}
	},

	patch: async (p) => {
		const next = await window.electronAPI.invoke<AppSettings>('app-settings:patch', p);
		set({ settings: next });
	},

	setFull: async (s) => {
		const next = await window.electronAPI.invoke<AppSettings>('app-settings:set', s);
		set({ settings: next });
	},

	rescanColorTypes: async () => {
		const next = await window.electronAPI.invoke<ColorTypesFile>('color-types:rescan');
		set({ colorTypes: next });
	},

	addColorType: async (name, defaultLimit) => {
		const next = await window.electronAPI.invoke<ColorTypesFile>(
			'color-types:add',
			name,
			defaultLimit ?? 1,
		);
		set({ colorTypes: next });
	},

	removeColorType: async (name) => {
		const next = await window.electronAPI.invoke<ColorTypesFile>('color-types:remove', name);
		set({ colorTypes: next });
	},

	setColorTypes: async (t) => {
		const next = await window.electronAPI.invoke<ColorTypesFile>('color-types:set', t);
		set({ colorTypes: next });
	},
}));

// Удобный вызов для неуклюжих мест вроде runProcessing.ts:
// возвращает текущие settings из стора (если ещё не загружены — дефолты).
export function getAppSettings(): AppSettings {
	return appSettings_client.getState().settings;
}
