import { useState } from 'react';

export default function CollapsibleSection({ title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);

  function toggle() { setOpen(!open); }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  }

  return (
    <div className="card">
      <div
        className={`collapsible-header${open ? '' : ' collapsed'}`}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={open}
      >
        <h3 className="section-title" style={{ border: 'none', margin: 0, padding: 0 }}>{title}</h3>
      </div>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}
