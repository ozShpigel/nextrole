import Modal from './Modal';
import SnapshotsCard from './SnapshotsCard';

export default function SnapshotsModal({ title, snapshots, onClose }) {
  return (
    <Modal isOpen={true} onClose={onClose}>
      <div className="snapshots-modal__panel">
        <div className="snapshots-modal__head">
          <h3 className="section-title" style={{ border: 'none', margin: 0, padding: 0 }}>
            קריאות Claude גולמיות
          </h3>
          {title && <div className="snapshots-modal__subtitle">{title}</div>}
          <button
            type="button"
            className="btn btn-secondary btn-sm snapshots-modal__close"
            onClick={onClose}
            aria-label="סגור"
          >
            ✕
          </button>
        </div>
        <div className="snapshots-modal__body">
          <SnapshotsCard snapshots={snapshots} />
        </div>
      </div>
    </Modal>
  );
}
