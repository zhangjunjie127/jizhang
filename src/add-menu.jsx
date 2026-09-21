import React from 'react';
import './add-menu.css';

export function AddMenu({ Modal, title, options, onClose }) {
  return <Modal title={title} onClose={onClose} className="add-menu">
    <div className="add-menu-options">{options.map(({ label, icon: Icon, onSelect }) =>
      <button type="button" key={label} onClick={onSelect}><Icon size={20} aria-hidden="true" /><span>{label}</span></button>
    )}</div>
  </Modal>;
}
