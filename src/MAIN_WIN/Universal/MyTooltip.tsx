import { Tooltip, Box } from '@mui/material';
import { HelpCircle } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';

type Props = {
	text: string;
	size?: number;
};

// Маленький «?» с подсказкой. Ставится в строке настроек рядом с параметром.
export default function MyTooltip({ text, size = 13 }: Props) {
	if (!text) return null;
	return (
		<Tooltip title={text} placement='top' arrow enterDelay={300} leaveDelay={80}>
			<Box
				component='span'
				sx={{
					display: 'inline-flex',
					alignItems: 'center',
					color: greyColor(45),
					cursor: 'help',
					ml: 0.5,
					'&:hover': { color: greyColor(70) },
				}}
			>
				<HelpCircle size={size} strokeWidth={1.6} />
			</Box>
		</Tooltip>
	);
}
