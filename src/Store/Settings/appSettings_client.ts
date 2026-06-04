import { create } from 'zustand';
import {
	AppSettings,
	AppSettingsPatch,
	ColorTypesFile,
	DEFAULT_APP_SETTINGS,
	DEFAULT_COLOR_TYPES,
} from '@/types/appSettings';
import { commands, unwrap } from '@/Utils/specta';

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
				commands.appSettingsGet(),
				commands.colorTypesGet(),
			]);
			set({ settings: unwrap(s) as unknown as AppSettings, colorTypes: unwrap(ct) as unknown as ColorTypesFile, loaded: true });
		} catch (e) {
			console.warn('[appSettings_client] load failed:', e);
			set({ loaded: true });
		}
	},

	patch: async (p) => {
		const next = unwrap(await commands.appSettingsPatch(p as any)) as unknown as AppSettings;
		set({ settings: next });
	},

	setFull: async (s) => {
		const next = unwrap(await commands.appSettingsSet(s as any)) as unknown as AppSettings;
		set({ settings: next });
	},

	rescanColorTypes: async () => {
		const next = unwrap(await commands.colorTypesRescan()) as unknown as ColorTypesFile;
		set({ colorTypes: next });
	},

	addColorType: async (name, defaultLimit) => {
		const next = unwrap(await commands.colorTypesAdd(name, defaultLimit ?? 1)) as unknown as ColorTypesFile;
		set({ colorTypes: next });
	},

	removeColorType: async (name) => {
		const next = unwrap(await commands.colorTypesRemove(name)) as unknown as ColorTypesFile;
		set({ colorTypes: next });
	},

	setColorTypes: async (t) => {
		const next = unwrap(await commands.colorTypesSet(t as any)) as unknown as ColorTypesFile;
		set({ colorTypes: next });
	},
}));

// Удобный вызов для неуклюжих мест вроде runProcessing.ts:
// возвращает текущие settings из стора (если ещё не загружены — дефолты).
export function getAppSettings(): AppSettings {
	return appSettings_client.getState().settings;
}
