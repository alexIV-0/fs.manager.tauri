// hooks/useContextMenu.ts
import { useState, MouseEvent, useCallback } from 'react';
import { useGlobalMenu } from '../FileExplorerColumn/ContextMenu/GlobalMenuContext';

interface UseContextMenuReturn {
	menuPosition: { mouseX: number; mouseY: number } | null;
	handleContextMenu: (e: MouseEvent, onSelect?: () => void) => void;
	handleMenuClose: () => void;
	isMenuOpen: boolean;
}

export function useContextMenu(menuId: string): UseContextMenuReturn {
	const [menuPosition, setMenuPosition] = useState<{ mouseX: number; mouseY: number } | null>(null);
	const { activeMenuId, openMenu, closeMenu } = useGlobalMenu();

	const handleContextMenu = useCallback(
		(e: MouseEvent, onSelect?: () => void) => {
			e.preventDefault();
			e.stopPropagation(); // Останавливаем всплытие

			// Вызываем onSelect если передан (для выделения элемента)
			if (onSelect) {
				onSelect();
			}

			// Открываем глобальное меню
			openMenu(menuId);

			setMenuPosition({
				mouseX: e.clientX + 2,
				mouseY: e.clientY - 6,
			});
		},
		[menuId, openMenu],
	);

	const handleMenuClose = useCallback(() => {
		closeMenu();
		setMenuPosition(null);
	}, [closeMenu]);

	// Меню открыто только если это активное меню в глобальном контексте
	const isMenuOpen = activeMenuId === menuId && menuPosition !== null;

	return {
		menuPosition,
		handleContextMenu,
		handleMenuClose,
		isMenuOpen,
	};
}
