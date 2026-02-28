import { Modal } from './Modal';

interface DemoWelcomeModalProps {
  open: boolean;
  onClose: () => void;
  onStartTour: () => void;
  onDeleteDemo: () => void;
}

export function DemoWelcomeModal({ open, onClose, onStartTour, onDeleteDemo }: DemoWelcomeModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Welcome to BrowserNotes">
      <div className="space-y-4">
        <p className="text-sm text-gray-300">
          A sample investigation <strong className="text-gray-100">"Operation DARK GLACIER"</strong> has been loaded so you can explore how everything works.
        </p>

        <div className="text-sm text-gray-400 space-y-1.5">
          <p className="font-medium text-gray-300">What you can do:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Browse notes, tasks, and timeline events</li>
            <li>View the investigation graph and IOC analysis</li>
            <li>Try the whiteboard and entity linking</li>
            <li>Use <code className="bg-gray-800 px-1 rounded text-xs">[[wiki-links]]</code> to link between notes</li>
          </ul>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 rounded-lg bg-accent text-white font-medium hover:bg-accent-hover transition-colors"
          >
            Start Exploring
          </button>
          <button
            onClick={() => { onClose(); onStartTour(); }}
            className="w-full px-4 py-2 rounded-lg bg-gray-700 text-gray-200 font-medium hover:bg-gray-600 transition-colors"
          >
            Take the Guided Tour
          </button>
          <button
            onClick={() => { onDeleteDemo(); onClose(); }}
            className="w-full px-4 py-2 rounded-lg text-gray-500 hover:text-red-400 text-sm transition-colors"
          >
            Delete Demo &amp; Start Fresh
          </button>
        </div>

        <p className="text-xs text-gray-600 text-center">
          You can remove the sample data later in Settings.
        </p>
      </div>
    </Modal>
  );
}
