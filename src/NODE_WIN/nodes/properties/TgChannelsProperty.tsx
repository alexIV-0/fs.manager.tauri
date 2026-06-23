// TgChannelsProperty — поле `channels` ноды постинга в Telegram (мультивыбор каналов).
//
// Рендерится из GenericProperty для autocomplete, у которого options содержат '#tgChannels'.
// Bot API НЕ умеет перечислять каналы бота (нет аналога groups.get), поэтому канал
// добавляется вручную: вводим @handle/id → валидируем tg_get_chat (бот должен быть админом
// с правом постить) → сохраняем в каталог аккаунта (account_add_channel, токен не трогаем)
// → авто-выбираем в ноде. Сам мультивыбор/чипы — переиспользуем ChipAutocompleteProperty.

import { Property } from '@/NODE_WIN/definitions/types';
import { commands, unwrap } from '@/Utils/specta';
import { usePathStore } from '@/Store/Node/usePathStore';
import { useNodeId, useReactFlow } from '@xyflow/react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { Plus, Search } from 'lucide-react';
import { useCallback, useState } from 'react';
import ChipAutocompleteProperty from './ChipAutocompleteProperty';

const PLATFORM = 'telegram';

interface Props {
	property: Property;
	onChange: (value: string[]) => void;
}

function mainFolderFromPath(path: string | undefined): string {
	if (!path) return '';
	const parts = path.split(/[\\/]+/).filter(Boolean);
	return parts.length >= 2 ? parts[parts.length - 2] : '';
}

// Читаемая метка канала для значения ноды (title); chat_id плагин резолвит из каталога.
// Fallback на @username/id, если title пуст.
function channelLabel(c: { id?: number | null; title?: string | null; username?: string | null }): string {
	if (c?.title) return c.title;
	if (c?.username) return `@${c.username}`;
	return c?.id != null ? String(c.id) : '';
}

export default function TgChannelsProperty({ property, onChange }: Props) {
	const path = usePathStore((s) => s.path);
	const nodeId = useNodeId();
	const { getNode } = useReactFlow();

	const [open, setOpen] = useState(false);
	const [chatText, setChatText] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	// «Найти мои каналы» — авто-обнаружение через getUpdates
	const [discoverBusy, setDiscoverBusy] = useState(false);
	const [status, setStatus] = useState('');

	// Имя выбранного бота — из соседнего поля 'account' этой же ноды.
	const accountName = useCallback((): string => {
		if (!nodeId) return '';
		const node = getNode(nodeId);
		const props = (node?.data as any)?.properties ?? [];
		return props.find((pr: any) => pr.id === 'account')?.controlProps?.value ?? '';
	}, [nodeId, getNode]);

	const addChannel = useCallback(async () => {
		const mainFolderName = mainFolderFromPath(path);
		if (!mainFolderName) {
			setError('Открой проект — нет главной папки.');
			return;
		}
		const acc = accountName();
		if (!acc) {
			setError('Сначала выбери бота в поле Account.');
			return;
		}
		const chat = chatText.trim().replace(/^https?:\/\/t\.me\//i, '@').replace(/^@@/, '@');
		if (!chat) {
			setError('Введи @username канала или его числовой id.');
			return;
		}
		setBusy(true);
		setError('');
		try {
			const token = unwrap(await commands.accountGetToken(mainFolderName, PLATFORM, acc));
			const info = unwrap(await commands.tgGetChat(token, chat)) as any; // бросит, если бот не видит канал
			if (!info?.canPost) {
				setError('Бот не админ канала или нет права «Публиковать сообщения». Добавь бота админом и повтори.');
				return;
			}
			const channel = { id: info.id, title: info.title ?? null, username: info.username ?? null };
			unwrap(await commands.accountAddChannel(mainFolderName, PLATFORM, acc, channel as any));

			// авто-выбор: дописываем читаемое имя канала в значение ноды (если ещё не выбрано)
			const label = channelLabel(channel);
			const raw = property.controlProps.value;
			const current: string[] = Array.isArray(raw) ? raw.map(String) : [];
			if (label && !current.includes(label)) onChange([...current, label]);

			setOpen(false);
			setChatText('');
		} catch (e) {
			setError('Не удалось добавить канал: ' + String(e));
		} finally {
			setBusy(false);
		}
	}, [path, accountName, chatText, property.controlProps.value, onChange]);

	// Авто-обнаружение: бот добавлен админом → находим каналы из getUpdates,
	// сохраняем в каталог и сразу выбираем. Юзеру не нужен chat_id.
	const discoverChannels = useCallback(async () => {
		const mainFolderName = mainFolderFromPath(path);
		if (!mainFolderName) {
			setStatus('Открой проект — нет главной папки.');
			return;
		}
		const acc = accountName();
		if (!acc) {
			setStatus('Сначала выбери бота в поле Account.');
			return;
		}
		setDiscoverBusy(true);
		setStatus('');
		try {
			const token = unwrap(await commands.accountGetToken(mainFolderName, PLATFORM, acc));
			const found = unwrap(await commands.tgDiscoverChannels(token)) as any[];
			const list = Array.isArray(found) ? found : [];
			const postable = list.filter((c) => c?.canPost);
			const noRights = list.filter((c) => !c?.canPost);

			const raw = property.controlProps.value;
			const selected: string[] = Array.isArray(raw) ? raw.map(String) : [];
			for (const c of postable) {
				const channel = { id: c.id, title: c.title ?? null, username: c.username ?? null };
				unwrap(await commands.accountAddChannel(mainFolderName, PLATFORM, acc, channel as any));
				const label = channelLabel(channel);
				if (label && !selected.includes(label)) selected.push(label);
			}
			onChange(selected);

			if (list.length === 0) {
				setStatus('Каналы не найдены. Добавь бота админом в канал и нажми снова.');
			} else {
				const noRightsNote = noRights.length
					? ` Без права постить: ${noRights.length} — включи боту «Публиковать сообщения».`
					: '';
				setStatus(`Найдено и добавлено каналов: ${postable.length}.${noRightsNote}`);
			}
		} catch (e) {
			setStatus('Не удалось найти каналы: ' + String(e));
		} finally {
			setDiscoverBusy(false);
		}
	}, [path, accountName, property.controlProps.value, onChange]);

	return (
		<>
			<ChipAutocompleteProperty property={property} onChange={onChange} />

			<Stack px='12px' gap={0.5}>
				<Stack direction='row' gap={0.5} flexWrap='wrap'>
					<Button
						size='small'
						variant='text'
						startIcon={<Search size={14} />}
						onClick={discoverChannels}
						disabled={discoverBusy}
					>
						{discoverBusy ? 'Поиск…' : 'Найти мои каналы'}
					</Button>
					<Button
						size='small'
						variant='text'
						startIcon={<Plus size={14} />}
						onClick={() => {
							setError('');
							setChatText('');
							setOpen(true);
						}}
					>
						Добавить вручную
					</Button>
				</Stack>
				{status && (
					<Typography variant='caption' color='text.secondary'>
						{status}
					</Typography>
				)}
			</Stack>

			<Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth='sm'>
				<DialogTitle>Добавить канал Telegram</DialogTitle>
				<DialogContent>
					<Stack gap={1.5} mt={0.5}>
						<Typography variant='body2' color='text.secondary'>
							1. Добавь бота <b>администратором</b> канала с правом «Публиковать сообщения».
							<br />
							2. Введи <code>@username</code> канала (публичный) или числовой <code>id</code> (приватный,
							вид <code>-100…</code>). Можно вставить ссылку <code>t.me/username</code>.
						</Typography>

						<TextField
							label='@username  /  id  /  t.me/username'
							value={chatText}
							onChange={(e) => setChatText(e.target.value)}
							fullWidth
							autoFocus
						/>

						{error && (
							<Typography variant='body2' color='error'>
								{error}
							</Typography>
						)}
					</Stack>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setOpen(false)} disabled={busy}>
						Отмена
					</Button>
					<Button onClick={addChannel} disabled={busy} variant='contained'>
						{busy ? 'Проверка…' : 'Добавить'}
					</Button>
				</DialogActions>
			</Dialog>
		</>
	);
}
