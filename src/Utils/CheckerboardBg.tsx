import React from 'react';

/** Цвета шахматного фона — единый источник правды для CSS и canvas */
export const CHECKER_COLOR_LIGHT = '#ffffff';
export const CHECKER_COLOR_DARK = '#d3d3d3';
const SIZE = 22;

/** CSS-объект шахматного фона для имитации прозрачности (альфа-канал).
 *  Можно применить через spread к style любого элемента. */
export const checkerboardStyle: React.CSSProperties = {
	background: `repeating-conic-gradient(${CHECKER_COLOR_LIGHT} 0% 25%, ${CHECKER_COLOR_DARK} 0% 50%) 50% / ${SIZE}px ${SIZE}px`,
};

interface CheckerboardBgProps extends React.HTMLAttributes<HTMLDivElement> {
	children?: React.ReactNode;
}

/** Div-обёртка с шахматным фоном (имитация прозрачности/альфа-канала). */
export function CheckerboardBg({ children, style, ...rest }: CheckerboardBgProps) {
	return (
		<div style={{ ...checkerboardStyle, ...style }} {...rest}>
			{children}
		</div>
	);
}
