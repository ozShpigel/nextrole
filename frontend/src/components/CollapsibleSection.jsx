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
    <div className="bg-card border border-border rounded-lg p-6 mb-4 shadow-sm transition-all hover:border-border hover:shadow-md">
      <div
        className="cursor-pointer flex justify-between items-center select-none"
        onClick={toggle}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={open}
      >
        <h3 className="text-[0.95rem] font-semibold text-foreground">{title}</h3>
        <span className={`text-[0.6rem] text-muted-foreground transition-transform duration-250 ${open ? '' : 'rotate-90'}`}>&#9660;</span>
      </div>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
