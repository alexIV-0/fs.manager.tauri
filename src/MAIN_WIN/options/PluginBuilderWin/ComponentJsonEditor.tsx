// ComponentJsonEditor — Monaco JSON view/editor for the currently selected
// builder target (the node itself, or a single property/component).
//
// Two-way live binding:
//   • user types valid JSON here  → onValidChange(parsed) → node + structured panel update
//   • structured panel edits value → mirrored back here (only while NOT focused, so the
//                                     caret is never clobbered mid-typing)
//   • invalid JSON                 → red error strip, no update pushed
//
// Reuses the app-wide Monaco setup (blank worker + Tauri clipboard), same as
// NODE_WIN/nodes/properties/TextEditProperty.tsx.

import { useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { AlertCircle } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import { registerMonacoClipboard } from '@/Utils/monacoClipboard';

interface ComponentJsonEditorProps {
	/** Stable identity of the edited object. Changing it force-resets the editor
	 *  (node ↔ property, or a different property id). */
	editorKey: string;
	/** Object to display/edit as JSON. */
	value: unknown;
	/** Called with the parsed object on every keystroke that yields valid JSON. */
	onValidChange: (parsed: any) => void;
}

function toJson(v: unknown): string {
	try {
		return JSON.stringify(v, null, 2);
	} catch {
		return '';
	}
}

/** Semantic equality — ignores whitespace/key-order differences. */
function jsonEqual(a: string, b: string): boolean {
	if (a === b) return true;
	try {
		return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
	} catch {
		return false;
	}
}

export function ComponentJsonEditor({ editorKey, value, onValidChange }: ComponentJsonEditorProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const monacoRef = useRef<any>(null);
	const editorInst = useRef<any>(null);
	const isFocused = useRef(false);
	const suppress = useRef(false); // guards programmatic setValue from re-emitting
	const onChangeRef = useRef(onValidChange);
	const [ready, setReady] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const gray12 = greyColor(12);
	const gray40 = greyColor(40);

	useEffect(() => {
		onChangeRef.current = onValidChange;
	}, [onValidChange]);

	// ── Init + mount editor once ──
	useEffect(() => {
		let disposed = false;
		(async () => {
			const monaco = await import('monaco-editor');
			if (disposed) return;
			monacoRef.current = monaco;
			(self as any).MonacoEnvironment = {
				getWorker: () => {
					const blob = new Blob([''], { type: 'application/javascript' });
					return new Worker(URL.createObjectURL(blob));
				},
			};
			if (!containerRef.current || editorInst.current) return;
			const editor = monaco.editor.create(containerRef.current, {
				value: toJson(value),
				language: 'json',
				theme: 'vs-dark',
				fontSize: 12,
				minimap: { enabled: false },
				scrollBeyondLastLine: false,
				wordWrap: 'on',
				lineNumbers: 'on',
				folding: true,
				automaticLayout: true,
				tabSize: 2,
				renderLineHighlight: 'none',
				scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
			});
			editorInst.current = editor;

			editor.onDidChangeModelContent(() => {
				if (suppress.current) return;
				const txt = editor.getValue();
				try {
					const parsed = JSON.parse(txt);
					setError(null);
					if (parsed && typeof parsed === 'object') onChangeRef.current(parsed);
				} catch (e: any) {
					setError(e?.message ?? 'Invalid JSON');
				}
			});
			editor.onDidFocusEditorText(() => {
				isFocused.current = true;
			});
			editor.onDidBlurEditorText(() => {
				isFocused.current = false;
			});

			// WKWebView не отдаёт Monaco системный буфер — регистрируем copy/cut/paste вручную.
			registerMonacoClipboard(editor, monaco);
			setReady(true);
		})();
		return () => {
			disposed = true;
			if (editorInst.current) {
				editorInst.current.dispose();
				editorInst.current = null;
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// ── Selection switched → force-reset to the new target's JSON ──
	// Skip while focused: a key change during typing means the user renamed `id`
	// in-place, so we must not clobber their caret.
	useEffect(() => {
		const editor = editorInst.current;
		if (!editor || !ready) return;
		if (isFocused.current) return;
		suppress.current = true;
		editor.setValue(toJson(value));
		suppress.current = false;
		setError(null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editorKey, ready]);

	// ── External edit (structured panel) on the same target → mirror in ──
	useEffect(() => {
		const editor = editorInst.current;
		if (!editor || !ready) return;
		if (isFocused.current) return; // user is editing here — leave it alone
		const text = toJson(value);
		if (jsonEqual(editor.getValue(), text)) return;
		suppress.current = true;
		editor.setValue(text);
		suppress.current = false;
		setError(null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value, ready]);

	return (
		<Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: gray12, minHeight: 0 }}>
			{/* Header */}
			<Box
				sx={{
					px: 1.5,
					py: 0.5,
					flexShrink: 0,
					borderTop: `1px solid ${gray40}`,
					borderBottom: `1px solid ${gray40}`,
					display: 'flex',
					alignItems: 'center',
					gap: 0.75,
				}}
			>
				<Box component='span' sx={{ color: '#89b4fa', fontFamily: 'monospace', fontSize: 11 }}>
					json
				</Box>
				{error && (
					<>
						<AlertCircle size={12} color='#ef5350' style={{ marginLeft: 'auto' }} />
						<Typography variant='caption' sx={{ color: '#ef5350', fontSize: 10, fontFamily: 'monospace', maxWidth: '70%' }} noWrap>
							{error}
						</Typography>
					</>
				)}
			</Box>
			{/* Editor */}
			<Box ref={containerRef} sx={{ flex: 1, minHeight: 0 }} />
		</Box>
	);
}
