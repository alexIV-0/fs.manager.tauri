// ====================================================================
// просто закрываем проект и очищаем кэш
// ====================================================================
export function closeProject() {
	app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);

	app.purge(PurgeTarget.ALL_CACHES); //очистка памяти
	// app.purge(PurgeTarget.IMAGE_CACHES); //очистка памяти
}
