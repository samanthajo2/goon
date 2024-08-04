import React, {useState} from 'react';
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

  const position = settings.position;

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
        className="react-contextmenu"
        style={{
          position: 'absolute',
          left: px(position.x),
          top: px(position.y),
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
