import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { useNodesData, useReactFlow } from '@xyflow/react';
import { memo, useCallback, useMemo, useState } from 'react';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { greyColor } from '@/Store/Color/grayColor';
import { RichTextEditor } from '@/components/RichTextEditor';

function stripHtml(html: string): string {
	if (!html) return '';
	const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
	return text.replace(/\s+/g, ' ').trim();
}

function CommentRichText() {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();
	const node = useNodesData(nodeId);

	const commentHtml: string = (node?.data as any)?.comment ?? '';
	const [isOpen, setIsOpen] = useState(false);
	const [draft, setDraft] = useState('');

	const borderColor = greyColor(25);
	const previewBg = greyColor(15);
	const previewBgHover = greyColor(18);
	const gray40 = greyColor(40);
	const gray65 = greyColor(65);
	const defColor = colorTypes_store((s) => s.colorTypes.default) as string;

	const previewText = useMemo(() => stripHtml(commentHtml), [commentHtml]);

	const handleOpen = useCallback(() => {
		setDraft(commentHtml);
		setIsOpen(true);
	}, [commentHtml]);

	const handleClose = useCallback(() => {
		setIsOpen(false);
	}, []);

	const handleSave = useCallback(() => {
		reactFlow.updateNode(nodeId, (n) => ({
			...n,
			data: { ...n.data, comment: draft },
		}));
		setIsOpen(false);
	}, [draft, nodeId, reactFlow]);

	// Для loop ноды поле комментария не показываем
	const isLoop = (node?.data as any)?.executionType === 'loop';
	if (isLoop) return null;

	return (
		<>
			<Box
				sx={{
					position: 'relative',
					px: '12px',
					pb: '12px',
					display: 'flex',
					flexDirection: 'column',
					minHeight: 0,
					marginBottom: '40px',
				}}
			>
				<Typography variant='body1' className='nodrag' fontSize={'12px'} mb='4px' color={defColor}>
					Comment
				</Typography>
				<Box
					className='nodrag'
					onClick={handleOpen}
					sx={{
						width: '100%',
						padding: '6px 8px',
						borderRadius: '4px',
						border: `1px solid ${borderColor}`,
						cursor: 'pointer',
						bgcolor: previewBg,
						boxSizing: 'border-box',
						transition: 'background-color 0.15s',
						'&:hover': { bgcolor: previewBgHover },
					}}
				>
					<Typography
						sx={{
							fontSize: '12px',
							color: previewText ? gray65 : gray40,
							fontStyle: previewText ? 'normal' : 'italic',
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							userSelect: 'none',
							display: 'block',
							minHeight: '1.3em',
							lineHeight: 1.3,
						}}
					>
						{previewText || 'Комментарий...'}
					</Typography>
				</Box>
			</Box>

			<Dialog open={isOpen} onClose={handleClose} maxWidth='md' fullWidth>
				<DialogTitle sx={{ fontSize: 13, py: 1, pb: 0.75 }}>Комментарий</DialogTitle>
				<DialogContent sx={{ p: 2 }}>
					<RichTextEditor key={isOpen ? 'open' : 'closed'} value={draft} onChange={setDraft} minHeight={240} />
				</DialogContent>
				<DialogActions>
					<Button size='small' onClick={handleClose}>
						Отмена
					</Button>
					<Button size='small' variant='contained' onClick={handleSave}>
						Сохранить
					</Button>
				</DialogActions>
			</Dialog>
		</>
	);
}

export default memo(CommentRichText);
