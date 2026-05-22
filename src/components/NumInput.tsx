import { useEffect, useState } from 'react';

interface NumInputProps {
	value: number;
	onChange: (v: number) => void;
	min?: number;
	max?: number;
	integer?: boolean;
	style?: React.CSSProperties;
	disabled?: boolean;
	autoFocus?: boolean;
	onEscape?: () => void;
}

/**
 * Number input that commits (calls onChange) only on blur or Enter.
 * Uses type='text' to avoid browser spinner arrows.
 */
export function NumInput({ value, onChange, min, max, integer, style, disabled, autoFocus, onEscape }: NumInputProps) {
	const [local, setLocal] = useState(String(value));

	useEffect(() => {
		setLocal(String(value));
	}, [value]);

	const commit = () => {
		const n = integer ? parseInt(local, 10) : parseFloat(local);
		if (!isNaN(n)) {
			let v = n;
			if (min !== undefined) v = Math.max(min, v);
			if (max !== undefined) v = Math.min(max, v);
			onChange(v);
			setLocal(String(v));
		} else {
			setLocal(String(value));
		}
	};

	return (
		<input
			type='text'
			inputMode={integer ? 'numeric' : 'decimal'}
			value={local}
			onChange={(e) => setLocal(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === 'Enter') commit();
				if (e.key === 'Escape') {
					setLocal(String(value));
					onEscape?.();
				}
			}}
			style={style}
			disabled={disabled}
			autoFocus={autoFocus}
		/>
	);
}
