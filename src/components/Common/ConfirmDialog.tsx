import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  secondaryAction?: () => void;
  secondaryLabel?: string;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger, secondaryAction, secondaryLabel }: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-gray-300 mb-6">{message}</p>
      <div className="flex justify-end gap-3">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
        >
          Cancel
        </button>
        {secondaryAction && secondaryLabel && (
          <button
            onClick={() => { secondaryAction(); onClose(); }}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white transition-colors"
          >
            {secondaryLabel}
          </button>
        )}
        <button
          onClick={() => { onConfirm(); onClose(); }}
          className={`px-4 py-2 rounded-lg text-white transition-colors ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-accent hover:bg-accent-hover'}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
