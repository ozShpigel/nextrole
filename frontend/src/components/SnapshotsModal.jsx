import Modal from './Modal';
import SnapshotsCard from './SnapshotsCard';

export default function SnapshotsModal({ title, snapshots, onClose }) {
  return (
    <Modal isOpen={true} onClose={onClose}>
      <div className="flex flex-col">
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <h3 className="text-[0.95rem] font-semibold text-text-bright">
              Raw Claude Calls
            </h3>
            {title && <div className="text-[0.84rem] text-text-secondary mt-1">{title}</div>}
          </div>
          <button
            type="button"
            className="px-2 py-1 text-[0.82rem] font-medium bg-bg-surface border border-border rounded-sm text-text-secondary hover:border-border-hover hover:text-text-primary transition-all flex-shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto">
          <SnapshotsCard snapshots={snapshots} />
        </div>
      </div>
    </Modal>
  );
}
