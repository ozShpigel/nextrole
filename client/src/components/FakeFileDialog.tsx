import { useEffect, useState } from 'react';
import {
  ChevronLeft, ChevronRight, ChevronUp, Search, Monitor, Star,
  Download, FileText as FileTextIcon, Image, FolderOpen, X,
} from 'lucide-react';

// Impersonates a native OS "Open file" dialog for the demo's canned upload
// flow (see LandingPage.tsx) — deliberately does NOT use the app's own
// editorial dark theme/tokens. The whole point is to read as a real OS
// window, not as part of NextRole's own UI, so it borrows literal OS-chrome
// colors (Windows 11 Explorer-style light theme) instead.
const SIDEBAR_ITEMS = [
  { label: 'Desktop', icon: Monitor },
  { label: 'Downloads', icon: Download },
  { label: 'Documents', icon: FolderOpen, active: true },
  { label: 'Pictures', icon: Image },
];

const FILE_NAME = 'Alex_Morgan_Resume.pdf';

interface FakeFileDialogProps {
  onSelect: () => void;
  onCancel: () => void;
}

export function FakeFileDialog({ onSelect, onCancel }: FakeFileDialogProps) {
  const [selected, setSelected] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="w-[640px] max-w-[92vw] rounded-lg overflow-hidden shadow-2xl border border-black/10"
        style={{ backgroundColor: '#f3f3f3', fontFamily: 'Segoe UI, Arial, sans-serif' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Open"
      >
        {/* Title bar */}
        <div
          className="flex items-center justify-between h-9 px-3 select-none"
          style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #e2e2e2' }}
        >
          <span className="text-[13px]" style={{ color: '#1b1b1b' }}>Open</span>
          <button
            type="button"
            onClick={onCancel}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/5"
            aria-label="Close"
          >
            <X size={14} color="#444" />
          </button>
        </div>

        {/* Toolbar / address bar */}
        <div className="flex items-center gap-2 h-11 px-3" style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #e2e2e2' }}>
          <ChevronLeft size={16} color="#8a8a8a" />
          <ChevronRight size={16} color="#c7c7c7" />
          <ChevronUp size={16} color="#8a8a8a" />
          <div
            className="flex-1 h-7 rounded flex items-center px-3 text-[12.5px]"
            style={{ backgroundColor: '#fff', border: '1px solid #d9d9d9', color: '#3a3a3a' }}
          >
            This PC &nbsp;›&nbsp; Documents
          </div>
          <div
            className="w-40 h-7 rounded flex items-center gap-1.5 px-2 text-[12px]"
            style={{ backgroundColor: '#fff', border: '1px solid #d9d9d9', color: '#9a9a9a' }}
          >
            <Search size={12} />
            Search Documents
          </div>
        </div>

        {/* Body: sidebar + file list */}
        <div className="flex h-[300px]">
          <div className="w-[150px] py-2 px-1.5 flex flex-col gap-0.5" style={{ backgroundColor: '#f3f3f3', borderRight: '1px solid #e2e2e2' }}>
            <div className="px-2.5 py-1 text-[11px] font-semibold flex items-center gap-1.5" style={{ color: '#6a6a6a' }}>
              <Star size={11} />
              Quick access
            </div>
            {SIDEBAR_ITEMS.map(({ label, icon: Icon, active }) => (
              <div
                key={label}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded text-[12.5px]"
                style={active
                  ? { backgroundColor: '#e5f0fb', color: '#1b1b1b' }
                  : { color: '#3a3a3a' }}
              >
                <Icon size={14} color={active ? '#2b7fd6' : '#7a7a7a'} />
                {label}
              </div>
            ))}
          </div>

          <div className="flex-1 bg-white overflow-y-auto">
            <div
              className="grid grid-cols-[1fr_90px_150px] px-3 py-1.5 text-[11.5px] font-semibold sticky top-0"
              style={{ backgroundColor: '#f7f7f7', color: '#6a6a6a', borderBottom: '1px solid #ececec' }}
            >
              <span>Name</span>
              <span>Size</span>
              <span>Date modified</span>
            </div>
            <div
              className="grid grid-cols-[1fr_90px_150px] items-center px-3 py-2 text-[12.5px] cursor-pointer"
              style={selected ? { backgroundColor: '#cce4f7' } : undefined}
              onClick={() => setSelected(true)}
              onDoubleClick={onSelect}
            >
              <span className="flex items-center gap-2 min-w-0">
                <FileTextIcon size={18} color="#d33b2c" className="shrink-0" />
                <span className="truncate" style={{ color: '#1b1b1b' }}>{FILE_NAME}</span>
              </span>
              <span style={{ color: '#5a5a5a' }}>142 KB</span>
              <span style={{ color: '#5a5a5a' }}>Today, 9:41 AM</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-3 py-2.5" style={{ backgroundColor: '#fafafa', borderTop: '1px solid #e2e2e2' }}>
          <div
            className="flex-1 h-7 rounded flex items-center px-2.5 text-[12.5px]"
            style={{ backgroundColor: '#fff', border: '1px solid #d9d9d9', color: '#1b1b1b' }}
          >
            {selected ? FILE_NAME : ''}
          </div>
          <span className="text-[12px] shrink-0" style={{ color: '#6a6a6a' }}>PDF Files (*.pdf)</span>
          <button
            type="button"
            onClick={onSelect}
            disabled={!selected}
            className="h-7 px-4 rounded text-[12.5px] text-white disabled:opacity-40"
            style={{ backgroundColor: '#2b7fd6' }}
          >
            Open
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="h-7 px-4 rounded text-[12.5px]"
            style={{ backgroundColor: '#fff', border: '1px solid #d9d9d9', color: '#1b1b1b' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
