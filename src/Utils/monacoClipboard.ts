/**
 * Буфер обмена для Monaco в WKWebView (Tauri/macOS).
 *
 * Системные copy/paste API в WKWebView заблокированы (нет нативного Edit-меню в
 * responder chain), а глобальный `enableTextFieldShortcuts` намеренно НЕ трогает
 * цели внутри `.monaco-editor` (его inputarea — мусорный IME-буфер, запись в него
 * не попадает в модель). Поэтому каждый редактор обязан сам зарегистрировать
 * clipboard-команды: гоняем текст через плагин буфера Tauri прямо в модель.
 * Так корректно работают и Cmd+C/X/V, и внешние утилиты (carambaSwitcher и т.п.),
 * использующие тот же системный буфер.
 *
 * Вызывать сразу после `monaco.editor.create(...)`.
 *
 * @param editor инстанс из `monaco.editor.create`
 * @param monaco результат `await import('monaco-editor')`
 */
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';

export function registerMonacoClipboard(editor: any, monaco: any): void {
	const copySelection = (): boolean => {
		const sel = editor.getSelection();
		const model = editor.getModel();
		if (!sel || !model || sel.isEmpty()) return false;
		writeText(model.getValueInRange(sel)).catch(() => {});
		return true;
	};

	// Cmd/Ctrl+C — копировать выделение в системный буфер
	editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, () => {
		copySelection();
	});

	// Cmd/Ctrl+X — вырезать выделение
	editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX, () => {
		const sel = editor.getSelection();
		if (!copySelection() || !sel) return;
		editor.executeEdits('clipboard-cut', [{ range: sel, text: '', forceMoveMarkers: true }]);
		editor.pushUndoStop();
	});

	// Cmd/Ctrl+V — вставить из системного буфера в позицию курсора/выделение
	editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, () => {
		readText()
			.then((text) => {
				if (text == null || text === '') return;
				const sel = editor.getSelection();
				if (!sel) return;
				editor.executeEdits('clipboard-paste', [{ range: sel, text, forceMoveMarkers: true }]);
				editor.pushUndoStop();
				editor.focus();
			})
			.catch(() => {});
	});
}
