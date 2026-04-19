import React, { useState, useRef, useLayoutEffect, useEffect, useSyncExternalStore } from 'react';
import { px } from '../utils.js';

type MenuSettings = {
  position: { x: number; y: number };
  rotateMode: number;
  id: string;
};

// External store so showMenu/hideMenu (called from event handlers outside React)
// trigger re-renders in ContextMenu components.
let currentSettings: MenuSettings = {
  position: { x: 0, y: 0 },
  rotateMode: 0,
  id: '',
};
const listeners = new Set<() => void>();
function notify() {
  for (const fn of listeners) fn();
}

export function showMenu(newSettings: Partial<MenuSettings>): void {
  currentSettings = { ...currentSettings, ...newSettings };
  notify();
}

export function hideMenu(): void {
  if (currentSettings.id !== '') {
    currentSettings = { ...currentSettings, id: '' };
    notify();
  }
}

function useMenuSettings(): MenuSettings {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => currentSettings,
  );
}

interface ContextMenuProps {
  id: string;
  children: React.ReactNode;
  rotateMode?: number;
}

export function ContextMenu({ id, children }: ContextMenuProps): React.ReactElement | null {
  const settings = useMenuSettings();
  const [adjustedPos, setAdjustedPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const visible = id === settings.id;
  const position = settings.position;

  useLayoutEffect(() => {
    if (!visible || !menuRef.current) return;
    setAdjustedPos(null); // eslint-disable-line @eslint-react/set-state-in-effect
    const { width, height } = menuRef.current.getBoundingClientRect();
    setAdjustedPos({ // eslint-disable-line @eslint-react/set-state-in-effect
      x: Math.min(position.x, window.innerWidth - width),
      y: Math.min(position.y, window.innerHeight - height),
    });
  }, [visible, position.x, position.y]);

  useEffect(() => {
    if (!visible) return;
    const onMouseDown = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) {
        hideMenu();
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
  const handleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    hideMenu();
    onClick?.(e);
  };
  return (
    <div className="react-contextmenu-item" onClick={handleClick}>
      {children}
    </div>
  );
}
