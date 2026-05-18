import { ResizeDirection } from './types';

interface ResizeHandleProps {
	direction: ResizeDirection;
	onMouseDown: (e: React.MouseEvent, dir: ResizeDirection) => void;
}

export function ResizeHandle({ direction, onMouseDown }: ResizeHandleProps) {
	const isCorner = direction.length === 2;
	const size = isCorner ? 12 : 6;
	const s: React.CSSProperties = { position: 'absolute', zIndex: 10 };

	if (direction === 'n') {
		s.top = 0;
		s.left = size;
		s.right = size;
		s.height = size;
		s.cursor = 'n-resize';
	}
	if (direction === 's') {
		s.bottom = 0;
		s.left = size;
		s.right = size;
		s.height = size;
		s.cursor = 's-resize';
	}
	if (direction === 'e') {
		s.right = 0;
		s.top = size;
		s.bottom = size;
		s.width = size;
		s.cursor = 'e-resize';
	}
	if (direction === 'w') {
		s.left = 0;
		s.top = size;
		s.bottom = size;
		s.width = size;
		s.cursor = 'w-resize';
	}
	if (direction === 'ne') {
		s.top = 0;
		s.right = 0;
		s.width = size;
		s.height = size;
		s.cursor = 'ne-resize';
	}
	if (direction === 'nw') {
		s.top = 0;
		s.left = 0;
		s.width = size;
		s.height = size;
		s.cursor = 'nw-resize';
	}
	if (direction === 'se') {
		s.bottom = 0;
		s.right = 0;
		s.width = size;
		s.height = size;
		s.cursor = 'se-resize';
	}
	if (direction === 'sw') {
		s.bottom = 0;
		s.left = 0;
		s.width = size;
		s.height = size;
		s.cursor = 'sw-resize';
	}

	return <div style={s} onMouseDown={(e) => onMouseDown(e, direction)} />;
}
