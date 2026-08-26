import * as React from 'react';
import { IconButton, Tooltip, ClickAwayListener, Box } from '@mui/material';

import { CircleQuestionMark } from 'lucide-react';
import type { BoxProps, TooltipProps } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import MarkdownView from '@/components/markdown/MarkdownView';

interface MyToolTipProps extends BoxProps {
	placement?: TooltipProps['placement'];
	/** Markdown (новый формат) либо HTML — легаси из старого RichTextEditor. */
	tooltip: string;
}

/** Строка похожа на HTML: подсказки, написанные старым RichTextEditor, приходят тегами. */
function isHtml(s: string): boolean {
	return /<[a-z][^>]*>/i.test(s);
}

/**
 * Отрисовка текста подсказки.
 *
 * Формат подсказок — markdown того же контракта, что и описание проекта, но в
 * урезанном профиле (`MarkdownView variant='tooltip'`): текст, цвет, списки,
 * ссылки; таблицы, картинки и блок-схемы в поповере вырезаются санитайзером.
 * Цвет размечается классами `fg-*`/`bg-*` — поэтому подсказка выглядит
 * одинаково здесь, в редакторе подсказки и на сайте.
 *
 * HTML-ветка остаётся навсегда: тултипы в `ui.json` у 45 плагинов (и у уже
 * установленных у людей бандлов) написаны тегами, и переписать их разово
 * нельзя — конвертер не догонит чужие копии. Отсюда правило: РЕДАКТОР пишет
 * только markdown, ПОКАЗ понимает оба формата.
 *
 * Вынесено отдельным экспортом, чтобы редактор своей подсказки
 * (`EditableTooltip`) показывал ровно то же, что и обычный тултип.
 */
export function TooltipBody({ tooltip }: { tooltip: string }) {
	if (!tooltip) return null;

	return isHtml(tooltip) ? (
		<div
			// eslint-disable-next-line react/no-danger
			dangerouslySetInnerHTML={{ __html: tooltip }}
			style={{ fontSize: 13, lineHeight: 1.6 }}
		/>
	) : (
		<MarkdownView variant='tooltip'>{tooltip}</MarkdownView>
	);
}

export default function MyToolTip({ tooltip, placement = 'right', ...props }: MyToolTipProps) {
	const [open, setOpen] = React.useState(false);
	const gray70 = greyColor(70);

	const handleTooltipClose = () => setOpen(false);
	const handleTooltipOpen = () => setOpen(true);

	return (
		<ClickAwayListener onClickAway={handleTooltipClose}>
			<Box {...props}>
				<Tooltip
					title={
						<div
							style={{
								padding: '8px 12px',
								fontSize: 13,
								lineHeight: 1.6,
								whiteSpace: 'normal',
								color: gray70,
							}}
						>
							<TooltipBody tooltip={tooltip} />
						</div>
					}
					placement={placement}
					open={open}
					onClose={handleTooltipClose}
					disableHoverListener
					disableTouchListener
					arrow
					slotProps={{
						tooltip: {
							sx: {
								maxWidth: 600,
								minWidth: 200,
							},
						},
					}}
				>
					<IconButton
						disableRipple
						size='small'
						onClick={handleTooltipOpen}
						sx={{ cursor: 'pointer', color: greyColor(50), '&:hover': { color: greyColor(70) } }}
					>
						<CircleQuestionMark size={18} strokeWidth={1} />
					</IconButton>
				</Tooltip>
			</Box>
		</ClickAwayListener>
	);
}
