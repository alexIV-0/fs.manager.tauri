import { useEffect, useRef, useState } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';

const WINDOW_W = 900;
const WINDOW_H = 620;
const HEADER_H = 36;

function detectLanguage(filePath: string): string {
	const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
	switch (ext) {
		case 'json': return 'json';
		case 'js':
		case 'jsx': return 'javascript';
		case 'ts':
		case 'tsx': return 'typescript';
		case 'py': return 'python';
		case 'css':
		case 'scss':
		case 'less': return 'css';
		case 'html':
		case 'htm': return 'html';
		case 'xml': return 'xml';
		case 'yaml':
		case 'yml': return 'yaml';
		case 'sql': return 'sql';
		case 'sh':
		case 'bash':
		case 'zsh': return 'shell';
		default: return 'plaintext';
	}
}

function getFileName(filePath: string): string {
	return filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
}

export function TextPreview({ filePath }: { filePath: string }) {
	const editorRef = useRef<HTMLDivElement>(null);
	const editorInstRef = useRef<any>(null);
	const handleSaveRef = useRef<() => void>(() => {});
	const [modified, setModified] = useState(false);
	const fileName = getFileName(filePath);
	const language = detectLanguage(filePath);

	useEffect(() => {
		setModified(false);

		window.electronAPI.invoke('preview:resize', {
			width: WINDOW_W,
			height: WINDOW_H,
		});

		let disposed = false;

		const init = async () => {
			const content = ((await window.electronAPI.invoke('readFileSync', filePath)) as string) ?? '';
			if (disposed) return;

			const monaco = await import('monaco-editor');
			if (disposed) return;

			(self as any).MonacoEnvironment = {
				getWorker: () => {
					const blob = new Blob([''], { type: 'application/javascript' });
					return new Worker(URL.createObjectURL(blob));
				},
			};

			if (editorRef.current && !editorInstRef.current) {
				editorInstRef.current = monaco.editor.create(editorRef.current, {
					value: content,
					language: detectLanguage(filePath),
					theme: 'vs-dark',
					fontSize: 13,
					minimap: { enabled: false },
					scrollBeyondLastLine: false,
					wordWrap: 'on',
					automaticLayout: true,
					tabSize: 2,
					lineNumbers: 'on',
				});

				editorInstRef.current.onDidChangeModelContent(() => {
					if (!disposed) setModified(true);
				});

				// Ctrl+S внутри редактора — обходит React stopPropagation на обёртке
				editorInstRef.current.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
					handleSaveRef.current?.();
				});

				// F12 — открыть DevTools, когда фокус в Monaco (иначе stopPropagation глушит)
				editorInstRef.current.addCommand(monaco.KeyCode.F12, () => {
					window.electronAPI.openDevTools();
				});

				// Esc — закрыть окно превью, когда фокус в Monaco.
				// Monaco по умолчанию ловит Esc для своих виджетов (Find), поэтому
				// глобальный useKeyboardShortcut в PreviewApp не сработает при фокусе в редакторе.
				editorInstRef.current.addCommand(monaco.KeyCode.Escape, () => {
					getCurrentWebviewWindow().close().catch(() => {});
				});
			}
		};

		init();

		return () => {
			disposed = true;
			editorInstRef.current?.dispose();
			editorInstRef.current = null;
		};
	}, [filePath]);

	const handleSave = async () => {
		if (!editorInstRef.current || !modified) return;
		const content = editorInstRef.current.getValue();
		const result = (await window.electronAPI.invoke('writeFile', filePath, content)) as
			| { success?: boolean; error?: string }
			| undefined;
		if (result && 'error' in result && result.error) {
			console.error('[TextPreview] writeFile failed:', result.error, '\n  path:', filePath);
			return;
		}
		setModified(false);
	};

	handleSaveRef.current = handleSave;

	// Глобальный Ctrl+S — на случай, если фокус не в редакторе (например, на кнопке Save).
	// Внутри редактора Ctrl+S перехватывается через editor.addCommand выше.
	useKeyboardShortcut({
		key: 's',
		modifiers: { ctrlOrMeta: true },
		skipOnInput: false,
		callback: (e) => { e.preventDefault(); handleSave(); },
	});

	const langBadge: React.CSSProperties = {
		fontSize: 11,
		fontFamily: 'monospace',
		color: '#555',
		background: '#1a1a1a',
		border: '1px solid #2a2a2a',
		borderRadius: 3,
		padding: '1px 6px',
		flexShrink: 0,
	};

	const btnSave: React.CSSProperties = {
		padding: '2px 12px',
		borderRadius: 3,
		fontSize: 11,
		cursor: 'pointer',
		outline: 'none',
		border: '1px solid #3a6a3a',
		background: '#2a4a2a',
		color: '#8fc88f',
		flexShrink: 0,
		WebkitAppRegion: 'no-drag',
	} as React.CSSProperties;

	return (
		<div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#1e1e1e' }}>
			{/* Заголовок */}
			<div
				style={{
					height: HEADER_H,
					background: '#252526',
					display: 'flex',
					alignItems: 'center',
					padding: '0 44px 0 12px',
					gap: 8,
					borderBottom: '1px solid #333',
					flexShrink: 0,
					position: 'relative',
					zIndex: 1002,
					WebkitAppRegion: 'no-drag',
				} as any}
			>
				{/* Слева: имя файла + маркер изменений (занимает всё доступное пространство) */}
				<span
					style={{
						color: '#ccc',
						fontSize: 13,
						flex: 1,
						fontFamily: 'monospace',
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
					}}
				>
					{fileName}
					{modified && <span style={{ color: '#f0a070', marginLeft: 6 }}>●</span>}
				</span>

				{/* Справа: Save (если есть несохранённые) → язык файла у самого края */}
				{modified && (
					<button onClick={handleSave} style={btnSave}>
						Save
					</button>
				)}
				<span style={langBadge}>{language}</span>
			</div>

			{/* Monaco Editor */}
			<div
				ref={editorRef}
				style={{ flex: 1, overflow: 'hidden' }}
				onKeyDown={(e) => e.stopPropagation()}
				onKeyUp={(e) => e.stopPropagation()}
			/>
		</div>
	);
}
