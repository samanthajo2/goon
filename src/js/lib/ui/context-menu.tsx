import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { px } from '../utils.js';

type MenuSettings = {
  position: { x: number; y: number };
  rotateMode: number;
  id: string;
};

const settings: MenuSettings = {
  position: { x: 0, y: 0 },
  rotateMode: 0,
  id: '',
};

export function showMenu(newSettings: Partial<MenuSettings>): void {
  Object.assign(settings, newSettings);
}

export function hideMenu(): void {
  settings.id = '';
}

interface ContextMenuProps {
  id: string;
  children: React.ReactNode;
  rotateMode?: number;  // passed by callers for context; not used by this component directly
}

// Note: only re-renders when `id` changes (parent passes a new id to trigger open/close).
export function ContextMenu({ id, children }: ContextMenuProps): React.ReactElement | null {
  // eslint-disable-next-line @eslint-react/use-state -- forceUpdate toggle, not real state
  const [, forceUpdate] = useState(false);
  const [adjustedPos, setAdjustedPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const position = settings.position;
  const visible = id === settings.id;

  useLayoutEffect(() => {
    if (!visible || !menuRef.current) return;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setAdjustedPos(null);
    const { width, height } = menuRef.current.getBoundingClientRect();
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setAdjustedPos({
      x: Math.min(position.x, window.innerWidth - width),
      y: Math.min(position.y, window.innerHeight - height),
    });
  }, [visible, position.x, position.y]);

  useEffect(() => {
    if (!visible) return;
    const onMouseDown = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) {
        hideMenu();
        forceUpdate(s => !s);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [visible]);

  const pos = adjustedPos ?? position;

  return visible ? (
    <div
      ref={menuRef}
      className="react-contextmenu"
      style={{
        position: 'fixed',
        left: px(pos.x),
        top: px(pos.y),
        zIndex: 999,
        visibility: adjustedPos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>
  ) : null;
}

interface MenuItemProps {
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

export function MenuItem({ children, onClick }: MenuItemProps): React.ReactElement {
  return (
    <div className="react-contextmenu-item" onClick={onClick}>
      {children}
    </div>
  );
}
