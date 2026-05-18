// utils/fileOperations.ts
import path from 'path';
import fs from 'fs';
import { testAndCreateFolder } from './testAndCreateFolder';
import { deleteFolder } from './operation/deleteFolder';
import { isFolder } from './operation/isFolder';
import { calculateSampleHashSync } from './sampleHash';

// =========================================================================================
// Вспомогательные функции
// =========================================================================================

/**
 * Проверяет, находятся ли пути на одном диске
 */
function arePathsOnSameDisk(path1: string, path2: string): boolean {
	const getRootDirectory = (filePath: string) => path.parse(filePath).root;
	return getRootDirectory(path1) === getRootDirectory(path2);
}

// Сколько раз пытаемся копировать при несовпадении хэшей.
const COPY_RETRIES = 3;

/**
 * Безопасное удаление файла или папки
 */
export function tryToUnlinkFile(_path: string): 'success' | 'error' {
	try {
		// Если файла/папки нет — считаем, что "уже удалено" → успех
		if (!fs.existsSync(_path)) {
			return 'success';
		}

		if (isFolder(_path)) {
			fs.rmSync(_path, { recursive: true, force: true });
		} else {
			fs.unlinkSync(_path);
		}

		return 'success';
	} catch (e) {
		console.error(`Ошибка при удалении "${_path}":`, e);
		return 'error';
	}
}

// =========================================================================================
// Основные операции с файлами
// =========================================================================================

/**
 * Копирует файл с проверкой целостности (sample-hash + retry).
 *
 * Алгоритм:
 *  1. Считаем размер + sample-hash (первый/средний/последний MB) исходника
 *  2. Копируем в dest
 *  3. Считаем size + sample-hash у dest — должны совпадать
 *  4. При несовпадении: удаляем dest, повторяем. Всего до COPY_RETRIES попыток.
 *  5. После исчерпания — возвращаем 'hash_mismatch'.
 *
 * Используется как универсальный способ копирования для всех файлов.
 */
export function copyFileWithHashCheck(
	sourcePath: string,
	destinationPath: string,
	deleteSource: boolean = false
): 'success' | 'hash_mismatch' | 'error' {
	try {
		testAndCreateFolder(path.dirname(destinationPath));

		const sourceStat = fs.statSync(sourcePath);
		const sourceSize = sourceStat.size;
		const sourceHash = calculateSampleHashSync(sourcePath);

		let lastMismatch = false;

		for (let attempt = 1; attempt <= COPY_RETRIES; attempt++) {
			// предыдущий неудачный dest чистим (если остался)
			if (fs.existsSync(destinationPath)) tryToUnlinkFile(destinationPath);

			fs.copyFileSync(sourcePath, destinationPath);

			const destStat = fs.statSync(destinationPath);
			if (destStat.size !== sourceSize) {
				lastMismatch = true;
				console.warn(
					`[copyFileWithHashCheck] size mismatch attempt ${attempt}/${COPY_RETRIES}: ${sourceSize} → ${destStat.size}`,
				);
				continue;
			}

			const destHash = calculateSampleHashSync(destinationPath);
			if (destHash !== sourceHash) {
				lastMismatch = true;
				console.warn(
					`[copyFileWithHashCheck] hash mismatch attempt ${attempt}/${COPY_RETRIES} for ${path.basename(sourcePath)}`,
				);
				continue;
			}

			// OK
			if (deleteSource) tryToUnlinkFile(sourcePath);
			return 'success';
		}

		// Все попытки провалены
		if (fs.existsSync(destinationPath)) tryToUnlinkFile(destinationPath);
		console.error(
			`[copyFileWithHashCheck] FAILED after ${COPY_RETRIES} attempts: ${sourcePath} → ${destinationPath}`,
		);
		return lastMismatch ? 'hash_mismatch' : 'error';
	} catch (error) {
		console.error('Error copying file with hash check:', error);
		return 'error';
	}
}

/**
 * Копирование файла. Всегда с проверкой целостности (sample-hash + retry).
 * Параметр сохранён ради обратной совместимости старых вызовов.
 * Возвращает true при успехе, false при ошибке или несовпадении после всех попыток.
 */
export function copyFile(sourcePath: string, destinationPath: string, deleteSource: boolean = false): boolean {
	return copyFileWithHashCheck(sourcePath, destinationPath, deleteSource) === 'success';
}

/**
 * Перемещает файл (использует rename если на одном диске, иначе копирование + удаление)
 */
export function moveFile(sourcePath: string, destinationPath: string, useHashCheck: boolean = false): boolean {
	try {
		testAndCreateFolder(path.dirname(destinationPath));

		if (arePathsOnSameDisk(sourcePath, destinationPath)) {
			// Простое перемещение на том же диске
			fs.renameSync(sourcePath, destinationPath);
			return fs.existsSync(destinationPath);
		} else {
			// Копирование между разными дисками
			if (useHashCheck) {
				const result = copyFileWithHashCheck(sourcePath, destinationPath, true);
				return result === 'success';
			} else {
				return copyFile(sourcePath, destinationPath, true);
			}
		}
	} catch (error) {
		console.error('Error moving file:', error);
		return false;
	}
}

// =========================================================================================
// Операции с папками
// =========================================================================================

/**
 * Рекурсивно копирует папку
 */
export function copyFolder(
	sourcePath: string,
	destinationPath: string,
	deleteSource: boolean = false,
	useHashCheck: boolean = false
): boolean {
	try {
		// Создаем целевую папку
		testAndCreateFolder(destinationPath);

		// Получаем содержимое папки
		const items = fs.readdirSync(sourcePath);

		// Обрабатываем каждый элемент
		for (const item of items) {
			const srcItemPath = path.join(sourcePath, item);
			const destItemPath = path.join(destinationPath, item);

			const stat = fs.statSync(srcItemPath);

			if (stat.isDirectory()) {
				// Рекурсивно копируем подпапку
				const success = copyFolder(srcItemPath, destItemPath, deleteSource, useHashCheck);
				if (!success) return false;
			} else if (stat.isFile()) {
				// Копируем файл
				let success: boolean;
				if (useHashCheck) {
					const result = copyFileWithHashCheck(srcItemPath, destItemPath, deleteSource);
					success = result === 'success';
				} else {
					success = copyFile(srcItemPath, destItemPath, deleteSource);
				}
				if (!success) return false;
			}
		}

		// Удаляем исходную папку если требуется и она пуста
		if (deleteSource) {
			try {
				const remainingItems = fs.readdirSync(sourcePath);
				if (remainingItems.length === 0) {
					fs.rmdirSync(sourcePath);
				}
			} catch (error) {
				console.log(`Could not delete source folder ${sourcePath}, may not be empty`);
			}
		}

		return true;
	} catch (error) {
		console.error('Error copying folder:', error);
		return false;
	}
}

/**
 * Рекурсивно перемещает папку
 */
export function moveFolder(sourcePath: string, destinationPath: string, useHashCheck: boolean = false): boolean {
	try {
		// Если на одном диске, используем rename для всей папки
		if (arePathsOnSameDisk(sourcePath, destinationPath)) {
			testAndCreateFolder(path.dirname(destinationPath));
			fs.renameSync(sourcePath, destinationPath);
			return fs.existsSync(destinationPath);
		} else {
			// На разных дисках - копируем с последующим удалением
			const copySuccess = copyFolder(sourcePath, destinationPath, false, useHashCheck);
			if (copySuccess) {
				// Рекурсивно удаляем исходную папку
				deleteFolder(sourcePath);
				return true;
			}
			return false;
		}
	} catch (error) {
		console.error('Error moving folder:', error);
		return false;
	}
}

// =========================================================================================
// УНИВЕРСАЛЬНЫЕ ОПЕРАЦИИ (улучшенные версии)
// =========================================================================================

/**
 * Универсальная функция копирования (файла или папки)
 * Автоматически определяет тип элемента и копирует его
 */
export function copyItem(
	sourcePath: string,
	destinationPath: string,
	options: {
		useHashCheck?: boolean;
		overwrite?: boolean;
	} = {}
): boolean {
	const { useHashCheck = false, overwrite = false } = options;

	try {
		if (!fs.existsSync(sourcePath)) {
			console.error('Source item does not exist:', sourcePath);
			return false;
		}

		const isDirectory = isFolder(sourcePath);

		// ====== ЕСЛИ DEST СУЩЕСТВУЕТ ======
		if (fs.existsSync(destinationPath)) {
			if (!overwrite) {
				console.log('Destination exists and overwrite=false:', destinationPath);
				return false;
			}

			// 📄 ФАЙЛ → сравниваем возраст
			if (!isDirectory) {
				if (!isSourceNewer(sourcePath, destinationPath)) {
					// source старее или равен → ничего не делаем
					return false;
				}

				// source новее → удаляем файл
				tryToUnlinkFile(destinationPath);
			}

			// 📁 ПАПКА → НИЧЕГО НЕ УДАЛЯЕМ
			// merge-логика внутри copyFolder
		}

		// ====== ВЫПОЛНЯЕМ ОПЕРАЦИЮ ======
		if (isDirectory) {
			return copyFolder(sourcePath, destinationPath, false, useHashCheck);
		} else {
			if (useHashCheck) {
				return copyFileWithHashCheck(sourcePath, destinationPath, false) === 'success';
			} else {
				return copyFile(sourcePath, destinationPath, false);
			}
		}
	} catch (error) {
		console.error('Error in copyItem:', error);
		return false;
	}
}

/**
 * Универсальная функция перемещения (файла или папки)
 * Автоматически определяет тип элемента и перемещает его
 * Использует rename на одном диске, копирование+удаление на разных дисках
 */
export function moveItem(
	sourcePath: string,
	destinationPath: string,
	options: {
		useHashCheck?: boolean;
		overwrite?: boolean;
	} = {}
): boolean {
	const { useHashCheck = false, overwrite = false } = options;

	try {
		if (!fs.existsSync(sourcePath)) {
			console.error('Source item does not exist:', sourcePath);
			return false;
		}

		const isDirectory = isFolder(sourcePath);

		// ====== DEST СУЩЕСТВУЕТ ======
		if (fs.existsSync(destinationPath)) {
			if (!overwrite) return false;

			if (!isDirectory) {
				if (!isSourceNewer(sourcePath, destinationPath)) {
					return false;
				}
				tryToUnlinkFile(destinationPath);
			}
		}

		// ====== ОДИН ДИСК → rename (ТОЛЬКО ЕСЛИ DEST НЕ СУЩЕСТВУЕТ) ======
		if (arePathsOnSameDisk(sourcePath, destinationPath) && !fs.existsSync(destinationPath)) {
			testAndCreateFolder(path.dirname(destinationPath));
			fs.renameSync(sourcePath, destinationPath);
			return fs.existsSync(destinationPath);
		}

		// ====== COPY + DELETE ======
		if (isDirectory) {
			const copied = copyFolder(sourcePath, destinationPath, false, useHashCheck);
			if (copied) {
				deleteFolder(sourcePath);
				return true;
			}
			return false;
		} else {
			if (useHashCheck) {
				return copyFileWithHashCheck(sourcePath, destinationPath, true) === 'success';
			} else {
				return copyFile(sourcePath, destinationPath, true);
			}
		}
	} catch (error) {
		console.error('Error in moveItem:', error);
		return false;
	}
}

// =========================================================================================
// Дополнительные утилиты для удобства
// =========================================================================================

/**
 * Копирует несколько элементов
 */
export function copyItems(
	sourceItems: Array<{ sourcePath: string; destinationPath: string }>,
	options: {
		useHashCheck?: boolean;
		overwrite?: boolean;
	} = {}
): boolean[] {
	return sourceItems.map((item) => copyItem(item.sourcePath, item.destinationPath, options));
}

/**
 * Перемещает несколько элементов
 */
export function moveItems(
	sourceItems: Array<{ sourcePath: string; destinationPath: string }>,
	options: {
		useHashCheck?: boolean;
		overwrite?: boolean;
	} = {}
): boolean[] {
	return sourceItems.map((item) => moveItem(item.sourcePath, item.destinationPath, options));
}

/**
 * дополнительная функция для проверки возраста файлов
 * Проверяет, является ли sourcePath новее destinationPath
 */
function isSourceNewer(sourcePath: string, destinationPath: string): boolean {
	try {
		const srcStat = fs.statSync(sourcePath);
		const destStat = fs.statSync(destinationPath);
		return srcStat.mtime.getTime() > destStat.mtime.getTime();
	} catch {
		// если destination не существует — считаем source новее
		return true;
	}
}
