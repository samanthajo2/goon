import React from 'react';
import Modal from '../../lib/ui/modal.js';
import { cssArray } from '../../lib/css-utils.js';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function JSONArray({ value }: { value: any[] }) {
  return (
    <table className="data-table">
      <tbody>
      {
        value.map((value, index) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key
          <tr key={`ja-${index}`}>
            <td>{index}</td>
            <td>
              <JSONValue value={value} />
            </td>
          </tr>
        ))
      }
      </tbody>
    </table>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function JSONObject({ value }: { value: { [key: string]: any } }) {
  return (
    <table className="data-table">
      <tbody>
      {
        Object.entries(value).map(([key, value]) => (
          <tr key={key}>
            <td>{key}</td>
            <td><JSONValue value={value} /></td>
          </tr>
        ))
      }
      </tbody>
    </table>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CopyOnClick({ value }: { value: any }) {
  const [flash, setFlash] = React.useState(false);
  return (
    <div className={(cssArray('flashable').addIf(flash, 'flash')).toString()} onClick={() => {
      navigator.clipboard.writeText(value);
      setFlash(false);
      requestAnimationFrame(() => {
        setFlash(true);
      });
    }}>{value}</div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function JSONValue({ value }: { value: any }) {
  if (Array.isArray(value)) {
    return (<JSONArray value={value}/>);
  } else {
    switch (typeof value) {
      case 'number':
      case 'string':
      case 'boolean':
      case 'undefined':
        return (<CopyOnClick value={value}/>);
      case 'object':
        if (value === null) {
          return (<span>${value}</span>);
        }
        return (<JSONObject value={value}/>);
      default:
        return (<span>${value}</span>);
    }
  }
}

export default function FileInfo({
  parent, fileInfo, onClose, close = 'close'
}: {
  parent: HTMLElement,
  fileInfo: { filename: string, metaData: any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  onClose: () => void,
  close: string,
}) {
  return (
    <Modal parent={parent}>
      <div className="dialog">
        <h2>{fileInfo.filename}</h2>
        <div>
          <JSONValue value={fileInfo.metaData}/>
        </div>
        <div className="options">
          <button type="button" onClick={onClose}>{close}</button>
        </div>
      </div>
    </Modal>
  );
}