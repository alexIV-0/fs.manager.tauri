import { cyanColor, greyColor } from '@/Store/Color/grayColor';
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Box, IconButton, List } from '@mui/material';
import { ListRestart, Plus } from 'lucide-react';
import { CustomSettinsElement } from '../FileExplorerColumn/CustomSettinsElement';
import { automationListStyle } from '../mainStyles';
import MarkdownText from './MarkdownText';
import { PatternStore } from '@/Store/MainWin/pathPattern_store';
import { useState } from 'react';

type PathData = {
	title: string;
	store: PatternStore;
	color?: string | null;
	options?: string[];
	restoreButtom?: boolean;
	multiselect?: boolean;
	optionsOnly?: boolean;
	allowDuplicates?: boolean;
};

export function CustomUserSettings(prop: PathData) {
	const { title, store, color = null, options, restoreButtom = false, multiselect = true, allowDuplicates = false, optionsOnly = false } = prop;

	const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 5 },
		}),
	);

	const handleAddPathPattern = () => {
		store.addPatternElement('new', [], color || undefined);
	};

	const handleRestoreStore = () => {
		store.restoreDefault();
	};

	const handleDragEnd = (event: any) => {
		if (isColorPickerOpen) return;

		const { active, over } = event;
		if (!over || active.id === over.id) return;

		const oldIndex = store.patternStore.findIndex((el) => el.id === active.id);
		const newIndex = store.patternStore.findIndex((el) => el.id === over.id);

		if (oldIndex !== -1 && newIndex !== -1) {
			store.movePatternElement(oldIndex, newIndex);
		}
	};

	return (
		<Box
			sx={{
				width: '100%',
				pb: 1.5,
				mb: 2,
				mt: 1,
				borderBottom: 1,
				borderColor: cyanColor(80),
				// bgcolor: greyColor(15),
			}}
		>
			<MarkdownText>{title}</MarkdownText>

			<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
				<SortableContext items={store.patternStore.map((p) => p.id)} strategy={verticalListSortingStrategy} disabled={isColorPickerOpen}>
					<List disablePadding sx={automationListStyle}>
						{store.patternStore.map((pattern) => (
							<CustomSettinsElement
								key={pattern.id}
								id={pattern.id}
								name={pattern.name}
								store={store}
								useColor={color === undefined ? pattern.color : undefined}
								onColorPickerOpenChange={setIsColorPickerOpen}
								options={options}
								optionsOnly={optionsOnly}
								multiSelect={multiselect}
								allowDuplicates={allowDuplicates}
							/>
						))}
					</List>
				</SortableContext>
			</DndContext>

			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					p: '0px 8px',
				}}
			>
				<IconButton size='small' onClick={handleAddPathPattern}>
					<Plus color={greyColor(80)} />
				</IconButton>

				{restoreButtom && (
					<IconButton size='small' onClick={handleRestoreStore}>
						<ListRestart color={greyColor(80)} />
					</IconButton>
				)}
			</Box>
		</Box>
	);
}
