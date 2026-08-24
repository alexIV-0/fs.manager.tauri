import { useEffect, useState } from 'react';
import { secondsToTimecode, timecodeToSeconds } from '@/Utils/numericFormat';

interface TimecodeInputProps {
	/** Значение в секундах. */
	value: number;
	onChange: (v: number) => void;
	min?: number;
	style?: React.CSSProperties;
	disabled?: boolean;
}

/**
 * Ввод таймкода `HH:MM:SS`. Коммитит (зовёт onChange) только на blur/Enter,
 * как NumInput. Внутрь/наружу — ЧИСЛО в секундах, наружу текст не протекает:
 * одиночное число без `:` трактуется как секунды.
 */
export function TimecodeInput({ value, onChange, min, style, disabled }: TimecodeInputProps) {
	const [local, setLocal] = useState(() => secondsToTimecode(value));

	useEffect(() => {
		setLocal(secondsToTimecode(value));
	}, [value]);

	const commit = () => {
		let parsed: number | null = null;
		if (local.trim() === '') {
			parsed = null; // пустое поле — не «ноль», а откат к прежнему значению
		} else if (local.includes(':')) {
			parsed = timecodeToSeconds(local);
		} else {
			const n = Number(local.trim().replace(',', '.'));
			parsed = Number.isFinite(n) ? n : null;
		}

		if (parsed === null || !Number.isFinite(parsed)) {
			setLocal(secondsToTimecode(value)); // мусор на входе — откат
			return;
		}
		const next = Math.round(min !== undefined ? Math.max(min, parsed) : parsed);
		onChange(next);
		setLocal(secondsToTimecode(next));
	};

	return (
		<input
			type='text'
			value={local}
			placeholder='00:00:00'
			onChange={(e) => setLocal(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === 'Enter') commit();
				if (e.key === 'Escape') setLocal(secondsToTimecode(value));
			}}
			style={style}
			disabled={disabled}
		/>
	);
}
