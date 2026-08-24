/**
 * Единый просмотрщик markdown в приложении.
 *
 * До него карта `components` для `ReactMarkdown` была скопирована в трёх местах
 * (`MarkdownText`, `CustomTooltip`, `DocModal`) и расходилась по стилям. Здесь
 * один конвейер и один набор правил, включая те, без которых описание
 * разваливается на узком экране: таблица в прокручиваемой обёртке, картинка
 * `max-width: 100%`, длинные пути с переносом.
 *
 * Порядок плагинов важен: gfm → raw → sanitize. Санитайз последним и всегда:
 * файл описания приходит по сети (его мог править сайт), доверенным он не
 * является. Схема — `markdownFormat.ts`, она же контракт для сайта.
 *
 * Стили вынесены в `markdownProseSx`, потому что ими же оформляется полотно
 * WYSIWYG-редактора: иначе «как вижу» и «как сохранится» разъезжались бы.
 */

import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { greyColor } from '@/Store/Color/grayColor';
import { commands } from '@/Utils/specta';
import { descriptionSanitizeSchema, paletteCss } from './markdownFormat';

interface MarkdownViewProps {
	children: string;
	/** Ограничение ширины колонки текста; контейнер при этом тянется. */
	maxWidth?: number | string;
	fontSize?: number | string;
	sx?: SxProps<Theme>;
}

/** Ссылку открываем в системном браузере: навигация внутри webview убьёт окно. */
const openExternal = (href?: string) => {
	if (!href) return;
	commands.shellOpenPath(href).catch(() => {});
};

const components: React.ComponentProps<typeof ReactMarkdown>['components'] = {
	table: ({ node, ...props }) => (
		<div className='md-table-wrap'>
			<table {...props} />
		</div>
	),
	// Картинка без src — это вырезанный санитайзером мусор, а не картинка.
	img: ({ node, src, ...props }) => (src ? <img src={String(src)} {...props} /> : null),
	a: ({ node, href, children, ...props }) => (
		<a
			href={href}
			onClick={(e) => {
				e.preventDefault();
				openExternal(href);
			}}
			{...props}
		>
			{children}
		</a>
	),
};

/**
 * Оформление отрисованного markdown. Используется и просмотрщиком, и полотном
 * редактора, поэтому все правила адаптивности живут здесь в одном месте.
 */
export function markdownProseSx(maxWidth: number | string = 820, fontSize: number | string = 14): Record<string, unknown> {
	const gray12 = greyColor(12);
	const gray30 = greyColor(30);
	const gray45 = greyColor(45);
	const gray80 = greyColor(80);

	return {
		color: gray80,
		fontSize,
		lineHeight: 1.55,
		// Длинный путь или URL иначе распирает layout.
		overflowWrap: 'anywhere',
		'& > *': { maxWidth },
		'& h1': { fontSize: '1.7em', fontWeight: 700, margin: '18px 0 8px' },
		'& h2': { fontSize: '1.4em', fontWeight: 700, margin: '16px 0 6px' },
		'& h3': { fontSize: '1.2em', fontWeight: 600, margin: '14px 0 6px' },
		'& h4': { fontSize: '1.05em', fontWeight: 600, margin: '12px 0 4px' },
		'& p': { margin: '0 0 8px' },
		'& ul, & ol': { paddingLeft: '22px', margin: '6px 0' },
		'& li': { marginBottom: '3px' },
		'& li input[type="checkbox"]': { marginRight: '6px' },
		'& blockquote': {
			borderLeft: `3px solid ${gray45}`,
			margin: '10px 0',
			padding: '2px 0 2px 12px',
			color: greyColor(65),
		},
		'& hr': { border: 'none', borderTop: `1px solid ${gray30}`, margin: '14px 0' },
		'& a': { color: '#89b4fa', textDecoration: 'underline', cursor: 'pointer' },
		'& code': {
			backgroundColor: gray12,
			padding: '1px 4px',
			borderRadius: '4px',
			fontFamily: 'monospace',
			fontSize: '0.92em',
		},
		// Широкая таблица прокручивается внутри себя, а не растягивает страницу.
		// Из markdown такую обёртку задать нельзя — её ставит только рендерер.
		'& .md-table-wrap': { overflowX: 'auto', maxWidth: '100%', margin: '12px 0' },
		'& table': { borderCollapse: 'collapse', width: '100%' },
		'& pre': {
			backgroundColor: gray12,
			border: `1px solid ${gray30}`,
			borderRadius: '4px',
			padding: '8px 10px',
			// Код с длинными строками прокручивается, а не ломает вёрстку.
			overflowX: 'auto',
			margin: '10px 0',
		},
		'& pre code': { backgroundColor: 'transparent', padding: 0 },
		'& img': { maxWidth: '100%', height: 'auto', borderRadius: '4px', display: 'block', margin: '10px 0' },
		'& th, & td': { border: `1px solid ${gray30}`, padding: '4px 8px', textAlign: 'left' },
		'& th': { backgroundColor: gray12, fontWeight: 600 },
		'& td[align="center"], & th[align="center"]': { textAlign: 'center' },
		'& td[align="right"], & th[align="right"]': { textAlign: 'right' },
		'& mark': { backgroundColor: '#f9e2af40', color: 'inherit', borderRadius: '3px', padding: '0 2px' },
		'& details': {
			border: `1px solid ${gray30}`,
			borderRadius: '4px',
			padding: '6px 10px',
			margin: '10px 0',
		},
		'& summary': { cursor: 'pointer', fontWeight: 600 },
		...paletteCss(),
	};
}

export function MarkdownView({ children, maxWidth = 820, fontSize = 14, sx }: MarkdownViewProps) {
	return (
		<Box sx={{ ...markdownProseSx(maxWidth, fontSize), ...sx } as SxProps<Theme>}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeRaw, [rehypeSanitize, descriptionSanitizeSchema]]}
				components={components}
			>
				{children}
			</ReactMarkdown>
		</Box>
	);
}

export default MarkdownView;
