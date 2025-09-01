import React from 'react';
import Modal from '../../lib/ui/modal';

export default function FileInfo({
  parent, fileInfo, onClose, close = 'close'
}: {
  parent: HTMLElement,
  fileInfo: any,
  onClose: () => void,
  close: string,
}) {
  return (
    <Modal parent={parent}>
      <div className="dialog">
        <pre className="msg">
                    {JSON.stringify(fileInfo, null, 2)}
        </pre>
        <div className="options">
          <button type="button" onClick={onClose}>{close}goobar</button>
        </div>
      </div>
    </Modal>
  );
}