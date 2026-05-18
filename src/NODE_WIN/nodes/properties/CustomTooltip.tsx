import * as React from 'react';
import { IconButton, Tooltip, ClickAwayListener, Box } from '@mui/material';

import { CircleQuestionMark } from 'lucide-react';
import type { BoxProps, TooltipProps } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import { greyColor } from '@/Store/Color/grayColor';

interface MyToolTipProps extends BoxProps {
	placement?: TooltipProps['placement'];
	tooltip: string; // HTML string (or legacy Markdown)
}

/** Detect if a string is HTML (starts with an HTML tag or contains HTML tags anywhere) */
function isHtml(s: string): boolean {
	return /<[a-z][^>]*>/i.test(s);
}

export default function MyToolTip({ tooltip, placement = 'right', ...props }: MyToolTipProps) {
	const [open, setOpen] = React.useState(false);
	const gray15 = greyColor(15);
	const gray70 = greyColor(70);

	const handleTooltipClose = () => setOpen(false);
	const handleTooltipOpen = () => setOpen(true);

	// Общие стили для компонентов ReactMarkdown
	const markdownComponents = {
		p: ({ node, ...props }: any) => <p style={{ margin: '0 0 6px 0' }} {...props} />,
		ul: ({ node, ...props }: any) => <ul style={{ paddingLeft: 20, margin: '6px 0' }} {...props} />,
		ol: ({ node, ...props }: any) => <ol style={{ paddingLeft: 20, margin: '6px 0' }} {...props} />,
		li: ({ node, ...props }: any) => <li style={{ marginBottom: 4 }} {...props} />,
		strong: ({ node, ...props }: any) => <strong style={{ color: '#eeeeeeff', fontWeight: 700 }} {...props} />,
		em: ({ node, ...props }: any) => <em style={{ fontStyle: 'italic' }} {...props} />,
		code: ({ node, ...props }: any) => (
			<code
				style={{
					backgroundColor: gray15,
					padding: '1px 4px',
					borderRadius: 4,
					fontFamily: 'monospace',
					fontSize: 12,
				}}
				{...props}
			/>
		),
		blockquote: ({ node, ...props }: any) => (
			<blockquote
				style={{
					borderLeft: '3px solid #89b4fa',
					paddingLeft: 12,
					margin: '8px 0',
					color: gray70,
					fontStyle: 'italic',
				}}
				{...props}
			/>
		),
		a: ({ node, ...props }: any) => <a style={{ color: '#89b4fa', textDecoration: 'underline' }} {...props} />,
		h1: ({ node, ...props }: any) => <h1 style={{ fontSize: 16, fontWeight: 700, margin: '8px 0 4px 0' }} {...props} />,
		h2: ({ node, ...props }: any) => <h2 style={{ fontSize: 15, fontWeight: 700, margin: '8px 0 4px 0' }} {...props} />,
		h3: ({ node, ...props }: any) => <h3 style={{ fontSize: 14, fontWeight: 600, margin: '6px 0 4px 0' }} {...props} />,
	};

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
							{isHtml(tooltip) ? (
								<div
									// eslint-disable-next-line react/no-danger
									dangerouslySetInnerHTML={{ __html: tooltip }}
									style={{
										fontSize: 13,
										lineHeight: 1.6,
									}}
								/>
							) : (
								<ReactMarkdown components={markdownComponents}>{tooltip}</ReactMarkdown>
							)}
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
