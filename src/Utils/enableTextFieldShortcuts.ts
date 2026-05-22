/**
 * Tauri v2 + macOS WKWebView: clipboard shortcuts (Cmd+C/V/X/A) do not work
 * natively in text fields because WKWebView routes them through the macOS
 * responder chain which requires a native Edit menu. In Electron this worked
 * out-of-the-box because Chromium handles it internally.
 *
 * Fix: intercept those shortcuts in the capture phase and execute clipboard
 * operations via tauri-plugin-clipboard-manager (no permission dialogs) and
 * standard execCommand / Selection APIs.
 *
 * Covered elements:
 *   - INPUT / TEXTAREA   – full C/V/X/A support
 *   - contentEditable    – V and X only (Monaco handles C on its own)
 */

import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';

export function enableTextFieldShortcuts(): void {
	if (typeof document === 'undefined') return;
	document.addEventListener('keydown', handleShortcut, true);
}

// ── helpers ─────────────────────────────────────────────────────────────────

type InputEl = HTMLInputElement | HTMLTextAreaElement;

function isInput(el: EventTarget | null): el is InputEl {
	if (!(el instanceof HTMLElement)) return false;
	return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

function isContentEditable(el: EventTarget | null): el is HTMLElement {
	return el instanceof HTMLElement && el.isContentEditable;
}

/** Sets value via native setter so React's synthetic onChange fires. */
function setInputValue(input: InputEl, value: string): void {
	const proto =
		input instanceof HTMLTextAreaElement
			? HTMLTextAreaElement.prototype
			: HTMLInputElement.prototype;
	const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
	setter ? setter.call(input, value) : (input.value = value);
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

// ── main handler ─────────────────────────────────────────────────────────────

function handleShortcut(e: KeyboardEvent): void {
	if (!e.metaKey && !e.ctrlKey) return;

	if (isInput(e.target)) {
		handleInput(e, e.target);
	} else if (isContentEditable(e.target)) {
		handleContentEditable(e, e.target);
	}
}

// ── INPUT / TEXTAREA ─────────────────────────────────────────────────────────

function handleInput(e: KeyboardEvent, el: InputEl): void {
	switch (e.key.toLowerCase()) {
		case 'a':
			e.preventDefault();
			el.select();
			break;

		case 'c':
			// execCommand('copy') writes the selection to the system clipboard
			// without any permission dialog — safe to call directly.
			e.preventDefault();
			document.execCommand('copy');
			break;

		case 'x':
			e.preventDefault();
			cutInput(el);
			break;

		case 'v':
			e.preventDefault();
			pasteIntoInput(el);
			break;
	}
}

function cutInput(el: InputEl): void {
	const start = el.selectionStart ?? 0;
	const end   = el.selectionEnd   ?? 0;
	if (start === end) return;

	const selected = el.value.substring(start, end);
	// writeText never triggers a permission dialog.
	writeText(selected).catch(() => {/* ignore */});

	const newValue = el.value.substring(0, start) + el.value.substring(end);
	setInputValue(el, newValue);
	el.selectionStart = el.selectionEnd = start;
}

async function pasteIntoInput(el: InputEl): Promise<void> {
	let text: string;
	try {
		text = await readText();
	} catch {
		return;
	}
	const start = el.selectionStart ?? 0;
	const end   = el.selectionEnd   ?? 0;
	const newValue =
		el.value.substring(0, start) + text + el.value.substring(end);
	setInputValue(el, newValue);
	el.selectionStart = el.selectionEnd = start + text.length;
}

// ── contentEditable (Monaco) ──────────────────────────────────────────────────

function handleContentEditable(e: KeyboardEvent, el: HTMLElement): void {
	switch (e.key.toLowerCase()) {
		case 'x':
			e.preventDefault();
			cutContentEditable(el);
			break;

		case 'v':
			e.preventDefault();
			pasteIntoContentEditable();
			break;

		// 'c' and 'a': Monaco handles these natively — do not intercept.
	}
}

function cutContentEditable(el: HTMLElement): void {
	const selection = window.getSelection();
	if (!selection || selection.isCollapsed) return;

	const selected = selection.toString();
	writeText(selected).catch(() => {/* ignore */});

	// Remove the selected range from the DOM.
	// execCommand('delete') works for contentEditable in WebKit without
	// needing any OS-level menu item.
	document.execCommand('delete');

	// Notify Monaco of the DOM change so its internal model syncs.
	el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function pasteIntoContentEditable(): Promise<void> {
	let text: string;
	try {
		text = await readText();
	} catch {
		return;
	}
	// insertText replaces the current selection (or inserts at cursor) in any
	// focused contentEditable element. Monaco picks up the DOM mutation and
	// syncs its internal model automatically.
	document.execCommand('insertText', false, text);
}
