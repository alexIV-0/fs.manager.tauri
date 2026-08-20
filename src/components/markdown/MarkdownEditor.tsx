/**
 * Редактор описания. Два режима, одна панель кнопок:
 *
 *   • `rich` (по умолчанию) — правка сразу в отрисованном виде (Tiptap/ProseMirror);
 *   • `md` — текст markdown слева, превью справа.
 *
 * Почему не `contentEditable` поверх превью: браузер на каждый Enter и вставку
 * рожает свои `div`/`br`/`span style`, и обратное превращение в markdown теряет
 * структуру. Поэтому WYSIWYG стоит на модели документа, а markdown получается
 * сериализацией (`markdownSerialize.ts`); обратно документ собирается из HTML
 * (`markdownToHtml.ts`).
 *
 * Источник истины — строка markdown (`md`). В режиме `md` её ведёт наша история
 * правок, в режиме `rich` — документ Tiptap, и на каждое изменение она
 * пересобирается. При переключении режима значение переносится через markdown, а
 * не через внутренние структуры: так проверяется, что формат ничего не теряет.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, TextField } from '@mui/material';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import clipboard from 'tauri-plugin-clipboard-api';
import { readText as readClipboardText } from '@tauri-apps/plugin-clipboard-manager';
import { greyColor } from '@/Store/Color/grayColor';
import { commands, unwrap } from '@/Utils/specta';
import MarkdownView, { markdownProseSx } from './MarkdownView';
import MarkdownToolbar, { type ViewMode } from './MarkdownToolbar';
import { useMarkdownHistory } from './useMarkdownHistory';
import { prepareImage } from './prepareImage';
import { DESCRIPTION_SIZE_WARN } from './markdownFormat';
import { createTextApi } from './editorApi';
import { useDescriptionFontSize } from './useDescriptionFontSize';
import { createTiptapApi } from './tiptapApi';
import { docToMarkdown, type DocNode } from './markdownSerialize';
import { markdownToEditorHtml } from './markdownToHtml';
import { BlockAttrs, Details, DetailsSummary, DescTableCell, DescTableHeader, DescTaskItem, DescTaskList, TextColor } from './tiptapExtensions';
import type { TextState } from './markdownCommands';

interface MarkdownEditorProps {
	value: string;
	onChange: (v: string) => void;
	/** Меняется, когда содержимое пришло извне (загрузка файла) — сбрасывает историю. */
	loadKey?: number | string;
	minHeight?: number | string;
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'];

/** `data:...;base64,...` → Blob, без fetch (CSP на `data:` может не пустить). */
function dataUrlToBlob(dataUrl: string): Blob {
	const [head, b64] = dataUrl.split(',');
	const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
	return new Blob([bytes], { type: mime });
}

const formatBytes = (n: number): string => {
	if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} МБ`;
	if (n >= 1024) return `${Math.round(n / 1024)} КБ`;
	return `${n} Б`;
};

export function MarkdownEditor({ value, onChange, loadKey, minHeight = 420 }: MarkdownEditorProps) {
	const [mode, setMode] = useState<ViewMode>('rich');
	const [narrow, setNarrow] = useState(false);
	// Базовый размер: заголовки и подписи заданы в `em`, поэтому тянутся за ним.
	const [fontSize, setFontSize] = useDescriptionFontSize();
	const [busy, setBusy] = useState(false);
	const [md, setMd] = useState(value);
	const mdRef = useRef(value);

	const history = useMarkdownHistory(value);
	const taRef = useRef<HTMLTextAreaElement | null>(null);
	const serializeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Диалоги вставки
	const [linkOpen, setLinkOpen] = useState(false);
	const [linkText, setLinkText] = useState('');
	const [linkUrl, setLinkUrl] = useState('');
	const [tableOpen, setTableOpen] = useState(false);
	const [cols, setCols] = useState(3);
	const [rows, setRows] = useState(2);
	const [header, setHeader] = useState(true);
	const [codeOpen, setCodeOpen] = useState(false);
	const [codeLang, setCodeLang] = useState('ts');

	const setMarkdown = useCallback((next: string) => {
		mdRef.current = next;
		setMd(next);
	}, []);

	const editor = useEditor({
		// Без этого кнопки не подсвечивались бы: React не знал бы о смене выделения.
		shouldRerenderOnTransaction: true,
		extensions: [
			StarterKit.configure({
				link: { openOnClick: false, autolink: true },
				codeBlock: { languageClassPrefix: 'language-' },
			}),
			Highlight.configure({ multicolor: false }),
			Image.configure({ allowBase64: true }),
			TableKit.configure({
				table: { resizable: false },
				tableHeader: false,
				tableCell: false,
			}),
			DescTableHeader,
			DescTableCell,
			DescTaskList,
			DescTaskItem.configure({ nested: true }),
			TextColor,
			BlockAttrs,
			Details,
			DetailsSummary,
		],
		content: '',
		onUpdate: ({ editor: ed }) => {
			// Пересборка markdown дебаунсом: на большом описании с картинками
			// сериализовать на каждое нажатие клавиши дорого.
			if (serializeTimer.current) clearTimeout(serializeTimer.current);
			serializeTimer.current = setTimeout(() => {
				serializeTimer.current = null;
				setMarkdown(docToMarkdown(ed.getJSON() as DocNode));
			}, 250);
		},
	});

	// ── Загрузка файла и переключение режимов ────────────────────────────────

	/** Положить markdown в документ редактора, не вызывая onUpdate. */
	const loadIntoEditor = useCallback(
		(text: string) => {
			if (!editor) return;
			editor.commands.setContent(markdownToEditorHtml(text), { emitUpdate: false });
		},
		[editor],
	);

	useEffect(() => {
		setMarkdown(value);
		history.reset(value);
		if (mode === 'rich') loadIntoEditor(value);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loadKey, editor]);

	const switchMode = useCallback(
		(next: ViewMode) => {
			if (next === mode) return;
			if (next === 'rich') {
				// Из текста в документ — через markdown, как и при загрузке файла.
				loadIntoEditor(mdRef.current);
			} else {
				// Из документа в текст: додавливаем незавершённую сериализацию.
				if (serializeTimer.current && editor) {
					clearTimeout(serializeTimer.current);
					serializeTimer.current = null;
					const text = docToMarkdown(editor.getJSON() as DocNode);
					mdRef.current = text;
					setMd(text);
					history.reset(text);
				} else {
					history.reset(mdRef.current);
				}
			}
			setMode(next);
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[mode, editor, loadIntoEditor],
	);

	// Текст из истории — источник истины в режиме `md`.
	useEffect(() => {
		if (mode === 'md') setMarkdown(history.state.value);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [history.state.value, mode]);

	// Наружу отдаём только markdown.
	useEffect(() => {
		onChange(md);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [md]);

	// После команды или отмены возвращаем выделение в текстовое поле.
	useEffect(() => {
		if (mode !== 'md') return;
		const ta = taRef.current;
		if (!ta) return;
		ta.focus();
		ta.setSelectionRange(history.state.selStart, history.state.selEnd);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [history.syncKey]);

	// ── Панель кнопок ───────────────────────────────────────────────────────

	const readState = useCallback((): TextState => {
		const ta = taRef.current;
		return {
			value: history.state.value,
			selStart: ta ? ta.selectionStart : history.state.selStart,
			selEnd: ta ? ta.selectionEnd : history.state.selEnd,
		};
	}, [history.state]);

	const applyText = useCallback(
		(fn: (s: TextState) => TextState) => {
			history.commit(fn(readState()));
		},
		[history, readState],
	);

	const api = useMemo(
		() => (mode === 'rich' ? createTiptapApi(editor) : createTextApi(applyText, readState)),
		[mode, editor, applyText, readState],
	);

	const undo = useCallback(() => {
		if (mode === 'rich') editor?.chain().focus().undo().run();
		else history.undo();
	}, [mode, editor, history]);

	const redo = useCallback(() => {
		if (mode === 'rich') editor?.chain().focus().redo().run();
		else history.redo();
	}, [mode, editor, history]);

	const canUndo = mode === 'rich' ? Boolean(editor?.can().undo()) : history.canUndo;
	const canRedo = mode === 'rich' ? Boolean(editor?.can().redo()) : history.canRedo;

	// ── Картинки ────────────────────────────────────────────────────────────

	const insertBlob = useCallback(
		async (blob: Blob, alt: string) => {
			setBusy(true);
			try {
				const img = await prepareImage(blob);
				api.image(alt, img.dataUrl);
			} catch (err) {
				window.alert(`Не удалось вставить картинку:\n${String(err)}`);
			} finally {
				setBusy(false);
			}
		},
		[api],
	);

	const pickImage = useCallback(async () => {
		const paths = unwrap(
			await commands.selectFiles({ multiSelect: false, filters: [{ name: 'Картинки', extensions: IMAGE_EXTS }] }),
		);
		const path = paths?.[0];
		if (!path) return;
		// read_media_preview отдаёт готовый data-URI для картинок — читать байты
		// отдельной командой не нужно.
		const dataUrl = unwrap(await commands.readMediaPreview(path));
		if (!dataUrl) {
			window.alert('Не удалось прочитать картинку');
			return;
		}
		const name = path.split(/[\\/]/).pop() ?? 'картинка';
		await insertBlob(dataUrlToBlob(dataUrl), name.replace(/\.[^.]+$/, ''));
	}, [insertBlob]);

	/**
	 * Вставка картинки из буфера. Два пути: HTML-буфер срабатывает, когда
	 * копировали внутри webview, а системный скриншот в него не попадает вообще —
	 * его достаём плагином буфера Tauri (права в capabilities/default.json).
	 */
	const handleImagePaste = useCallback(
		async (data: DataTransfer | null): Promise<boolean> => {
			const file = Array.from(data?.files ?? []).find((f) => f.type.startsWith('image/'));
			if (file) {
				await insertBlob(file, 'вставка');
				return true;
			}
			try {
				if (await clipboard.hasImage()) {
					const blob = (await clipboard.readImageBinary('Blob')) as Blob;
					await insertBlob(blob, 'вставка');
					return true;
				}
			} catch {
				// картинки в буфере нет — обычная текстовая вставка идёт своим ходом
			}
			return false;
		},
		[insertBlob],
	);

	// В WYSIWYG перехватываем вставку на уровне ProseMirror.
	useEffect(() => {
		if (!editor) return;
		const dom = editor.view.dom;
		const onPaste = (e: ClipboardEvent) => {
			const hasImage = Array.from(e.clipboardData?.files ?? []).some((f) => f.type.startsWith('image/'));
			// Отменяем вставку только когда картинка видна синхронно. Системный
			// скриншот в `clipboardData` не попадает вообще, о нём узнаём асинхронно —
			// и обычная вставка в этом случае всё равно пустая, отменять нечего.
			if (hasImage) e.preventDefault();
			void handleImagePaste(e.clipboardData);
		};
		dom.addEventListener('paste', onPaste);
		return () => dom.removeEventListener('paste', onPaste);
	}, [editor, handleImagePaste]);

	const openLink = useCallback(async () => {
		setLinkText(api.selection());
		let url = '';
		try {
			const text = (await readClipboardText()) ?? '';
			if (/^(https?:\/\/|mailto:)/i.test(text.trim())) url = text.trim();
		} catch {
			// буфер недоступен — поле останется пустым
		}
		setLinkUrl(url);
		setLinkOpen(true);
	}, [api]);

	// ── Горячие клавиши текстового режима ───────────────────────────────────

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			const mod = e.metaKey || e.ctrlKey;
			if (!mod) {
				if (e.key === 'Tab') {
					e.preventDefault();
					api.indent(e.shiftKey ? -1 : 1);
				}
				return;
			}
			const k = e.key.toLowerCase();
			if (k === 'z' && !e.shiftKey) {
				e.preventDefault();
				undo();
			} else if ((k === 'z' && e.shiftKey) || k === 'y') {
				e.preventDefault();
				redo();
			} else if (k === 'b') {
				e.preventDefault();
				api.bold();
			} else if (k === 'i') {
				e.preventDefault();
				api.italic();
			} else if (k === 'u') {
				e.preventDefault();
				api.underline();
			} else if (k === 'e') {
				e.preventDefault();
				api.inlineCode();
			} else if (k === 'k') {
				e.preventDefault();
				void openLink();
			}
		},
		[api, undo, redo, openLink],
	);

	const bytes = new TextEncoder().encode(md).length;
	const sizeWarn = bytes > DESCRIPTION_SIZE_WARN;
	const gray30 = greyColor(30);

	const richCanvas = (
		<Box
			sx={{
				flex: 1,
				minWidth: 0,
				overflow: 'auto',
				display: 'flex',
				justifyContent: narrow ? 'center' : 'flex-start',
				backgroundColor: greyColor(14),
				'& .ProseMirror': {
					...markdownProseSx(narrow ? 380 : 820, fontSize),
					width: narrow ? 380 : '100%',
					minHeight: '100%',
					padding: '12px 16px',
					outline: 'none',
				},
				// Служебное оформление полотна: в превью этого нет и быть не должно.
				'& .ProseMirror table': { minWidth: '360px' },
				'& .ProseMirror .selectedCell:after': {
					content: '""',
					position: 'absolute',
					inset: 0,
					backgroundColor: '#89b4fa22',
					pointerEvents: 'none',
				},
				'& .ProseMirror td, & .ProseMirror th': { position: 'relative' },
			}}
		>
			<EditorContent editor={editor} style={{ width: '100%', display: 'flex', justifyContent: narrow ? 'center' : 'flex-start' }} />
		</Box>
	);

	const textArea = (
		<textarea
			ref={taRef}
			spellCheck={false}
			value={history.state.value}
			onChange={(e) => history.type({ value: e.target.value, selStart: e.target.selectionStart, selEnd: e.target.selectionEnd })}
			onKeyDown={handleKeyDown}
			onPaste={(e) => {
				const hasImage = Array.from(e.clipboardData?.files ?? []).some((f) => f.type.startsWith('image/'));
				if (hasImage) e.preventDefault();
				void handleImagePaste(e.clipboardData);
			}}
			placeholder='Описание проекта. Здесь виден сам markdown — тот же текст, что уедет на сайт.'
			style={{
				flex: 1,
				minWidth: 0,
				resize: 'none',
				border: 'none',
				outline: 'none',
				padding: '10px 12px',
				backgroundColor: greyColor(12),
				color: greyColor(85),
				fontFamily: 'monospace',
				fontSize: Math.max(12, fontSize - 2),
				lineHeight: 1.55,
				tabSize: 2,
			}}
		/>
	);

	const preview = (
		<Box
			sx={{
				flex: 1,
				minWidth: 0,
				overflow: 'auto',
				borderLeft: `1px solid ${gray30}`,
				display: 'flex',
				justifyContent: narrow ? 'center' : 'flex-start',
				backgroundColor: greyColor(14),
			}}
		>
			<Box sx={{ width: narrow ? 380 : '100%', maxWidth: '100%', p: '10px 14px' }}>
				<MarkdownView maxWidth={narrow ? 380 : 820} fontSize={fontSize}>
					{md}
				</MarkdownView>
			</Box>
		</Box>
	);

	return (
		<Box
			sx={{
				display: 'flex',
				flexDirection: 'column',
				minHeight,
				height: '100%',
				border: `1px solid ${gray30}`,
				borderRadius: '4px',
				overflow: 'hidden',
			}}
		>
			<MarkdownToolbar
				api={api}
				onLink={openLink}
				onImage={pickImage}
				onTable={() => setTableOpen(true)}
				onCodeBlock={() => setCodeOpen(true)}
				undo={undo}
				redo={redo}
				canUndo={canUndo}
				canRedo={canRedo}
				mode={mode}
				setMode={switchMode}
				narrow={narrow}
				setNarrow={setNarrow}
				fontSize={fontSize}
				setFontSize={setFontSize}
				sizeText={busy ? 'обработка картинки…' : formatBytes(bytes)}
				sizeWarn={sizeWarn}
			/>

			<Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
				{mode === 'rich' ? (
					richCanvas
				) : (
					<>
						{textArea}
						{preview}
					</>
				)}
			</Box>

			{/* Ссылка */}
			<Dialog open={linkOpen} onClose={() => setLinkOpen(false)} maxWidth='sm' fullWidth>
				<DialogTitle sx={{ fontSize: 14 }}>Ссылка</DialogTitle>
				<DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
					<TextField label='Текст' size='small' value={linkText} onChange={(e) => setLinkText(e.target.value)} autoFocus />
					<TextField label='Адрес' size='small' value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder='https://' />
				</DialogContent>
				<DialogActions>
					<Button size='small' onClick={() => setLinkOpen(false)}>
						Отмена
					</Button>
					<Button
						size='small'
						variant='contained'
						disabled={!linkUrl.trim()}
						onClick={() => {
							api.link(linkText.trim(), linkUrl.trim());
							setLinkOpen(false);
						}}
					>
						Вставить
					</Button>
				</DialogActions>
			</Dialog>

			{/* Таблица */}
			<Dialog open={tableOpen} onClose={() => setTableOpen(false)}>
				<DialogTitle sx={{ fontSize: 14 }}>Таблица</DialogTitle>
				<DialogContent sx={{ display: 'flex', gap: 2, alignItems: 'center', pt: 1 }}>
					<TextField
						label='Столбцов'
						size='small'
						type='number'
						value={cols}
						onChange={(e) => setCols(Number(e.target.value))}
						sx={{ width: 110 }}
					/>
					<TextField
						label='Строк'
						size='small'
						type='number'
						value={rows}
						onChange={(e) => setRows(Number(e.target.value))}
						sx={{ width: 110 }}
					/>
					<FormControlLabel
						control={<Checkbox size='small' checked={header} onChange={(e) => setHeader(e.target.checked)} />}
						label='Шапка'
					/>
				</DialogContent>
				<DialogActions>
					<Button size='small' onClick={() => setTableOpen(false)}>
						Отмена
					</Button>
					<Button
						size='small'
						variant='contained'
						onClick={() => {
							api.table(cols, rows, header);
							setTableOpen(false);
						}}
					>
						Вставить
					</Button>
				</DialogActions>
			</Dialog>

			{/* Блок кода */}
			<Dialog open={codeOpen} onClose={() => setCodeOpen(false)}>
				<DialogTitle sx={{ fontSize: 14 }}>Блок кода</DialogTitle>
				<DialogContent sx={{ pt: 1 }}>
					<TextField
						label='Язык'
						size='small'
						value={codeLang}
						onChange={(e) => setCodeLang(e.target.value)}
						placeholder='ts, json, bash…'
						autoFocus
					/>
				</DialogContent>
				<DialogActions>
					<Button size='small' onClick={() => setCodeOpen(false)}>
						Отмена
					</Button>
					<Button
						size='small'
						variant='contained'
						onClick={() => {
							api.codeBlock(codeLang.trim());
							setCodeOpen(false);
						}}
					>
						Вставить
					</Button>
				</DialogActions>
			</Dialog>
		</Box>
	);
}

export default MarkdownEditor;
