import { greyColor } from '@/Store/Color/grayColor';
import { Box, BoxProps, ClickAwayListener, ClickAwayListenerProps } from '@mui/material';
import { PropsWithChildren } from 'react';

interface ChipAutocompleteContainerProps extends PropsWithChildren {
	onClickAway: ClickAwayListenerProps['onClickAway'];
	boxRef: React.RefObject<HTMLDivElement | null>;
	onClick: BoxProps['onClick'];
	isFocused?: boolean;
}

export default function ChipAutocompleteContainer(props: ChipAutocompleteContainerProps) {
	const handleClickAway = (event: MouseEvent | TouchEvent) => {
		const target = event?.target as Node | null;
		// If the click is inside the box, don't trigger onClickAway
		if (props.boxRef.current?.contains(target)) return;
		props.onClickAway(event);
	};

	return (
		<ClickAwayListener onClickAway={handleClickAway}>
			<Box
				className='ca-box nodrag'
				ref={props.boxRef}
				sx={{
					'--border-color': props.isFocused ? greyColor(200) : greyColor(50),
					width: '100%',
					display: 'flex',
					flexWrap: 'wrap',
					gap: '6px',
					alignItems: 'center',
					// border: '1px solid var(--border-color)',
					// borderRadius: '4px',
					padding: '6px',
					cursor: 'text',
					position: 'relative', // Added to ensure relative positioning context if needed
				}}
				onClick={props.onClick}
			>
				{props.children}
			</Box>
		</ClickAwayListener>
	);
}
