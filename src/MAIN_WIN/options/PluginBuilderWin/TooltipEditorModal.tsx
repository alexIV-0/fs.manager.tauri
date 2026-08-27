/**
 * Редактор подсказки свойства в конструкторе плагинов.
 *
 * Формат подсказки — markdown (тот же контракт, что у описания проекта), а не
 * HTML: раньше здесь стоял `RichTextEditor` на `document.execCommand`
 * (deprecated) и писал теги. Показ понимает оба формата (`TooltipBody`), но
 * писать новое имеет смысл только в одном — том, который выживает в чужом
 * рендерере и на сайте.
 *
 * Редактор — `MarkdownMiniEditor`, урезанный: в подсказке нет таблиц, картинок
 * и блок-схем (их вырежет `tooltipSanitizeSchema` при показе), зато есть цвет.
 */

import { useState, useEffect } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import { MarkdownMiniEditor } from '@/components/markdown/MarkdownMiniEditor';

interface TooltipEditorModalProps {
	open: boolean;
	value: string;
	onClose: () => void;
	onChange: (v: string) => void;
}

export function TooltipEditorModal({ open, value, onClose, onChange }: TooltipEditorModalProps) {
	const gray60 = greyColor(60);
	const [localValue, setLocalValue] = useState(value);

	useEffect(() => {
		if (open) {
			setLocalValue(value);
		}
	}, [open, value]);

	const handleSaveAndClose = () => {
		onChange(localValue);
		onClose();
	};

	return (
		<Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
			<DialogTitle sx={{ fontSize: 13, py: 1, pb: 0.75, color: gray60 }}>tooltip — Markdown</DialogTitle>
			<DialogContent sx={{ p: 2 }}>
				{/* key: при открытии модалки редактор пересобирается — иначе история правок
				    и выделение остаются от предыдущего свойства. */}
				<MarkdownMiniEditor
					key={open ? 'open' : 'closed'}
					value={localValue}
					onChange={setLocalValue}
					minRows={6}
					maxRows={18}
					onSubmit={handleSaveAndClose}
					onCancel={onClose}
				/>
			</DialogContent>
			<DialogActions>
				<Button size='small' onClick={onClose}>
					Закрыть
				</Button>
				<Button size='small' variant='contained' onClick={handleSaveAndClose}>
					Сохранить и закрыть
				</Button>
			</DialogActions>
		</Dialog>
	);
}
