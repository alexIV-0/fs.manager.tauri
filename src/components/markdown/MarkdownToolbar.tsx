/**
 * Панель кнопок редактора описания — по образцу формы ответа на форуме.
 *
 * Набор зафиксирован в `ideasAndTest/PROJECT_DESCRIPTION_EDITOR_PLAN.md` §2.
 * Панель одна на два режима (WYSIWYG и правка текстом) и не знает, какой из них
 * активен: она дёргает `EditorApi`, реализаций две.
 *
 * Размер и семейство шрифта в РАЗМЕТКУ не пишутся намеренно: формат их не
 * выражает, и это ровно те жёсткие размеры, из-за которых вёрстка рассыпается на
 * узком экране — их работу делает «стиль абзаца». Кнопка «размер текста» — это
 * настройка ПРОСМОТРА (`useDescriptionFontSize`): она меняет базовый размер, от
 * которого в `em` считается вся типографика, и в файл не попадает.
 *
 * ⚠️ `ToolButton` и `ColorPalette` объявлены НА УРОВНЕ МОДУЛЯ, а не внутри
 * компонента. Когда они были внутри, каждый рендер создавал новый тип
 * компонента → React размонтировал поддерево при любом изменении состояния, и
 * сохранённый `anchorEl` указывал на элемент, которого в DOM уже нет: MUI не мог
 * посчитать позицию и клал попап в левый верхний угол экрана.
 */

import { useState } from 'react';
import { Box, Divider, IconButton, Menu, MenuItem, Popover, Tooltip, Typography } from '@mui/material';
import {
	ALargeSmall,
	AlignCenter,
	AlignJustify,
	AlignLeft,
	AlignRight,
	Baseline,
	Bold,
	Code,
	Eye,
	Heading,
	Highlighter,
	Image as ImageIcon,
	IndentDecrease,
	IndentIncrease,
	Italic,
	Link as LinkIcon,
	List,
	ListCollapse,
	ListOrdered,
	ListTodo,
	Minus,
	Monitor,
	Pilcrow,
	Redo2,
	RemoveFormatting,
	Smartphone,
	Smile,
	SquareCode,
	Strikethrough,
	Table as TableIcon,
	TextQuote,
	Type,
	Underline,
	Undo2,
	Workflow,
} from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import { colorForKey, MARKDOWN_GRAYS, MARKDOWN_HUES, MARKDOWN_TONES, type AlignKind } from './markdownFormat';
import type { EditorApi } from './editorApi';
import { FONT_SIZES } from './useDescriptionFontSize';

/** `rich` — правка в отрисованном виде, `md` — текст с превью. */
export type ViewMode = 'rich' | 'md';

interface ToolButtonProps {
	title: string;
	icon: typeof Bold;
	onClick: (e: React.MouseEvent<HTMLElement>) => void;
	disabled?: boolean;
	active?: boolean;
}

function ToolButton({ title, icon: Icon, onClick, disabled, active }: ToolButtonProps) {
	return (
		<Tooltip title={title} arrow disableInteractive>
			<span>
				<IconButton
					size='small'
					disabled={disabled}
					// mousedown вместо click: click сначала уводит фокус из поля ввода,
					// и выделение теряется до того, как команда его прочитает.
					onMouseDown={(e) => {
						e.preventDefault();
						onClick(e);
					}}
					sx={{
						p: '4px',
						borderRadius: '4px',
						color: active ? '#89b4fa' : greyColor(75),
						backgroundColor: active ? greyColor(24) : 'transparent',
						'&:hover': { backgroundColor: greyColor(25) },
					}}
				>
					<Icon size={16} strokeWidth={1.8} />
				</IconButton>
			</span>
		</Tooltip>
	);
}

interface ColorPaletteProps {
	kind: 'fg' | 'bg';
	onPick: (key: string | null) => void;
}

/** Сетка: строка на ступень насыщенности, отдельная строка — серая шкала. */
function ColorPalette({ kind, onPick }: ColorPaletteProps) {
	const swatch = (key: string, label: string) => (
		<Tooltip key={key} title={label} arrow disableInteractive>
			<Box
				onMouseDown={(e) => {
					e.preventDefault();
					onPick(key);
				}}
				sx={{
					width: 22,
					height: 22,
					borderRadius: '4px',
					cursor: 'pointer',
					border: `1px solid ${greyColor(30)}`,
					backgroundColor: colorForKey(key, kind),
					'&:hover': { outline: `2px solid ${greyColor(60)}` },
				}}
			/>
		</Tooltip>
	);

	return (
		<Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
			{MARKDOWN_TONES.map((tone) => (
				<Box key={tone.suffix || 'base'} sx={{ display: 'flex', gap: '4px' }}>
					{MARKDOWN_HUES.map((hue) => swatch(`${hue.key}${tone.suffix}`, `${hue.label}, ${tone.label}`))}
				</Box>
			))}

			<Divider sx={{ my: '2px' }} />

			<Box sx={{ display: 'flex', gap: '4px' }}>{MARKDOWN_GRAYS.map((g) => swatch(g.key, g.label))}</Box>

			<Typography
				onMouseDown={(e) => {
					e.preventDefault();
					onPick(null);
				}}
				sx={{ mt: '2px', fontSize: 12, cursor: 'pointer', color: greyColor(70), '&:hover': { color: '#f38ba8' } }}
			>
				Убрать {kind === 'fg' ? 'цвет' : 'заливку'}
			</Typography>
		</Box>
	);
}

interface MarkdownToolbarProps {
	api: EditorApi;
	onLink: () => void;
	onImage: () => void;
	onTable: () => void;
	onCodeBlock: () => void;
	undo: () => void;
	redo: () => void;
	canUndo: boolean;
	canRedo: boolean;
	mode: ViewMode;
	setMode: (m: ViewMode) => void;
	narrow: boolean;
	setNarrow: (v: boolean) => void;
	/** Базовый размер шрифта: от него в `em` считается вся типографика. */
	fontSize: number;
	setFontSize: (size: number) => void;
	sizeText: string;
	sizeWarn: boolean;
}

const EMOJI = [
	'✅','❌','⚠️','❗','❓','💡','🔥','⭐','🎯','📌',
	'📎','📁','📄','🎬','🎞️','🖼️','🎵','🎧','🔊','🕐',
	'⏱️','🚀','🔧','🔨','⚙️','🧩','📊','📈','📉','💰',
	'🤖','🧠','👍','👎','🙂','😀','😅','😐','😢','🎉',
	'✨','🔒','🔑','🌐','📝','🗑️','♻️','🆗',
];

const HEADINGS: Array<{ level: 0 | 1 | 2 | 3 | 4; label: string }> = [
	{ level: 0, label: 'Обычный текст' },
	{ level: 1, label: 'Заголовок 1' },
	{ level: 2, label: 'Заголовок 2' },
	{ level: 3, label: 'Заголовок 3' },
	{ level: 4, label: 'Заголовок 4' },
];

const ALIGNS: Array<{ kind: AlignKind; label: string; icon: typeof Bold }> = [
	{ kind: 'left', label: 'По левому краю', icon: AlignLeft },
	{ kind: 'center', label: 'По центру', icon: AlignCenter },
	{ kind: 'right', label: 'По правому краю', icon: AlignRight },
	{ kind: 'justify', label: 'По ширине', icon: AlignJustify },
];

export function MarkdownToolbar(props: MarkdownToolbarProps) {
	const { api, onLink, onImage, onTable, onCodeBlock, undo, redo, canUndo, canRedo } = props;
	const { mode, setMode, narrow, setNarrow, fontSize, setFontSize, sizeText, sizeWarn } = props;

	const [headingAnchor, setHeadingAnchor] = useState<HTMLElement | null>(null);
	const [alignAnchor, setAlignAnchor] = useState<HTMLElement | null>(null);
	const [fgAnchor, setFgAnchor] = useState<HTMLElement | null>(null);
	const [bgAnchor, setBgAnchor] = useState<HTMLElement | null>(null);
	const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
	const [fontAnchor, setFontAnchor] = useState<HTMLElement | null>(null);

	const gray30 = greyColor(30);
	const sep = <Divider orientation='vertical' flexItem sx={{ mx: 0.5, my: 0.5 }} />;

	return (
		<Box
			sx={{
				display: 'flex',
				alignItems: 'center',
				flexWrap: 'wrap',
				gap: '2px',
				px: 1,
				py: 0.5,
				borderBottom: `1px solid ${gray30}`,
				backgroundColor: greyColor(16),
			}}
		>
			{/* 1. История */}
			<ToolButton title='Отменить (⌘/Ctrl+Z)' icon={Undo2} onClick={undo} disabled={!canUndo} />
			<ToolButton title='Вернуть (⌘⇧Z / Ctrl+Y)' icon={Redo2} onClick={redo} disabled={!canRedo} />
			{sep}

			{/* 2. Символ */}
			<ToolButton title='Жирный (⌘/Ctrl+B)' icon={Bold} active={api.isActive('bold')} onClick={api.bold} />
			<ToolButton title='Курсив (⌘/Ctrl+I)' icon={Italic} active={api.isActive('italic')} onClick={api.italic} />
			<ToolButton title='Подчёркнутый (⌘/Ctrl+U)' icon={Underline} active={api.isActive('underline')} onClick={api.underline} />
			<ToolButton title='Зачёркнутый' icon={Strikethrough} active={api.isActive('strike')} onClick={api.strike} />
			<ToolButton title='Цвет текста' icon={Baseline} active={api.isActive('textColor')} onClick={(e) => setFgAnchor(e.currentTarget)} />
			<ToolButton title='Заливка фона' icon={Highlighter} onClick={(e) => setBgAnchor(e.currentTarget)} />
			<ToolButton title='Инлайн-код (⌘/Ctrl+E)' icon={Code} active={api.isActive('code')} onClick={api.inlineCode} />
			<ToolButton title='Убрать форматирование' icon={RemoveFormatting} onClick={api.clearFormat} />
			{sep}

			{/* 3. Абзац */}
			<ToolButton title='Стиль абзаца' icon={Heading} active={api.isActive('heading')} onClick={(e) => setHeadingAnchor(e.currentTarget)} />
			<ToolButton title='Красная строка' icon={Pilcrow} onClick={api.indentParagraph} />
			<ToolButton title='Выравнивание' icon={AlignLeft} onClick={(e) => setAlignAnchor(e.currentTarget)} />
			<ToolButton title='Цитата' icon={TextQuote} active={api.isActive('blockquote')} onClick={api.quote} />
			<ToolButton title='Разделитель' icon={Minus} onClick={api.hr} />
			<ToolButton title='Спойлер' icon={ListCollapse} active={api.isActive('details')} onClick={api.details} />
			{sep}

			{/* 4. Списки */}
			<ToolButton title='Список' icon={List} active={api.isActive('bulletList')} onClick={() => api.list('ul')} />
			<ToolButton title='Нумерованный список' icon={ListOrdered} active={api.isActive('orderedList')} onClick={() => api.list('ol')} />
			<ToolButton title='Чеклист' icon={ListTodo} active={api.isActive('taskList')} onClick={() => api.list('check')} />
			<ToolButton title='Увеличить отступ' icon={IndentIncrease} onClick={() => api.indent(1)} />
			<ToolButton title='Уменьшить отступ' icon={IndentDecrease} onClick={() => api.indent(-1)} />
			{sep}

			{/* 5. Вставка */}
			<ToolButton title='Ссылка (⌘/Ctrl+K)' icon={LinkIcon} active={api.isActive('link')} onClick={onLink} />
			<ToolButton title='Картинка — выбрать файл (или вставить из буфера через ⌘/Ctrl+V)' icon={ImageIcon} onClick={onImage} />
			<ToolButton title='Таблица' icon={TableIcon} onClick={onTable} />
			<ToolButton title='Блок кода' icon={SquareCode} active={api.isActive('codeBlock')} onClick={onCodeBlock} />
			<ToolButton title='Блок-схема (mermaid — рисует сайт)' icon={Workflow} onClick={api.mermaid} />
			<ToolButton title='Эмодзи' icon={Smile} onClick={(e) => setEmojiAnchor(e.currentTarget)} />

			{/* 6. Вид */}
			<Box sx={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '2px' }}>
				<Typography sx={{ fontSize: 11, color: sizeWarn ? '#fab387' : greyColor(55), mr: 0.5 }}>{sizeText}</Typography>
				<ToolButton title={`Размер текста: ${fontSize} px`} icon={ALargeSmall} onClick={(e) => setFontAnchor(e.currentTarget)} />
				<ToolButton title='Правка в обычном виде' icon={Eye} active={mode === 'rich'} onClick={() => setMode('rich')} />
				<ToolButton title='Правка текстом (markdown) с превью' icon={Type} active={mode === 'md'} onClick={() => setMode('md')} />
				{sep}
				<ToolButton
					title={narrow ? 'Ширина: узкий экран' : 'Ширина: широкий экран'}
					icon={narrow ? Smartphone : Monitor}
					onClick={() => setNarrow(!narrow)}
				/>
			</Box>

			{/* Размер шрифта — настройка просмотра, в файл не попадает */}
			<Menu anchorEl={fontAnchor} open={!!fontAnchor} onClose={() => setFontAnchor(null)}>
				{FONT_SIZES.map((size) => (
					<MenuItem
						key={size}
						selected={size === fontSize}
						onMouseDown={(e) => {
							e.preventDefault();
							setFontSize(size);
							setFontAnchor(null);
						}}
						sx={{ fontSize: size }}
					>
						{size} px
					</MenuItem>
				))}
			</Menu>

			{/* Меню «стиль абзаца» */}
			<Menu anchorEl={headingAnchor} open={!!headingAnchor} onClose={() => setHeadingAnchor(null)}>
				{HEADINGS.map((h) => (
					<MenuItem
						key={h.level}
						onMouseDown={(e) => {
							e.preventDefault();
							api.heading(h.level);
							setHeadingAnchor(null);
						}}
						sx={{ fontSize: 13 }}
					>
						{h.label}
					</MenuItem>
				))}
			</Menu>

			{/* Меню выравнивания */}
			<Menu anchorEl={alignAnchor} open={!!alignAnchor} onClose={() => setAlignAnchor(null)}>
				{ALIGNS.map((a) => (
					<MenuItem
						key={a.kind}
						onMouseDown={(e) => {
							e.preventDefault();
							api.align(a.kind);
							setAlignAnchor(null);
						}}
						sx={{ fontSize: 13, gap: 1 }}
					>
						<a.icon size={15} /> {a.label}
					</MenuItem>
				))}
			</Menu>

			{/* Палитры */}
			<Popover
				anchorEl={fgAnchor}
				open={!!fgAnchor}
				onClose={() => setFgAnchor(null)}
				anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
			>
				<ColorPalette
					kind='fg'
					onPick={(key) => {
						api.color('fg', key);
						setFgAnchor(null);
					}}
				/>
			</Popover>
			<Popover
				anchorEl={bgAnchor}
				open={!!bgAnchor}
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

			{/* Эмодзи */}
			<Popover
				anchorEl={emojiAnchor}
				open={!!emojiAnchor}
				onClose={() => setEmojiAnchor(null)}
				anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
			>
				<Box sx={{ p: 1, width: 240, display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
					{EMOJI.map((e) => (
						<Box
							key={e}
							onMouseDown={(ev) => {
								ev.preventDefault();
								api.insert(e);
								setEmojiAnchor(null);
							}}
							sx={{
								width: 26,
								height: 26,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								borderRadius: '4px',
								cursor: 'pointer',
								fontSize: 16,
								'&:hover': { backgroundColor: greyColor(25) },
							}}
						>
							{e}
						</Box>
					))}
				</Box>
			</Popover>
		</Box>
	);
}

export default MarkdownToolbar;
