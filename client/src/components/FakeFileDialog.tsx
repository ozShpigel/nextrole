import { useEffect, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Search, Wifi, Clock, Laptop, Folder, Download,
} from 'lucide-react';

// Impersonates a native macOS "Open" dialog for the demo's canned upload
// flow (see LandingPage.tsx) — deliberately does NOT use the app's own
// editorial dark theme/tokens. The whole point is to read as a real OS
// window, not as part of NextRole's own UI, so it borrows literal OS-chrome
// colors/typography (macOS Finder-style light vibrancy) instead.
const FAVORITES = [
  { label: 'AirDrop', icon: Wifi },
  { label: 'Recents', icon: Clock },
  { label: 'Desktop', icon: Laptop },
  { label: 'Documents', icon: Folder, active: true },
  { label: 'Downloads', icon: Download },
];

const FILE_NAME = 'Alex_Morgan_Resume.pdf';

function PdfTileIcon() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
      <path d="M14 4h32l12 12v52a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#fff" stroke="#e2453c" strokeWidth="1.5" />
      <path d="M46 4v10a2 2 0 0 0 2 2h10" fill="none" stroke="#e2453c" strokeWidth="1.5" />
      <rect x="10" y="38" width="34" height="18" rx="3" fill="#e2453c" />
      <text x="27" y="51" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="Arial, sans-serif">PDF</text>
    </svg>
  );
}

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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="w-[600px] max-w-[92vw] rounded-2xl overflow-hidden border border-black/10"
        style={{
          backgroundColor: 'rgba(246,246,246,0.94)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Helvetica, Arial, sans-serif',
          boxShadow: '0 30px 60px -12px rgba(0,0,0,0.35), 0 18px 36px -18px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Open"
      >
        {/* Title bar */}
        <div className="relative flex items-center justify-center h-11 px-4 select-none" style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
          <div className="absolute left-4 flex items-center gap-2">
            <button type="button" onClick={onCancel} aria-label="Close" className="w-3 h-3 rounded-full" style={{ backgroundColor: '#ff5f57' }} />
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#febc2e' }} />
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#28c840' }} />
          </div>
          <span className="text-[13px] font-medium" style={{ color: '#3a3a3a' }}>Open</span>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 h-12 px-4" style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
          <div className="flex items-center rounded-md overflow-hidden" style={{ border: '1px solid rgba(0,0,0,0.12)' }}>
            <button type="button" className="w-6 h-6 flex items-center justify-center" style={{ borderRight: '1px solid rgba(0,0,0,0.12)' }}>
              <ChevronLeft size={13} color="#3a3a3a" />
            </button>
            <button type="button" className="w-6 h-6 flex items-center justify-center">
              <ChevronRight size={13} color="#b5b5b5" />
            </button>
          </div>
          <span className="text-[13px] font-medium" style={{ color: '#2a2a2a' }}>Documents</span>
          <div className="flex-1" />
          <div
            className="w-[170px] h-7 rounded-md flex items-center gap-1.5 px-2.5 text-[12.5px]"
            style={{ backgroundColor: 'rgba(0,0,0,0.05)', color: '#9a9a9a' }}
          >
            <Search size={12} />
            Search
          </div>
        </div>

        {/* Body: sidebar + icon-grid file view */}
        <div className="flex h-[280px]">
          <div className="w-[160px] py-3 px-2 flex flex-col gap-0.5 overflow-y-auto" style={{ borderRight: '1px solid rgba(0,0,0,0.08)' }}>
            <div className="px-2.5 pb-1 text-[11px] font-semibold" style={{ color: '#8a8a8a' }}>Favorites</div>
            {FAVORITES.map(({ label, icon: Icon, active }) => (
              <div
                key={label}
                className="flex items-center gap-2 px-2.5 py-[5px] rounded-md text-[12.5px]"
                style={active ? { backgroundColor: '#0a7cff', color: '#fff' } : { color: '#2a2a2a' }}
              >
                <Icon size={14} color={active ? '#fff' : '#5a9fff'} />
                {label}
              </div>
            ))}
          </div>

          <div
            className="flex-1 flex items-start p-6 cursor-pointer"
            onClick={() => setSelected(true)}
            onDoubleClick={onSelect}
          >
            <div className="flex flex-col items-center gap-2 w-[104px]">
              <div
                className="w-[88px] h-[88px] rounded-xl flex items-center justify-center"
                style={selected ? { backgroundColor: 'rgba(10,124,255,0.12)' } : undefined}
              >
                <PdfTileIcon />
              </div>
              <span
                className="text-[12px] text-center leading-snug px-1.5 py-[1px] rounded break-words"
                style={selected ? { backgroundColor: '#0a7cff', color: '#fff' } : { color: '#2a2a2a' }}
              >
                {FILE_NAME}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-4 py-3.5" style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
          <button
            type="button"
            onClick={onCancel}
            className="h-7 px-4 rounded-full text-[13px] font-medium"
            style={{ backgroundColor: 'rgba(0,0,0,0.06)', color: '#2a2a2a' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSelect}
            disabled={!selected}
            className="h-7 px-4 rounded-full text-[13px] font-medium text-white disabled:opacity-40"
            style={{ backgroundColor: '#0a7cff' }}
          >
            Open
          </button>
        </div>
      </div>
    </div>
  );
}
