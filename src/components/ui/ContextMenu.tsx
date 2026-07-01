import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

export interface ContextMenuItem {
  label: string;
  icon?: LucideIcon;
  danger?: boolean;
  onClick?: () => void;
  children?: ContextMenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [reverseX, setReverseX] = useState(false);

  function getPointerDistanceFromRect(x: number, y: number, rect: DOMRect) {
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    return Math.hypot(dx, dy);
  }

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x;
    let top = y;
    let shouldReverseX = false;

    // Check if main menu needs to flip horizontally
    if (left + rect.width > vw - 8) {
      left = x - rect.width;
      // If flipping to the left also goes off-screen, keep it inside the right edge
      if (left < 8) {
        left = vw - rect.width - 8;
      }
    }

    // Check if submenu will go off-screen (it's roughly same width as main menu)
    // If the main menu is already in the right half of the screen, we might want to reverse submenu
    if (left + (rect.width * 2) > vw - 16) {
      shouldReverseX = true;
    }

    if (top + rect.height > vh - 8) top = vh - rect.height - 8;
    if (left < 8) left = 8;
    if (top < 8) top = 8;

    setPosition({ left, top });
    setReverseX(shouldReverseX);
  }, [x, y]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handlePointerMove = (event: MouseEvent) => {
      const menu = menuRef.current;
      if (!menu) return;

      const menuElements = [
        menu,
        ...Array.from(menu.querySelectorAll<HTMLElement>(".context-menu__submenu")),
      ];
      const distance = Math.min(
        ...menuElements.map((element) =>
          getPointerDistanceFromRect(
            event.clientX,
            event.clientY,
            element.getBoundingClientRect()
          )
        )
      );

      if (distance > 180) onClose();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("mousemove", handlePointerMove);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("mousemove", handlePointerMove);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu ${reverseX ? "context-menu--reverse-x" : ""}`}
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ul className="context-menu__list">
        {items.map((item, index) => (
          <li
            key={index}
            className={item.children?.length ? "context-menu__item-shell" : undefined}
          >
            <button
              type="button"
              className={`context-menu__item ${item.danger ? "context-menu__item--danger" : ""} ${item.children?.length ? "context-menu__item--submenu" : ""}`}
              onClick={() => {
                if (item.children?.length) return;
                if (!item.onClick) return;
                item.onClick();
                onClose();
              }}
            >
              {item.icon && <item.icon size={18} strokeWidth={2.0} />}
              <span className="context-menu__label">{item.label}</span>
            </button>
            {item.children?.length ? (
              <ul className="context-menu__submenu">
                {item.children.map((child, childIndex) => (
                  <li key={childIndex}>
                    <button
                      type="button"
                      className={`context-menu__item ${child.danger ? "context-menu__item--danger" : ""}`}
                      onClick={() => {
                        if (!child.onClick) return;
                        child.onClick();
                        onClose();
                      }}
                    >
                      {child.icon && <child.icon size={18} strokeWidth={2.0} />}
                      <span className="context-menu__label">{child.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>,
    document.body
  );
}
