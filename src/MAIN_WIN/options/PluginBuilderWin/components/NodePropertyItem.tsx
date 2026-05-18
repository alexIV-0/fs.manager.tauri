import { Box, Typography } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import { CONTROL_TYPE_COLORS } from '../types';
import type { UiPropertyData } from '../types';

interface NodePropertyItemProps {
	property: UiPropertyData;
	isSelected: boolean;
	isOutputSource: boolean;
	onSelect: () => void;
}

export function NodePropertyItem({ property, isSelected, isOutputSource, onSelect }: NodePropertyItemProps) {
	const gray40 = greyColor(40);
	const color = CONTROL_TYPE_COLORS[property.controlType] ?? '#aaa';
	const cp = property.controlProps;

	// Visual representation based on controlType
	const renderVisual = () => {
		switch (property.controlType) {
			case 'checkbox':
				return (
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
						<Box
							sx={{
								width: 16,
								height: 16,
								borderRadius: '3px',
								flexShrink: 0,
								border: `1.5px solid ${color}`,
								bgcolor: cp.value ? color : 'transparent',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
							}}
						>
							{cp.value && <span style={{ fontSize: 10, lineHeight: 1 }}>✓</span>}
						</Box>
						<Typography variant='caption' sx={{ fontSize: 11 }}>
							{cp.label}
						</Typography>
					</Box>
				);
			case 'slider': {
				const pct = (((cp.value ?? 50) - (cp.minValue ?? 0)) / ((cp.maxValue ?? 100) - (cp.minValue ?? 0))) * 100;
				return (
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 0.5, width: '100%' }}>
						<Typography variant='caption' sx={{ fontSize: 11, minWidth: 60, color: gray40 }}>
							{cp.label}
						</Typography>
						<Box sx={{ flex: 1, height: 4, bgcolor: `${greyColor(30)}`, borderRadius: 2, position: 'relative' }}>
							<Box
								sx={{
									position: 'absolute',
									left: 0,
									top: 0,
									width: `${pct}%`,
									height: '100%',
									bgcolor: color,
									borderRadius: 2,
								}}
							/>
							<Box
								sx={{
									position: 'absolute',
									left: `calc(${pct}% - 6px)`,
									top: -3,
									width: 10,
									height: 10,
									borderRadius: '50%',
									bgcolor: color,
									border: `1px solid ${greyColor(50)}`,
								}}
							/>
						</Box>
					</Box>
				);
			}
			case 'link':
				return (
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
						<Typography variant='caption' sx={{ fontSize: 11, color: '#4fc3f7', textDecoration: 'underline' }}>
							{cp.label}
						</Typography>
						<Typography variant='caption' sx={{ fontSize: 9, opacity: 0.4, fontFamily: 'monospace' }}>
							{(property.acceptedTypes ?? []).join(', ')}
						</Typography>
					</Box>
				);
			case 'timecode':
				return (
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
						<Typography variant='caption' sx={{ fontSize: 11, color: gray40, minWidth: 60 }}>
							{cp.label}
						</Typography>
						<Typography
							variant='caption'
							sx={{
								fontSize: 11,
								fontFamily: 'monospace',
								bgcolor: `${color}22`,
								px: 0.75,
								py: 0.25,
								borderRadius: 0.5,
								color,
							}}
						>
							{formatTimecode(cp.value ?? 0)}
						</Typography>
					</Box>
				);
			case 'ddm':
				return (
					<Box
						sx={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-between',
							px: 0.75,
							py: 0.35,
							border: `1px solid ${color}44`,
							borderRadius: 0.5,
							bgcolor: `${color}11`,
							fontSize: 11,
							width: '100%',
						}}
					>
						<span style={{ fontSize: 11 }}>{cp.value ?? cp.options?.[0] ?? '—'}</span>
						<span style={{ opacity: 0.4, fontSize: 9 }}>▼</span>
					</Box>
				);
			case 'textedit':
				return (
					<Box
						sx={{
							border: `1px solid ${gray40}`,
							borderRadius: 0.5,
							p: 0.5,
							bgcolor: `${greyColor(15)}`,
							minHeight: 32,
							fontSize: 11,
						}}
					>
						<Typography variant='caption' sx={{ fontSize: 10, color: gray40, display: 'block', mb: 0.25 }}>
							{cp.label}
						</Typography>
						<Typography variant='caption' sx={{ fontSize: 11, fontFamily: 'monospace', opacity: 0.5 }}>
							{cp.language}
						</Typography>
					</Box>
				);
			case 'pathNavigator':
			case 'jsonNavigator':
				return (
					<Box
						sx={{
							display: 'flex',
							alignItems: 'center',
							gap: 0.5,
							px: 0.75,
							py: 0.35,
							border: `1px solid ${gray40}`,
							borderRadius: 0.5,
							bgcolor: `${greyColor(15)}`,
							fontSize: 11,
						}}
					>
						<span style={{ fontSize: 11, color: gray40 }}>{cp.label}</span>
						<span style={{ opacity: 0.3, fontSize: 9 }}>📁</span>
					</Box>
				);
			case 'autocomplete':
				return (
					<Box sx={{ width: '100%' }}>
						<Typography variant='caption' sx={{ fontSize: 10, color: gray40, display: 'block', mb: 0.25 }}>
							{cp.label}
						</Typography>
						<Box
							sx={{
								display: 'flex',
								flexWrap: 'wrap',
								gap: 0.35,
								p: 0.5,
								border: `1px solid ${gray40}`,
								borderRadius: 0.5,
								bgcolor: `${greyColor(15)}`,
								minHeight: 24,
							}}
						>
							{(cp.options ?? []).slice(0, 3).map((o: string) => (
								<Box
									key={o}
									sx={{
										fontSize: 9,
										px: 0.5,
										py: 0.15,
										borderRadius: 0.5,
										bgcolor: `${color}22`,
										color,
									}}
								>
									{o}
								</Box>
							))}
							{(cp.options ?? []).length > 3 && (
								<Typography variant='caption' sx={{ fontSize: 9, opacity: 0.5 }}>
									+{(cp.options ?? []).length - 3}
								</Typography>
							)}
						</Box>
					</Box>
				);
			default:
				return (
					<Typography variant='caption' sx={{ fontSize: 11 }}>
						{cp.label || property.id}
					</Typography>
				);
		}
	};

	return (
		<Box
			onClick={onSelect}
			sx={{
				display: 'flex',
				flexDirection: 'column',
				gap: 0.25,
				px: 1,
				py: 0.6,
				cursor: 'pointer',
				bgcolor: isSelected ? `${color}15` : 'transparent',
				borderLeft: '3px solid',
				borderLeftColor: isSelected ? color : 'transparent',
				'&:hover': { bgcolor: 'rgba(255,255,255,0.03)' },
				transition: 'background-color 0.12s',
				position: 'relative',
			}}
		>
			{/* Top row: type badge + badges */}
			<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
				<Box
					sx={{
						px: 0.4,
						py: 0.1,
						borderRadius: 0.5,
						bgcolor: `${color}1a`,
						border: `1px solid ${color}44`,
						fontSize: 9,
						color,
						fontFamily: 'monospace',
						lineHeight: 1.4,
					}}
				>
					{property.controlType}
				</Box>
				{isOutputSource && (
					<Box
						sx={{
							fontSize: 8,
							color: '#81c784',
							border: '1px solid #81c78455',
							px: 0.35,
							borderRadius: 0.5,
							fontWeight: 700,
						}}
					>
						OUT
					</Box>
				)}
				{property.required && (
					<Box sx={{ fontSize: 8, color: '#ef5350', border: '1px solid #ef535044', px: 0.35, borderRadius: 0.5 }}>req</Box>
				)}
			</Box>

			{/* Visual content */}
			<Box sx={{ pl: 0.5 }}>{renderVisual()}</Box>
		</Box>
	);
}

function formatTimecode(frames: number): string {
	const fps = 25;
	const totalSeconds = Math.floor(frames / fps);
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.floor((totalSeconds % 3600) / 60);
	const s = totalSeconds % 60;
	const f = frames % fps;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}
