import React, {useState, useRef, useLayoutEffect, useEffect} from 'react';
import { px } from '../utils';

const settings = {
  position: {x: 0, y: 0},
  rotateMode: 0,
};

export function showMenu(_settings) {
  Object.assign(settings, _settings);
}

export function hideMenu() {
  settings.id = '';
}

// Note: this only re-renders because id
export function ContextMenu({id, children}) {
  const [, forceUpdate] = useState(false);
  const [adjustedPos, setAdjustedPos] = useState(null);
  const menuRef = useRef(null);

  const position = settings.position;
  const visible = id === settings.id;

  useLayoutEffect(() => {
    if (!visible || !menuRef.current) return;
    setAdjustedPos(null);
    const {width, height} = menuRef.current.getBoundingClientRect();
    setAdjustedPos({
      x: Math.min(position.x, window.innerWidth - width),
      y: Math.min(position.y, window.innerHeight - height),
    });
  }, [visible, position.x, position.y]);

  useEffect(() => {
    if (!visible) return;
    const onMouseDown = (e) => {
      if (!menuRef.current?.contains(e.target)) {
        hideMenu();
        forceUpdate(s => !s);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [visible]);

  const pos = adjustedPos ?? position;

  return (visible && (
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
  ));
}

export function MenuItem({children, onClick}) {
  return (
    <div className="react-contextmenu-item" onClick={onClick}>
      {children}
    </div>
  );
}
