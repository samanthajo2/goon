import React, {useState, useRef, useLayoutEffect} from 'react';
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
  const [show, setShow] = useState(false);
  const [adjustedPos, setAdjustedPos] = useState(null);
  const menuRef = useRef(null);

  const position = settings.position;

  useLayoutEffect(() => {
    if (id !== settings.id || !menuRef.current) return;
    setAdjustedPos(null);
    const {width, height} = menuRef.current.getBoundingClientRect();
    setAdjustedPos({
      x: Math.min(position.x, window.innerWidth - width),
      y: Math.min(position.y, window.innerHeight - height),
    });
  }, [id, settings.id, position.x, position.y]);

  const pos = adjustedPos ?? position;

  return (id === settings.id && (
    <div
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        zIndex: 999,
      }}
      onClick={() => {
        hideMenu();
        setShow(!show);
      }}
    >
      <div
        ref={menuRef}
        className="react-contextmenu"
        style={{
          position: 'absolute',
          left: px(pos.x),
          top: px(pos.y),
          visibility: adjustedPos ? 'visible' : 'hidden',
        }}
      >
        {children}
      </div>
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
