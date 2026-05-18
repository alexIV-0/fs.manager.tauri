import { IconButton } from '@mui/material';
import { Trash2 } from 'lucide-react';
import MyToolTip from './CustomTooltip';
import { greyColor, redColor } from '@/Store/Color/grayColor';

interface TooltipOrDeleteProps {
	isDynamic: boolean;
	tooltip?: string;
	onDelete: () => void;
}

/**
 * Если isDynamic=true — показывает кнопку удаления (Trash2).
 * Если isDynamic=false — показывает MyToolTip.
 */
export default function TooltipOrDelete({ isDynamic, tooltip = '', onDelete }: TooltipOrDeleteProps) {
	if (isDynamic) {
		return (
			<IconButton
				disableRipple
				onClick={onDelete}
				className='nodrag'
				sx={{
					ml: 'auto',
					width: 30,
					padding: 0,
					color: greyColor(50),
					'&:hover': { color: redColor(50, 70) },
				}}
			>
				<Trash2 size={22} strokeWidth={1} />
			</IconButton>
		);
	}

	return <MyToolTip tooltip={tooltip} ml='auto' />;
}
