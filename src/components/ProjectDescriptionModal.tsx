/**
 * Описание проекта — `{project}/options/description.md`.
 *
 * Файл сам по себе едет на сайт: `options/description.md` — это третий служебный
 * сайдкар (`Sidecar::Description` в `src-tauri/src/storage/types.rs`), его
 * перехватывает `upload_local` и кладёт в канонический ключ, по которому читает
 * сайт. Поэтому здесь никакой сетевой логики: записали файл — дальше сработает
 * вотчер. Заливать его обычным путём `presign`/`notify` НЕЛЬЗЯ: объект ляжет
 * рядом с тем, который читает сайт (`R2_SYNC_PLAN.md`, п. 25).
 *
 * Формат содержимого — контракт с сайтом:
 * `ideasAndTest/DESCRIPTION_FORMAT_CONTRACT.md`.
 *
 * Модалка открывается из двух окон (MAIN_WIN и NODE_WIN) — это разные JS-реалмы,
 * поэтому источник истины здесь только файл, никакого общего стора.
 */

import { useCallback, useEffect, useState } from 'react';
import { Box, Button, CircularProgress, Modal, Tooltip, Typography } from '@mui/material';
import { FileText, X } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import { commands, unwrap } from '@/Utils/specta';
import { joinPath } from '@/Utils/joinPath';
import MarkdownEditor from './markdown/MarkdownEditor';
import { DESCRIPTION_FILE, DESCRIPTION_SIZE_WARN } from './markdown/markdownFormat';

interface ProjectDescriptionModalProps {
	open: boolean;
	onClose: () => void;
	projectName: string;
	/** Путь к папке проекта (не к `options/`). */
	projectPath: string;
}

/** Прочитать файл описания. Нет файла — пустая строка, это нормальный случай. */
async function readDescription(projectPath: string): Promise<string> {
	const path = joinPath(projectPath, 'options', DESCRIPTION_FILE);
	try {
		return unwrap(await commands.readFileSync(path));
	} catch {
		return '';
	}
}

export function ProjectDescriptionModal({ open, onClose, projectName, projectPath }: ProjectDescriptionModalProps) {
	const [text, setText] = useState('');
	const [loadKey, setLoadKey] = useState(0);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	// Что лежало в файле на момент открытия — с этим сверяемся перед записью.
	const [loaded, setLoaded] = useState('');

	useEffect(() => {
		if (!open || !projectPath) return;
		let alive = true;
		setLoading(true);
		readDescription(projectPath)
			.then((content) => {
				if (!alive) return;
				setLoaded(content);
				setText(content);
				setLoadKey((k) => k + 1);
			})
			.finally(() => {
				if (alive) setLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [open, projectPath]);

	const dirty = text !== loaded;

	const handleSave = useCallback(async () => {
		if (!projectPath) return;
		setSaving(true);
		try {
			// Писателей у файла трое: это окно, второе окно и сайт (через
			// pull_sidecar). Молча затирать чужую правку нельзя — сверяемся.
			const current = await readDescription(projectPath);
			if (current !== loaded) {
				const ok = window.confirm(
					'Описание изменилось с момента открытия — возможно, его правили на сайте или в другом окне.\n\n' +
						'Перезаписать своей версией?',
				);
				if (!ok) return;
			}

			const optionsDir = joinPath(projectPath, 'options');
			unwrap(await commands.testAndCreateFolder(optionsDir));
			unwrap(await commands.writeFileAtomic(joinPath(optionsDir, DESCRIPTION_FILE), text));
			setLoaded(text);
		} catch (err) {
			window.alert(`Не удалось сохранить описание:\n${String(err)}`);
		} finally {
			setSaving(false);
		}
	}, [loaded, projectPath, text]);

	const handleClose = useCallback(() => {
		if (dirty && !window.confirm('Описание не сохранено. Закрыть без сохранения?')) return;
		onClose();
	}, [dirty, onClose]);

	const bytes = new TextEncoder().encode(text).length;

	return (
		<Modal open={open} onClose={handleClose}>
			<Box
				sx={{
					position: 'absolute',
					top: '50%',
					left: '50%',
					transform: 'translate(-50%, -50%)',
					width: '88%',
					height: '88%',
					display: 'flex',
					flexDirection: 'column',
					bgcolor: greyColor(18),
					border: `2px solid ${greyColor(40)}`,
					borderRadius: '4px',
					boxShadow: 24,
					overflow: 'hidden',
				}}
			>
				{/* Заголовок */}
				<Box
					sx={{
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
						px: 2,
						py: 1.25,
						borderBottom: `1px solid ${greyColor(50)}`,
						flexShrink: 0,
					}}
				>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
						<FileText size={18} />
						<Typography sx={{ fontSize: 16, fontWeight: 600 }}>Описание — {projectName}</Typography>
						<Tooltip title='Файл options/description.md. Уезжает на сайт сам, отдельной кнопки «опубликовать» нет.' arrow>
							<Typography sx={{ fontSize: 11, color: greyColor(55), ml: 1 }}>options/{DESCRIPTION_FILE}</Typography>
						</Tooltip>
					</Box>

					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
						{bytes > DESCRIPTION_SIZE_WARN && (
							<Typography sx={{ fontSize: 11, color: '#fab387' }}>
								файл больше 2 МБ — уменьшите картинки, он целиком уезжает на каждое сохранение
							</Typography>
						)}
						{loading && <CircularProgress size={14} />}
						<Button size='small' variant='contained' disabled={!dirty || saving || loading} onClick={handleSave}>
							{saving ? 'Сохраняю…' : 'Сохранить'}
						</Button>
						<Box
							component='button'
							onClick={handleClose}
							sx={{
								background: 'none',
								border: 'none',
								cursor: 'pointer',
								padding: '4px',
								display: 'flex',
								alignItems: 'center',
								color: greyColor(70),
								'&:hover': { opacity: 0.7 },
							}}
						>
							<X size={18} />
						</Box>
					</Box>
				</Box>

				{/* Редактор */}
				<Box sx={{ flex: 1, minHeight: 0, p: 1.5 }}>
					<MarkdownEditor value={text} onChange={setText} loadKey={loadKey} minHeight='100%' />
				</Box>
			</Box>
		</Modal>
	);
}

export default ProjectDescriptionModal;
