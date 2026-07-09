// TgSourceProperty — поле `target` ноды сбора autoTGcollect (ОДИН источник).
//
// Рендерится из GenericProperty для ddm, у которого options содержат '#tgSources'.
// single-select; платформа 'telegram' (тот же бот, что для постинга); discover БЕЗ проверки
// «право постить» (для сбора нужно лишь, чтобы бот видел чат — админ супергруппы / privacy off).
//
// Выпадающий список сгруппирован разделителями: -каналы / -темы / -чаты (SimpleDDM рисует
// заголовки из опций «-текст»). Можно выбрать канал, конкретную ТЕМУ форум-группы или простой
// чат. Bot API не перечисляет чаты/темы → каталог наполняется discover'ом (tg_discover_sources
// via getUpdates: чаты + темы из message_thread_id) или ручным вводом @username/id (tg_get_chat).
// chat_id/thread_id плагин резолвит из каталога при синке tgSearch.json.

import { DDMProperty } from '@/NODE_WIN/definitions/types';
import { commands, unwrap } from '@/Utils/specta';
import { usePathStore } from '@/Store/Node/usePathStore';
import { useNodeId, useReactFlow } from '@xyflow/react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Eye, MessageSquarePlus, Plus, Search } from 'lucide-react';
import { useCallback, useState } from 'react';
import SimpleDDMProperty from './SimpleDDM';

const PLATFORM = 'telegram';

interface Props {
	property: DDMProperty;
	onChange: (value: string) => void;
}

function mainFolderFromPath(path: string | undefined): string {
	if (!path) return '';
	const parts = path.split(/[\\/]+/).filter(Boolean);
	return parts.length >= 2 ? parts[parts.length - 2] : '';
}

// Имя проекта = последний сегмент пути (конвенция: тема = имя папки проекта).
function projectNameFromPath(path: string | undefined): string {
	if (!path) return '';
	const parts = path.split(/[\\/]+/).filter(Boolean);
	return parts.length >= 1 ? parts[parts.length - 1] : '';
}

// Читаемая метка чата для значения ноды (title); chat_id плагин резолвит из каталога.
function chatLabel(c: { id?: number | null; title?: string | null; username?: string | null }): string {
	if (c?.title) return c.title;
	if (c?.username) return `@${c.username}`;
	return c?.id != null ? String(c.id) : '';
}

export default function TgSourceProperty({ property, onChange }: Props) {
	const path = usePathStore((s) => s.path);
	const nodeId = useNodeId();
	const { getNode } = useReactFlow();

	const [open, setOpen] = useState(false);
	const [chatText, setChatText] = useState('');
	const [nameText, setNameText] = useState(''); // имя для темы (Bot API не отдаёт его по id)
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	const [discoverBusy, setDiscoverBusy] = useState(false);
	const [status, setStatus] = useState('');
	const [refreshKey, setRefreshKey] = useState(0); // форс ре-резолв списка после удаления

	const [checkBusy, setCheckBusy] = useState(false);
	const [checkOpen, setCheckOpen] = useState(false);
	const [checkText, setCheckText] = useState('');

	const [createOpen, setCreateOpen] = useState(false);
	const [createBusy, setCreateBusy] = useState(false);
	const [createName, setCreateName] = useState('');
	const [createGroupId, setCreateGroupId] = useState('');
	const [createGroups, setCreateGroups] = useState<{ id: number; title: string }[]>([]);
	const [createMsg, setCreateMsg] = useState('');

	// Имя выбранного бота сбора — из соседнего поля 'account' этой же ноды.
	const accountName = useCallback((): string => {
		if (!nodeId) return '';
		const node = getNode(nodeId);
		const props = (node?.data as any)?.properties ?? [];
		return props.find((pr: any) => pr.id === 'account')?.controlProps?.value ?? '';
	}, [nodeId, getNode]);

	// Тип сбора — из соседнего поля 'collect' ({type}).
	const collectType = useCallback((): string => {
		if (!nodeId) return 'video';
		const node = getNode(nodeId);
		const props = (node?.data as any)?.properties ?? [];
		return props.find((pr: any) => pr.id === 'collect')?.controlProps?.value?.type ?? 'video';
	}, [nodeId, getNode]);

	// Резолв выбранного источника (label) → (chatId, threadId) из каталога бота.
	const resolveTarget = useCallback(
		(sources: any[], label: string): { chatId: number | null; threadId: number | null } => {
			for (const c of sources) {
				for (const t of Array.isArray(c?.topics) ? c.topics : []) {
					const named = t?.name ? String(t.name) : '';
					const byId = t?.threadId != null ? `Topic #${t.threadId}` : '';
					if ((named && named === label) || (byId && byId === label))
						return { chatId: c?.id != null ? Number(c.id) : null, threadId: t?.threadId != null ? Number(t.threadId) : null };
				}
			}
			const c = sources.find(
				(c: any) => c?.title === label || (c?.username && `@${c.username}` === label) || String(c?.id) === label,
			);
			if (c?.id != null) return { chatId: Number(c.id), threadId: null };
			if (/^-?\d+$/.test(String(label).trim())) return { chatId: Number(String(label).trim()), threadId: null };
			return { chatId: null, threadId: null };
		},
		[],
	);

	// «Проверить» — пик getUpdates (без подтверждения offset): показывает, что бот СЕЙЧАС
	// видит в выбранном чате (по темам, тип медиа, человек/бот, заберётся ли). Это и есть
	// «поиск» — Bot API историю читать не умеет, виден только буфер апдейтов (~24ч), и только
	// если бот админ / privacy OFF. Не трогает offset раннера (peek), но если обработка уже
	// забрала апдейты — здесь будет пусто.
	const checkChat = useCallback(async () => {
		const mainFolderName = mainFolderFromPath(path);
		const acc = accountName();
		const targetVal = String((property.controlProps.value as any) ?? '');
		if (!mainFolderName || !acc) {
			setCheckText('Открой проект и выбери бота в поле Bot.');
			setCheckOpen(true);
			return;
		}
		if (!targetVal) {
			setCheckText('Сначала выбери источник в списке Source.');
			setCheckOpen(true);
			return;
		}
		setCheckBusy(true);
		try {
			const token = unwrap(await commands.accountGetToken(mainFolderName, PLATFORM, acc));
			const accList = unwrap(await commands.accountList(mainFolderName, PLATFORM)) as any[];
			const a = Array.isArray(accList) ? accList.find((x: any) => x?.name === acc) : null;
			const sources: any[] = Array.isArray(a?.channels) ? a.channels : [];
			const { chatId, threadId } = resolveTarget(sources, targetVal);
			if (chatId == null) {
				setCheckText(`Не удалось определить chatId для «${targetVal}». Выбери источник из списка.`);
				setCheckOpen(true);
				return;
			}
			// General в Telegram = thread 1 ЛИБО отсутствует; входящие в General приходят без thread_id.
			const isGeneral = (t: number | null) => t == null || t === 1;

			const updates = unwrap(await commands.tgGetUpdates(token, null)) as any[];
			const msgs = (Array.isArray(updates) ? updates : [])
				.map((u: any) => u.message ?? u.channel_post ?? u.edited_message)
				.filter(Boolean)
				.filter((m: any) => m.chat?.id === chatId);

			const head = `Чат «${targetVal}» (chatId=${chatId}), целевая тема: ${isGeneral(threadId) ? 'General (общая)' : `thread=${threadId}`}.\nТип сбора: ${collectType()}.\n`;
			if (msgs.length === 0) {
				setCheckText(
					head +
						`\nБот «${acc}» НЕ видит сообщений в этом чате.\nПричины:\n• бот не админ группы (включи админом, либо @BotFather → /setprivacy → Disable);\n• за последние ~24ч в чат ничего не присылали;\n• апдейты уже забраны обработкой (раннер подтверждает offset).`,
				);
				setCheckOpen(true);
				return;
			}

			const kindOf = (m: any): string =>
				m.video ? 'video' : Array.isArray(m.photo) ? 'photo' : m.audio || m.voice ? 'audio' : m.document ? 'document' : 'text';
			const want = collectType();
			let collectible = 0;
			const lines = msgs.map((m: any) => {
				const k = kindOf(m);
				const tid = m.message_thread_id ?? null;
				const bot = !!m.from?.is_bot;
				const inTarget = isGeneral(threadId) ? isGeneral(tid) : tid === threadId;
				const will = inTarget && !bot && k === want;
				if (will) collectible++;
				const flags = [bot ? 'бот→пропуск' : 'человек', inTarget ? 'целевая тема' : 'др. тема', will ? '✓ заберётся' : '—'];
				return `• ${isGeneral(tid) ? 'General' : `thread=${tid}`}  ${k}  (${flags.join(', ')})`;
			});
			setCheckText(head + `\nВидно сообщений: ${msgs.length}\n${lines.join('\n')}\n\nЗаберётся при сборе: ${collectible}.`);
			setCheckOpen(true);
		} catch (e) {
			setCheckText('Ошибка проверки: ' + String(e));
			setCheckOpen(true);
		} finally {
			setCheckBusy(false);
		}
	}, [path, accountName, collectType, resolveTarget, property.controlProps.value]);

	// «Создать тему» — открывает диалог: список групп из каталога + имя темы (= имя папки).
	const openCreate = useCallback(async () => {
		setCreateMsg('');
		setCreateName(projectNameFromPath(path));
		setCreateGroups([]);
		setCreateGroupId('');
		setCreateOpen(true);
		const mainFolderName = mainFolderFromPath(path);
		const acc = accountName();
		if (!mainFolderName || !acc) {
			setCreateMsg('Открой проект и выбери бота в поле Bot.');
			return;
		}
		try {
			const accList = unwrap(await commands.accountList(mainFolderName, PLATFORM)) as any[];
			const a = Array.isArray(accList) ? accList.find((x: any) => x?.name === acc) : null;
			const groups = (Array.isArray(a?.channels) ? a.channels : [])
				.filter((c: any) => c?.type === 'group' || c?.type === 'supergroup')
				.map((c: any) => ({ id: Number(c.id), title: c?.title || String(c?.id) }));
			setCreateGroups(groups);
			if (groups.length === 1) setCreateGroupId(String(groups[0].id));
			if (groups.length === 0) setCreateMsg('Нет групп в каталоге. Сначала «Найти чаты» (бот должен быть в группе).');
		} catch (e) {
			setCreateMsg('Ошибка загрузки групп: ' + String(e));
		}
	}, [path, accountName]);

	// Создать тему (или вернуть существующую по имени) → каталог → выбрать в ноде.
	const createTopic = useCallback(async () => {
		const mainFolderName = mainFolderFromPath(path);
		const acc = accountName();
		const name = createName.trim();
		const chatId = Number(createGroupId);
		if (!mainFolderName || !acc) {
			setCreateMsg('Открой проект и выбери бота.');
			return;
		}
		if (!chatId) {
			setCreateMsg('Выбери группу.');
			return;
		}
		if (!name) {
			setCreateMsg('Введи имя темы.');
			return;
		}
		setCreateBusy(true);
		setCreateMsg('');
		try {
			const accList = unwrap(await commands.accountList(mainFolderName, PLATFORM)) as any[];
			const a = Array.isArray(accList) ? accList.find((x: any) => x?.name === acc) : null;
			const group = (Array.isArray(a?.channels) ? a.channels : []).find((c: any) => Number(c?.id) === chatId);

			// уже есть тема с таким именем в этой группе → просто выбрать
			const existing = (Array.isArray(group?.topics) ? group.topics : []).find((t: any) => (t?.name ?? '') === name);
			if (existing) {
				onChange(name);
				setStatus(`Тема «${name}» уже есть (thread=${existing.threadId}). Выбрана.`);
				setRefreshKey((k) => k + 1);
				setCreateOpen(false);
				return;
			}

			const token = unwrap(await commands.accountGetToken(mainFolderName, PLATFORM, acc));
			const created = unwrap(await commands.tgCreateForumTopic(token, chatId, name)) as any;
			const threadId = created?.threadId != null ? Number(created.threadId) : null;
			if (threadId == null) {
				setCreateMsg('Тема создана, но Telegram не вернул threadId.');
				return;
			}

			// мердж в каталог (не затирая прочие темы группы)
			const tmap = new Map<number, { threadId: number; name: string | null }>();
			for (const t of Array.isArray(group?.topics) ? group.topics : [])
				if (t?.threadId != null) tmap.set(Number(t.threadId), { threadId: Number(t.threadId), name: t.name ?? null });
			tmap.set(threadId, { threadId, name });
			const source = {
				id: group?.id ?? chatId,
				title: group?.title ?? null,
				username: group?.username ?? null,
				type: group?.type ?? 'supergroup',
				isForum: true,
				topics: Array.from(tmap.values()),
			};
			unwrap(await commands.accountAddChannel(mainFolderName, PLATFORM, acc, source as any));
			onChange(name);
			setStatus(`Тема «${name}» создана (thread=${threadId}). Выбрана.`);
			setRefreshKey((k) => k + 1);
			setCreateOpen(false);
		} catch (e) {
			setCreateMsg('Не удалось создать тему: ' + String(e));
		} finally {
			setCreateBusy(false);
		}
	}, [path, accountName, createName, createGroupId, onChange]);

	// Ручной ввод: @username/id чата ИЛИ ссылка на ТЕМУ t.me/c/<id>/<thread> → каталог → выбрать.
	const addSource = useCallback(async () => {
		const mainFolderName = mainFolderFromPath(path);
		if (!mainFolderName) {
			setError('Открой проект — нет главной папки.');
			return;
		}
		const acc = accountName();
		if (!acc) {
			setError('Сначала выбери бота в поле Bot.');
			return;
		}
		const raw = chatText.trim();
		if (!raw) {
			setError('Введи @username/id чата ИЛИ ссылку на тему: t.me/c/<id>/<thread>.');
			return;
		}
		setBusy(true);
		setError('');
		try {
			const token = unwrap(await commands.accountGetToken(mainFolderName, PLATFORM, acc));

			// Ссылка на ТЕМУ форума: t.me/c/<internalId>/<threadId>[/<msgId>] → (chatId, threadId).
			const topicMatch = raw.match(/(?:t\.me\/)?c\/(\d+)\/(\d+)/i);
			if (topicMatch) {
				const chatId = Number(`-100${topicMatch[1]}`);
				const threadId = Number(topicMatch[2]);
				const customName = nameText.trim(); // имя темы от пользователя (Bot API его не отдаёт)
				// резолвим группу по chatId (getChat не требует privacy, но бот должен быть в группе)
				const info = unwrap(await commands.tgGetChat(token, String(chatId))) as any;
				// мерджим тему с уже сохранёнными темами этого чата (не затирая их)
				let prevTopics: any[] = [];
				try {
					const accList = unwrap(await commands.accountList(mainFolderName, PLATFORM)) as any[];
					const a = Array.isArray(accList) ? accList.find((x: any) => x?.name === acc) : null;
					const ex = Array.isArray(a?.channels) ? a.channels.find((c: any) => Number(c?.id) === chatId) : null;
					prevTopics = Array.isArray(ex?.topics) ? ex.topics : [];
				} catch {
					/* каталога ещё нет — ок */
				}
				const tmap = new Map<number, { threadId: number; name: string | null }>();
				for (const t of prevTopics)
					if (t?.threadId != null) tmap.set(Number(t.threadId), { threadId: Number(t.threadId), name: t.name ?? null });
				// имя: введённое пользователем > уже сохранённое > null
				const name = customName || tmap.get(threadId)?.name || null;
				tmap.set(threadId, { threadId, name });
				const source = {
					id: info.id ?? chatId,
					title: info.title ?? null,
					username: info.username ?? null,
					type: info.type ?? null,
					isForum: Boolean(info.isForum),
					topics: Array.from(tmap.values()),
				};
				unwrap(await commands.accountAddChannel(mainFolderName, PLATFORM, acc, source as any));
				onChange(name || `Topic #${threadId}`); // выбираем по имени, если задано
				setOpen(false);
				setChatText('');
				setNameText('');
				return;
			}

			// Обычный чат/канал по @username/id.
			const chat = raw.replace(/^https?:\/\/t\.me\//i, '@').replace(/^@@/, '@');
			const info = unwrap(await commands.tgGetChat(token, chat)) as any; // бросит, если бот не видит чат
			const source = {
				id: info.id,
				title: info.title ?? null,
				username: info.username ?? null,
				type: info.type ?? null,
				isForum: Boolean(info.isForum),
				topics: Array.isArray(info.topics) ? info.topics : [],
			};
			unwrap(await commands.accountAddChannel(mainFolderName, PLATFORM, acc, source as any));

			const label = chatLabel(source);
			if (label) onChange(label);

			setOpen(false);
			setChatText('');
		} catch (e) {
			setError('Не удалось добавить: ' + String(e));
		} finally {
			setBusy(false);
		}
	}, [path, accountName, chatText, nameText, onChange]);

	// Авто-обнаружение чатов, куда добавлен бот сбора (getUpdates, без canPost).
	const discoverSources = useCallback(async () => {
		const mainFolderName = mainFolderFromPath(path);
		if (!mainFolderName) {
			setStatus('Открой проект — нет главной папки.');
			return;
		}
		const acc = accountName();
		if (!acc) {
			setStatus('Сначала выбери бота сбора в поле Collect Bot.');
			return;
		}
		setDiscoverBusy(true);
		setStatus('');
		try {
			const token = unwrap(await commands.accountGetToken(mainFolderName, PLATFORM, acc));
			const found = unwrap(await commands.tgDiscoverSources(token)) as any[];
			const list = Array.isArray(found) ? found : [];

			// Существующий каталог — чтобы СЛИТЬ темы: discover видит только текущее окно
			// getUpdates (~24ч), а темы должны накапливаться между запусками.
			let existing: any[] = [];
			try {
				const accList = unwrap(await commands.accountList(mainFolderName, PLATFORM)) as any[];
				const a = Array.isArray(accList) ? accList.find((x: any) => x?.name === acc) : null;
				existing = Array.isArray(a?.channels) ? a.channels : [];
			} catch {
				/* нет каталога — ок */
			}
			const prevTopicsById = new Map<any, any[]>();
			for (const e of existing) if (e?.id != null) prevTopicsById.set(e.id, Array.isArray(e.topics) ? e.topics : []);

			for (const c of list) {
				// темы = старые ∪ новые (по threadId); имя берём непустое
				const merged = new Map<number, { threadId: number; name: string | null }>();
				for (const t of prevTopicsById.get(c.id) ?? []) {
					if (t?.threadId != null) merged.set(Number(t.threadId), { threadId: Number(t.threadId), name: t.name ?? null });
				}
				for (const t of Array.isArray(c.topics) ? c.topics : []) {
					if (t?.threadId == null) continue;
					const tid = Number(t.threadId);
					// существующее имя (в т.ч. ручное) приоритетнее — discover лишь ЗАПОЛНЯЕТ пустое
					merged.set(tid, { threadId: tid, name: merged.get(tid)?.name ?? t.name ?? null });
				}
				const source = {
					id: c.id,
					title: c.title ?? null,
					username: c.username ?? null,
					type: c.type ?? null,
					isForum: Boolean(c.isForum),
					topics: Array.from(merged.values()),
				};
				unwrap(await commands.accountAddChannel(mainFolderName, PLATFORM, acc, source as any));
			}
			if (list.length === 0) {
				setStatus('Чаты не найдены. Добавь бота в супергруппу/группу (админом) и нажми снова.');
			} else {
				setStatus(`Найдено и добавлено в каталог: ${list.length}. Выбери нужный в списке выше.`);
			}
		} catch (e) {
			setStatus('Не удалось найти чаты: ' + String(e));
		} finally {
			setDiscoverBusy(false);
		}
	}, [path, accountName]);

	// Удаление пункта из списка: канал/чат (по chatId) или тема (по chatId+threadId).
	// Резолвим метку → цель из каталога (темы — первыми, затем чат/канал).
	const handleDelete = useCallback(
		async (label: string) => {
			const mainFolderName = mainFolderFromPath(path);
			const acc = accountName();
			if (!mainFolderName || !acc) return;
			try {
				const accList = unwrap(await commands.accountList(mainFolderName, PLATFORM)) as any[];
				const a = Array.isArray(accList) ? accList.find((x: any) => x?.name === acc) : null;
				const sources: any[] = Array.isArray(a?.channels) ? a.channels : [];

				let chatId: number | null = null;
				let threadId: number | null = null;
				outer: for (const c of sources) {
					for (const t of Array.isArray(c?.topics) ? c.topics : []) {
						const named = t?.name ? String(t.name) : '';
						const byId = t?.threadId != null ? `Topic #${t.threadId}` : '';
						if ((named && named === label) || (byId && byId === label)) {
							chatId = c?.id != null ? Number(c.id) : null;
							threadId = t?.threadId != null ? Number(t.threadId) : null;
							break outer;
						}
					}
				}
				if (chatId == null) {
					const c = sources.find(
						(c: any) => c?.title === label || (c?.username && `@${c.username}` === label) || String(c?.id) === label,
					);
					if (c?.id != null) chatId = Number(c.id);
				}
				if (chatId == null) return; // не нашли в каталоге — нечего удалять

				unwrap(await commands.accountRemoveChannel(mainFolderName, PLATFORM, acc, chatId, threadId));
				if (property.controlProps.value === label) onChange('');
				setRefreshKey((k) => k + 1);
			} catch (e) {
				console.error('[TgSourceProperty] не удалось удалить из каталога:', e);
			}
		},
		[path, accountName, property.controlProps.value, onChange],
	);

	// Разделители (---текст) не удаляем; всё остальное — да.
	const isDeletable = useCallback((opt: string) => !/^-{3,}/.test(opt.trim()), []);

	return (
		<>
			<SimpleDDMProperty
				key={refreshKey}
				property={property}
				onChange={onChange}
				onOptionDelete={handleDelete}
				isOptionDeletable={isDeletable}
			/>

			<Stack px='12px' gap={0.5}>
				<Stack direction='row' gap={0.5} flexWrap='wrap'>
					<Button size='small' variant='text' startIcon={<Search size={14} />} onClick={discoverSources} disabled={discoverBusy}>
						{discoverBusy ? 'Поиск…' : 'Найти чаты'}
					</Button>
					<Button
						size='small'
						variant='text'
						startIcon={<Plus size={14} />}
						onClick={() => {
							setError('');
							setChatText('');
							setNameText('');
							setOpen(true);
						}}
					>
						Добавить вручную
					</Button>
					<Button size='small' variant='text' startIcon={<Eye size={14} />} onClick={checkChat} disabled={checkBusy}>
						{checkBusy ? 'Проверка…' : 'Проверить'}
					</Button>
					<Button size='small' variant='text' startIcon={<MessageSquarePlus size={14} />} onClick={openCreate}>
						Создать тему
					</Button>
				</Stack>
				{status && (
					<Typography variant='caption' color='text.secondary'>
						{status}
					</Typography>
				)}
			</Stack>

			<Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth='sm'>
				<DialogTitle>Добавить источник Telegram</DialogTitle>
				<DialogContent>
					<Stack gap={1.5} mt={0.5}>
						<Typography variant='body2' color='text.secondary'>
							Бот должен быть в чате/супергруппе (для сбора медиа — <b>администратором</b> или с
							выключенным privacy mode). Варианты ввода:
							<br />
							• <b>чат/канал</b>: <code>@username</code> или числовой <code>id</code> (<code>-100…</code>),
							или ссылка <code>t.me/username</code>;
							<br />
							• <b>тема форума</b>: ссылка на тему вида <code>t.me/c/&lt;id&gt;/&lt;thread&gt;</code> (правый
							клик по теме → «Копировать ссылку»). Имя темы подтянется позже через «Найти чаты»;
							пока покажется как <code>Topic #N</code>.
						</Typography>

						<TextField
							label='@username  /  id  /  t.me/username  /  t.me/c/<id>/<thread>'
							value={chatText}
							onChange={(e) => setChatText(e.target.value)}
							fullWidth
							autoFocus
						/>

						<TextField
							label='Имя темы (необязательно — для ссылки на тему)'
							value={nameText}
							onChange={(e) => setNameText(e.target.value)}
							fullWidth
							helperText='Bot API не отдаёт имя темы по ссылке. Впиши, как назвать её в списке (напр. «# vk post publish»). Для обычного чата — оставь пустым.'
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
					<Button onClick={addSource} disabled={busy} variant='contained'>
						{busy ? 'Проверка…' : 'Добавить'}
					</Button>
				</DialogActions>
			</Dialog>

			<Dialog open={checkOpen} onClose={() => setCheckOpen(false)} fullWidth maxWidth='sm'>
				<DialogTitle>Что бот видит в чате</DialogTitle>
				<DialogContent>
					<Typography variant='body2' color='text.secondary' sx={{ whiteSpace: 'pre-line', fontFamily: 'monospace', fontSize: 12 }}>
						{checkText}
					</Typography>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setCheckOpen(false)}>Закрыть</Button>
				</DialogActions>
			</Dialog>

			<Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth='sm'>
				<DialogTitle>Создать тему форума</DialogTitle>
				<DialogContent>
					<Stack gap={1.5} mt={0.5}>
						<Typography variant='body2' color='text.secondary'>
							Создаёт тему в выбранной группе (бот должен быть <b>админом</b> с правом управлять темами).
							Если тема с таким именем уже есть — просто выберется существующая.
						</Typography>
						<TextField
							select
							label='Группа'
							value={createGroupId}
							onChange={(e) => setCreateGroupId(e.target.value)}
							fullWidth
							disabled={createGroups.length === 0}
						>
							{createGroups.map((g) => (
								<MenuItem key={g.id} value={String(g.id)}>
									{g.title}
								</MenuItem>
							))}
						</TextField>
						<TextField
							label='Имя темы (= имя папки проекта)'
							value={createName}
							onChange={(e) => setCreateName(e.target.value)}
							fullWidth
						/>
						{createMsg && (
							<Typography variant='body2' color='text.secondary'>
								{createMsg}
							</Typography>
						)}
					</Stack>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setCreateOpen(false)} disabled={createBusy}>
						Отмена
					</Button>
					<Button onClick={createTopic} disabled={createBusy} variant='contained'>
						{createBusy ? 'Создание…' : 'Создать / выбрать'}
					</Button>
				</DialogActions>
			</Dialog>
		</>
	);
}
