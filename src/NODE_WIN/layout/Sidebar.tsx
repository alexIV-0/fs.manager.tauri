// src/NODE_WIN/components/Sidebar/Sidebar.tsx
import { Box, Stack, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import { memo } from 'react';

import SidebarAccordion from './SidebarAccordion';
import { useSidebar, PEEK_WIDTH } from '../hooks/useSidebar';
import { greyColor } from '@/Store/Color/grayColor';

function Sidebar() {
	const { mode, setMode, width, isVisible, onResizeStart, onPeekEnter, onPeekLeave, onPeekClick, sidebarRef } = useSidebar();

	return (
		<>
			{/* Полоска — всегда видна, НЕ внутри сайдбара */}
			<Box
				onMouseEnter={onPeekEnter}
				onMouseLeave={onPeekLeave}
				onClick={onPeekClick}
				sx={{
					position: 'fixed',
					right: 0,
					top: 30,
					bottom: 0,
					width: `${PEEK_WIDTH}px`,
					zIndex: 1201, // выше сайдбара!
					cursor: mode === 'off' ? 'pointer' : mode === 'auto' ? 'e-resize' : 'default',
					display: isVisible && mode !== 'off' ? 'none' : 'flex', // прячем когда сайдбар открыт (кроме off)
					alignItems: 'center',
					justifyContent: 'center',
					'&::after': {
						content: '""',
						display: 'block',
						width: '3px',
						height: '40px',
						borderRadius: '2px',
						backgroundColor: '#ffffff20',
						transition: 'background-color 0.2s',
					},
					'&:hover::after': {
						backgroundColor: '#ffffff50',
					},
				}}
			/>

			{/* Сам сайдбар */}
			<Box
				ref={sidebarRef}
				onMouseEnter={onPeekEnter}
				onMouseLeave={onPeekLeave}
				sx={{
					position: 'fixed',
					right: 0,
					top: 30, // под TopPanel
					bottom: 0,
					width: `${width}px`,
					zIndex: 1200,
					backgroundColor: greyColor(15),
					borderLeft: '1px solid #ffffff15',
					display: 'flex',
					flexDirection: 'column',
					transform: isVisible ? 'translateX(0)' : `translateX(${width - PEEK_WIDTH}px)`,
					transition: 'transform 0.25s ease',
					userSelect: 'none',
				}}
			>
				{/* Ручка для resize — левый край */}
				<Box
					onMouseDown={onResizeStart}
					sx={{
						position: 'absolute',
						left: 0,
						top: 0,
						bottom: 0,
						width: '5px',
						cursor: 'ew-resize',
						zIndex: 10,
						'&:hover': { backgroundColor: '#ffffff15' },
						transition: 'background-color 0.2s',
					}}
				/>

				{/* Контент */}
				<Box sx={{ flex: 1, overflow: 'hidden', pt: 0.5 }}>
					<SidebarAccordion />
				</Box>

				{/* Кнопки режима внизу */}
				<Stack alignItems='center' py={1} sx={{ borderTop: '1px solid #ffffff10' }}>
					<ToggleButtonGroup
						value={mode}
						exclusive
						onChange={(_, val) => {
							if (val) setMode(val);
						}}
						size='small'
						sx={{ height: 24 }}
					>
						<Tooltip title='Always visible'>
							<ToggleButton value='on' sx={{ px: 1.5, fontSize: 11 }}>
								ON
							</ToggleButton>
						</Tooltip>
						<Tooltip title='Hidden, click strip to toggle'>
							<ToggleButton value='off' sx={{ px: 1.5, fontSize: 11 }}>
								OFF
							</ToggleButton>
						</Tooltip>
						<Tooltip title='Show on hover'>
							<ToggleButton value='auto' sx={{ px: 1.5, fontSize: 11 }}>
								AUTO
							</ToggleButton>
						</Tooltip>
					</ToggleButtonGroup>
				</Stack>
			</Box>
		</>
	);
}

export default memo(Sidebar);
