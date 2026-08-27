// Триггеры синхронизации общих словарей. План — `ideasAndTest/SETTINGS_SYNC_PLAN.md` §5.5.
//
// Своего поллинга нет намеренно: ревизия словарей приезжает попутным полем каждого
// `GET /delta` (демон дёргает его раз в три секунды), Rust сравнивает её с последней
// известной и эмитит `settings-revision-changed` только на изменение.
//
// Плюс безусловное чтение при подключении: если у пользователя нет ни одного
// облачного проекта, `/delta` не вызывается вовсе — и словарь иначе не приедет
// никогда.
//
// Живёт только в MAIN_WIN: сторы словарей — состояние этого окна, а окна у нас
// разные JS-realm'ы. Второе окно синхронизацию не поднимает и не должно.

import { useEffect } from 'react';

import { settingsSync_store } from '@/Store/MainWin/settingsSync_store';
import { storage_store } from '@/Store/MainWin/storage_store';
import { tauriAPI } from '@/Utils/tauri-api';

export function useSettingsSync(): void {
	const connected = storage_store((s) => s.status?.connected ?? false);
	const configured = storage_store((s) => s.status?.configured ?? false);

	// Хранилище не настроено — это НАСТРОЙКА, а не «нет связи»: ни одного запроса
	// не делаем и ведём себя ровно как до появления синхронизации.
	useEffect(() => {
		settingsSync_store.getState().setConfigured(configured);
		if (!configured) return;
		// Показать «локальных правок N» можно и без сети — база лежит файлом.
		void settingsSync_store.getState().refreshDirty();
	}, [configured]);

	useEffect(() => {
		if (!connected) return;
		void settingsSync_store.getState().sync();
	}, [connected]);

	useEffect(() => {
		const off = tauriAPI.onSettingsRevisionChanged(() => {
			if (!storage_store.getState().status?.connected) return;
			void settingsSync_store.getState().sync();
		});
		return off;
	}, []);
}
