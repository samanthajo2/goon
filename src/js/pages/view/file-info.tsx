import React from 'react';
import Modal from '../../lib/ui/modal';

function JSONArray({ value }: { value: any[] }) {
  return (
    <table className="data-table">
      <tbody>
      {
        value.map((value, index) => (
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

function JSONObject({ value }: { value: { [key: string]: any } }) {
  return (
    <table className="data-table">
      <tbody>
      {
        Object.entries(value).map(([key, value], index) => (
          <tr key={`jo-${index}`}>
            <td>{key}</td>
            <td><JSONValue value={value} /></td>
          </tr>
        ))
      }
      </tbody>
    </table>
  );
}

function CopyOnClick({ value }: { value: any }) {
  return (<div onClick={() => navigator.clipboard.writeText(value)}>{value}</div>)
}

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
  fileInfo: { filename: string, metaData: any },
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