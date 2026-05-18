// src/NODE_WIN/nodes/properties/PanelUI.tsx
//
// Shared UI primitives for all settings panels.
// Covers: section labels, sliders, color rows, checkbox rows,
// file picker buttons, and accordion sections.

import { memo } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Checkbox, Stack, Tooltip, Typography } from '@mui/material';
import { ChevronDown, FolderOpen } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import { MyPopoverColor } from '@/MAIN_WIN/Universal/MyPopoverColor';
import PanelSlider from './PanelSlider';

// ── Colors shared across all panels ─────────────────────────────────────────

export const panelColors = {
	bg:             greyColor(15),
	border:         greyColor(25),
	labelColor:     greyColor(50),
	defColor:       greyColor(80),
	btnBg:          greyColor(20),
	btnActiveBg:    greyColor(38),
	btnBorder:      greyColor(28),
	btnActiveBorder: greyColor(55),
} as const;

// ── SectionLabel ─────────────────────────────────────────────────────────────
// Uppercase 10px header for a group of controls.

interface SectionLabelProps {
	children: React.ReactNode;
}

export const SectionLabel = memo(function SectionLabel({ children }: SectionLabelProps) {
	return (
		<Typography sx={{ fontSize: 10, color: greyColor(50), mb: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em', userSelect: 'none' }}>
			{children}
		</Typography>
	);
});

// ── CheckboxRow ───────────────────────────────────────────────────────────────
// Checkbox + label, full row is clickable.

interface CheckboxRowProps {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	/** Override checked accent color. Default: greyColor(80). */
	accentColor?: string;
	mb?: number;
}

export const CheckboxRow = memo(function CheckboxRow({ label, checked, onChange, accentColor, mb = 0.5 }: CheckboxRowProps) {
	const labelColor = greyColor(50);
	const defColor = accentColor ?? greyColor(80);

	return (
		<Box
			sx={{ display: 'flex', alignItems: 'center', mb, cursor: 'pointer', userSelect: 'none' }}
			onClick={() => onChange(!checked)}
		>
			<Checkbox
				size='small'
				checked={checked}
				onChange={() => {}}
				sx={{ p: 0, mr: 0.5, color: labelColor, '&.Mui-checked': { color: defColor } }}
			/>
			<Typography sx={{ fontSize: 11, color: checked ? greyColor(80) : labelColor }}>{label}</Typography>
		</Box>
	);
});

// ── FilePickerButton ──────────────────────────────────────────────────────────
// Outlined MUI Button with FolderOpen icon. Highlights when a file is loaded.
// Pass children for the label text (allows custom prefixes like "FG:").

interface FilePickerButtonProps {
	filePath: string;
	onClick: () => void;
	disabled?: boolean;
	tooltipTitle?: string;
	children: React.ReactNode;
}

export const FilePickerButton = memo(function FilePickerButton({ filePath, onClick, disabled, tooltipTitle, children }: FilePickerButtonProps) {
	const { labelColor, defColor, btnBg, btnActiveBg, btnBorder, btnActiveBorder } = panelColors;

	const btn = (
		<Button
			size='small'
			fullWidth
			startIcon={<FolderOpen size={13} />}
			onClick={onClick}
			disabled={disabled}
			variant='outlined'
			sx={{
				textTransform: 'none',
				justifyContent: 'flex-start',
				fontSize: 11,
				px: 1,
				py: 0.4,
				color: filePath && !disabled ? defColor : labelColor,
				borderColor: filePath && !disabled ? btnActiveBorder : btnBorder,
				backgroundColor: btnBg,
				'&:hover': { backgroundColor: btnActiveBg, borderColor: defColor },
				'&.Mui-disabled': { opacity: 0.4 },
			}}
		>
			<Box component='span' sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
				{children}
			</Box>
		</Button>
	);

	if (tooltipTitle) {
		// MUI requires a wrapper span around disabled buttons for Tooltip to work
		return (
			<Tooltip title={tooltipTitle} placement='left'>
				<span style={{ display: 'block' }}>{btn}</span>
			</Tooltip>
		);
	}

	return btn;
});

// ── Row ───────────────────────────────────────────────────────────────────────
// Generic label + content wrapper with consistent bottom margin.

interface RowProps {
	label: string;
	children: React.ReactNode;
}

export const Row = memo(function Row({ label, children }: RowProps) {
	return (
		<Box mb={1}>
			<Typography sx={{ fontSize: 11, color: greyColor(55), mb: 0.3, userSelect: 'none' }}>{label}</Typography>
			{children}
		</Box>
	);
});

// ── ColorRow ──────────────────────────────────────────────────────────────────
// Color swatch (MyPopoverColor) + hex label.

interface ColorRowProps {
	label: string;
	value: string;
	onChange: (color: string) => void;
}

export const ColorRow = memo(function ColorRow({ label, value, onChange }: ColorRowProps) {
	return (
		<Box mb={1}>
			<Typography sx={{ fontSize: 11, color: greyColor(55), mb: 0.3, userSelect: 'none' }}>{label}</Typography>
			<Stack direction='row' alignItems='center' gap={1}>
				<MyPopoverColor color={value} onChange={onChange} size={24} popoverOffset={[-10, 5]} />
				<Typography fontSize={11} color={greyColor(55)} sx={{ fontFamily: 'monospace' }}>
					{value}
				</Typography>
			</Stack>
		</Box>
	);
});

// ── SliderRow ─────────────────────────────────────────────────────────────────
// PanelSlider with consistent bottom margin (matches Row spacing).

interface SliderRowProps {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	onChange: (v: number) => void;
}

export const SliderRow = memo(function SliderRow({ label, value, min, max, step = 1, onChange }: SliderRowProps) {
	return <PanelSlider label={label} value={value} min={min} max={max} step={step} onChange={onChange} />;
});

// ── SectionAccordion ──────────────────────────────────────────────────────────
// Collapsible section with styled header.

interface SectionAccordionProps {
	title: string;
	expanded: boolean;
	onToggle: () => void;
	children: React.ReactNode;
}

export const SectionAccordion = memo(function SectionAccordion({ title, expanded, onToggle, children }: SectionAccordionProps) {
	const border = greyColor(25);
	const bg = greyColor(12);
	const bgHover = greyColor(18);
	const defColor = greyColor(80);

	return (
		<Accordion
			expanded={expanded}
			onChange={onToggle}
			disableGutters
			sx={{
				backgroundColor: bg,
				border: `1px solid ${border}`,
				borderRadius: '4px !important',
				mb: 0.5,
				'&:before': { display: 'none' },
				boxShadow: 'none',
			}}
		>
			<AccordionSummary
				expandIcon={<ChevronDown size={16} />}
				sx={{
					minHeight: 36,
					'&.Mui-expanded': { minHeight: 36 },
					'& .MuiAccordionSummary-content': { my: 0 },
					'&:hover': { backgroundColor: bgHover },
					borderRadius: '4px',
				}}
			>
				<Typography fontSize={12} fontWeight={600} color={defColor}>
					{title}
				</Typography>
			</AccordionSummary>
			<AccordionDetails sx={{ pt: 1, pb: 1.5, px: 1.5, borderTop: `1px solid ${border}` }}>
				{children}
			</AccordionDetails>
		</Accordion>
	);
});
