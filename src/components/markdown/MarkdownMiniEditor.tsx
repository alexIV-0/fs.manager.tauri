/**
 * Упрощённый редактор markdown для ПОДСКАЗОК свойств нод.
 *
 * Зачем отдельный, а не `MarkdownEditor`: подсказка — две-три строки текста в
 * маленьком поповере, а большой редактор несёт таблицы, картинки, спойлеры,
 * выравнивание, блок-схемы и WYSIWYG на Tiptap. Показывать этот арсенал там,
 * где формат сознательно урезан до текста, цвета и списков
 * (`tooltipSanitizeSchema`), значило бы предлагать кнопки, чей результат
 * санитайзер выбросит при показе.
 *
 * Что переиспользуется, а не копируется:
 *   • операции над текстом — чистые функции `markdownCommands` через
 *     `createTextApi` (тот же код, что и у большого редактора в текстовом режиме);
 *   • отмена/возврат и синхронизация выделения — `useMarkdownHistory`;
 *   • палитра цветов — `ColorPalette` из `MarkdownToolbar`;
 *   • превью — `MarkdownView variant='tooltip'`, то есть ровно то, что увидит
 *     человек в подсказке. «Как вижу» и «как покажется» не должны расходиться.
 *
 * Кнопки объявлены на уровне модуля (`ToolBtn`) по той же причине, что и в
 * большом тулбаре: компонент, созданный внутри рендера, каждый раз новый тип →
 * React размонтирует поддерево и `anchorEl` поповера указывает в пустоту.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Divider, IconButton, Popover, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { Bold, Code, Eraser, Highlighter, Italic, Link2, List, ListOrdered, Palette, Redo2, Underline, Undo2 } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import { createTextApi } from './editorApi';
import { useMarkdownHistory } from './useMarkdownHistory';
import { ColorPalette } from './MarkdownToolbar';
import MarkdownView from './MarkdownView';
import type { TextState } from './markdownCommands';

interface MarkdownMiniEditorProps {
	value: string;
	onChange: (v: string) => void;
	minRows?: number;
	maxRows?: number;
	placeholder?: string;
	autoFocus?: boolean;
	/** ⌘/Ctrl+Enter — «сохранить» вызывающей стороны (у поповера это закрытие с записью). */
	onSubmit?: () => void;
	onCancel?: () => void;
}

interface ToolBtnProps {
	title: string;
	icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
	onClick: (e: React.MouseEvent<HTMLElement>) => void;
	disabled?: boolean;
}

function ToolBtn({ title, icon: Icon, onClick, disabled }: ToolBtnProps) {
	return (
		<Tooltip title={title} arrow disableInteractive>
			<span>
				<IconButton
					size='small'
					disabled={disabled}
					// onMouseDown+preventDefault: click уводит фокус из поля и теряет выделение.
					onMouseDown={(e) => e.preventDefault()}
					onClick={onClick}
					sx={{ color: greyColor(65), p: '3px', '&:hover': { color: greyColor(85) } }}
				>
					<Icon size={15} strokeWidth={1.7} />
				</IconButton>
			</span>
		</Tooltip>
	);
}

export function MarkdownMiniEditor({
	value,
	onChange,
	minRows = 5,
	maxRows = 14,
	placeholder,
	autoFocus,
	onSubmit,
	onCancel,
}: MarkdownMiniEditorProps) {
	const history = useMarkdownHistory(value);
	const taRef = useRef<HTMLTextAreaElement | null>(null);
	const [colorAnchor, setColorAnchor] = useState<HTMLElement | null>(null);
	const [bgAnchor, setBgAnchor] = useState<HTMLElement | null>(null);
	const [linkAnchor, setLinkAnchor] = useState<HTMLElement | null>(null);
	const [linkText, setLinkText] = useState('');
	const [linkUrl, setLinkUrl] = useState('');

	const md = history.state.value;

	useEffect(() => {
		onChange(md);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [md]);

	// После команды или отмены возвращаем выделение в поле — иначе следующая
	// кнопка сработает по нулевой позиции.
	useEffect(() => {
		const ta = taRef.current;
		if (!ta) return;
		ta.focus();
		ta.setSelectionRange(history.state.selStart, history.state.selEnd);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [history.syncKey]);

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

	const api = useMemo(() => createTextApi(applyText, readState), [applyText, readState]);

	const openLink = (e: React.MouseEvent<HTMLElement>) => {
		setLinkText(api.selection());
		setLinkUrl('');
		setLinkAnchor(e.currentTarget);
	};

	const insertLink = () => {
		const url = linkUrl.trim();
		if (url) api.link(linkText.trim() || url, url);
		setLinkAnchor(null);
	};

	return (
		<Stack gap={0.75}>
			<Stack direction='row' alignItems='center' sx={{ flexWrap: 'wrap' }}>
				<ToolBtn title='Жирный' icon={Bold} onClick={api.bold} />
				<ToolBtn title='Курсив' icon={Italic} onClick={api.italic} />
				<ToolBtn title='Подчёркнутый' icon={Underline} onClick={api.underline} />
				<ToolBtn title='Код' icon={Code} onClick={api.inlineCode} />

				<Divider orientation='vertical' flexItem sx={{ mx: 0.5, my: 0.5 }} />

				<ToolBtn title='Цвет текста' icon={Palette} onClick={(e) => setColorAnchor(e.currentTarget)} />
				<ToolBtn title='Заливка' icon={Highlighter} onClick={(e) => setBgAnchor(e.currentTarget)} />

				<Divider orientation='vertical' flexItem sx={{ mx: 0.5, my: 0.5 }} />

				<ToolBtn title='Список' icon={List} onClick={() => api.list('ul')} />
				<ToolBtn title='Нумерованный список' icon={ListOrdered} onClick={() => api.list('ol')} />
				<ToolBtn title='Ссылка' icon={Link2} onClick={openLink} />
				<ToolBtn title='Убрать форматирование' icon={Eraser} onClick={api.clearFormat} />

				<Box sx={{ ml: 'auto', display: 'flex' }}>
					<ToolBtn title='Отменить' icon={Undo2} onClick={history.undo} disabled={!history.canUndo} />
					<ToolBtn title='Вернуть' icon={Redo2} onClick={history.redo} disabled={!history.canRedo} />
				</Box>
			</Stack>

			<TextField
				autoFocus={autoFocus}
				multiline
				minRows={minRows}
				maxRows={maxRows}
				value={md}
				inputRef={taRef}
				onChange={(e) =>
					history.commit({
						value: e.target.value,
						selStart: e.target.selectionStart ?? 0,
						selEnd: e.target.selectionEnd ?? 0,
					})
				}
				onKeyDown={(e) => {
					if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit?.();
					if (e.key === 'Escape') onCancel?.();
				}}
				placeholder={placeholder ?? 'Что делает это поле.\n\n**жирный**, `код`, - список'}
				sx={{ '& .MuiInputBase-input': { fontSize: 13, lineHeight: 1.5, color: greyColor(80), fontFamily: 'monospace' } }}
			/>

			{md.trim() ? (
				<Box>
					<Typography sx={{ fontSize: 10, color: greyColor(40), fontFamily: 'monospace', mb: 0.25 }}>
						как покажется
					</Typography>
					<Box
						sx={{
							border: `1px solid ${greyColor(24)}`,
							borderRadius: '4px',
							p: 1,
							maxHeight: 180,
							overflowY: 'auto',
							bgcolor: greyColor(10),
						}}
					>
						<MarkdownView variant='tooltip'>{md}</MarkdownView>
					</Box>
				</Box>
			) : null}

			<Popover
				open={Boolean(colorAnchor)}
				anchorEl={colorAnchor}
				onClose={() => setColorAnchor(null)}
				anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
			>
				<ColorPalette
					kind='fg'
					onPick={(key) => {
						api.color('fg', key);
						setColorAnchor(null);
					}}
				/>
			</Popover>

			<Popover
				open={Boolean(bgAnchor)}
				anchorEl={bgAnchor}
				onClose={() => setBgAnchor(null)}
				anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
			>
				<ColorPalette
					kind='bg'
					onPick={(key) => {
						api.color('bg', key);
						setBgAnchor(null);
					}}
				/>
			</Popover>

			<Popover
				open={Boolean(linkAnchor)}
				anchorEl={linkAnchor}
				onClose={() => setLinkAnchor(null)}
				anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
			>
				<Stack gap={1} sx={{ p: 1.5, width: 280 }}>
					<TextField
						size='small'
						label='текст'
						value={linkText}
						onChange={(e) => setLinkText(e.target.value)}
						sx={{ '& .MuiInputBase-input': { fontSize: 13 } }}
					/>
					<TextField
						size='small'
						label='ссылка'
						placeholder='https://'
						value={linkUrl}
						onChange={(e) => setLinkUrl(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') insertLink();
						}}
						sx={{ '& .MuiInputBase-input': { fontSize: 13 } }}
					/>
					<Button size='small' variant='contained' onClick={insertLink} sx={{ textTransform: 'none' }}>
						Вставить
					</Button>
				</Stack>
			</Popover>
		</Stack>
	);
}

export default MarkdownMiniEditor;
