// components/ContextMenu/FileFolderContextMenu.tsx
import { Menu, MenuItem, Divider } from "@mui/material";
import { LucideIcon } from "lucide-react";
import { useEffect } from "react";
import { useGlobalMenu } from "./GlobalMenuContext";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  dividerBefore?: boolean;
  color?: string;
  disabled?: boolean;
}

interface FileFolderContextMenuProps {
  open: boolean;
  position: { mouseX: number; mouseY: number } | null;
  onClose: () => void;
  items: ContextMenuItem[];
  type: "file" | "folder" | "empty";
  menuId: string;
}

export function FileFolderContextMenu({
  open,
  position,
  onClose,
  items,
  type,
  menuId,
}: FileFolderContextMenuProps) {
  const { activeMenuId, closeMenu } = useGlobalMenu();

  // Закрываем меню при клике вне его области
  useEffect(() => {
    const handleClickOutside = () => {
      if (open) {
        closeMenu();
        onClose();
      }
    };

    document.addEventListener("click", handleClickOutside);
    document.addEventListener("contextmenu", handleClickOutside);

    return () => {
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("contextmenu", handleClickOutside);
    };
  }, [open, closeMenu, onClose]);

  return (
    <Menu
      open={open}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={
        position !== null ? { top: position.mouseY, left: position.mouseX } : undefined
      }
      sx={{
        "& .MuiPaper-root": {
          backgroundColor: "#2d3748",
          color: "white",
          minWidth: 200,
        },
      }}
    >
      {items.map((item, index) => {
        const IconComponent = item.icon;
        return (
          <div key={item.id}>
            {item.dividerBefore && <Divider />}
            <MenuItem
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                item.onClick();
                onClose();
              }}
              sx={{
                color: item.color || "inherit",
                fontSize: "0.875rem",
                "&:hover": {
                  backgroundColor: "rgba(255, 255, 255, 0.1)",
                },
                "&.Mui-disabled": {
                  opacity: 0.4,
                  pointerEvents: "none",
                },
              }}
            >
              <IconComponent size={16} style={{ marginRight: 8 }} />
              {item.label}
            </MenuItem>
          </div>
        );
      })}
    </Menu>
  );
}
