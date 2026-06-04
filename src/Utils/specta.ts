/**
 * Хелперы поверх сгенерированных tauri-specta биндингов (`@/bindings`).
 *
 * `bindings.ts` авто-генерируется (`cargo test export_bindings` / debug-сборка) — его НЕ править.
 * Этот файл — стабильная точка импорта для приложения + `unwrap()`.
 *
 * Specta-команды возвращают `Promise<Result<T, E>>`, где
 *   Result = { status: 'ok'; data: T } | { status: 'error'; error: E }.
 * `unwrap()` разворачивает удачный результат и БРОСАЕТ на ошибке — это 1:1 поведение
 * старого `window.electronAPI.invoke(...)` (он реджектил промис при Err из Rust),
 * поэтому существующие call-sites переписываются в одну строку без правки обработки ошибок.
 *
 * Где нужна явная обработка (не бросать) — не используйте unwrap, а проверяйте `r.status`.
 */
import { commands, type Result } from '@/bindings';

export { commands };

export function unwrap<T>(r: Result<T, string>): T {
	if (r.status === 'error') throw new Error(String(r.error));
	return r.data;
}
