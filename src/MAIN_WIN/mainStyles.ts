import { greyColor } from '@/Store/Color/grayColor';

export const mainBoxStyle = {
	position: 'relative',
	display: 'flex',
	flexDirection: 'column',
	border: `1px solid ${greyColor(80)}`,
	// zIndex: 5,
	// height: '50vh',
	height: '100%', // важно для flex-контейнера
	// m: '2px 0',
	borderRadius: 2,
	// overflow: 'hidden',
};

export const topButtonStyle = {
	p: '0 2px',
	// boxShadow: '0 5px 4px rgb(0, 0, 0)',
};

export const buttonStyle = {
	flex: 1,
	whiteSpace: 'nowrap',
	overflow: 'hidden',
	textOverflow: 'ellipsis',
	textTransform: 'none',
	width: '-webkit-fill-available',
};

export const bottomBoxStyle = {
	// borderRadius: 2,
	// position: 'sticky',
	// bottom: 10,
	// width: '100%',
	// display: 'flex',
	// flexDirection: 'column',
	// zIndex: 1,
};

export const bottomShadowStyle = {
	zIndex: 1,
	boxShadow: `0px -7px 10px 0px rgba(0, 0, 0, 0.5)`,
};
export const topShadowStyle = {
	zIndex: 1,
	boxShadow: `0px 7px 10px 0px rgba(0, 0, 0, 0.5)`,
};

export const automationListStyle = {
	p: '4px',
	width: '100%',
	flex: '1 1 auto',
	overflowY: 'auto', // ← прокрутка только внутри списка
	height: '100%', // ← принудительно занимает всю высоту
	'&::-webkit-scrollbar': { display: 'none' },
};

export const listStyle = {
	flex: 1, // ← занимает всё доступное пространство
	minHeight: 0, // ← разрешает сжатие
	display: 'flex',
	flexDirection: 'column',
	overflow: 'hidden', // ← скрываем всё что выходит
};

export const resizeHandleStyle = {
	position: 'absolute',
	zIndex: 300,
	'&:hover': {
		backgroundColor: 'rgb(35, 115, 253)',
		opacity: 0.8,
	},
	'&:active': {
		backgroundColor: 'rgb(72, 139, 255)',
	},
};

export const resizeHandleStyleLeft = {
	top: 0,
	bottom: 0,
	right: -2,
	width: '4px',
	cursor: 'col-resize',
};

export const resizeHandleStyleBottom = {
	bottom: -2,
	left: 0,
	right: 0,
	width: '100%',
	height: '4px',
	cursor: 'row-resize',
};

export const dividerStyle = {
	mb: '0px',
	color: '#ffffff91',
	borderColor: '#ffffff91',
};

export const contentStyle = {
	display: 'flex',
	gab: '5px',
	justifyContent: 'start-flex',
	// height: '-webkit-fill-available',
	overflow: 'hidden',
	// mb: '90px',
};
