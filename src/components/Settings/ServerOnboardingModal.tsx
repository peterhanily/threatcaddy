import { FolderOpen, MessageSquare, RefreshCw, Users } from 'lucide-react';
import { Modal } from '../Common/Modal';

interface ServerOnboardingModalProps {
  open: boolean;
  onClose: () => void;
  serverName: string;
}

const features = [
  {
    icon: FolderOpen,
    title: 'Shared Investigations',
    description: 'Collaborate on cases with your team — share notes, tasks, timelines, and IOCs in real time.',
  },
  {
    icon: MessageSquare,
    title: 'CaddyShack',
    description: 'Team discussion feed for your SOC. Post updates, share findings, and react to your teammates\u2019 posts.',
  },
  {
    icon: RefreshCw,
    title: 'Real-time Sync',
    description: 'Your notes, tasks, and IOCs sync automatically across all connected team members.',
  },
  {
    icon: Users,
    title: 'Presence',
    description: 'See who\u2019s online and what investigations they\u2019re working on.',
  },
];

export function ServerOnboardingModal({ open, onClose, serverName }: ServerOnboardingModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={`Welcome to ${serverName}!`}>
      <div className="space-y-5">
        <p className="text-sm text-gray-400">
          You&apos;re connected to your team server. Here&apos;s what you can do:
        </p>

        <div className="space-y-3">
          {features.map((feat) => (
            <div key={feat.title} className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0 mt-0.5">
                <feat.icon size={16} className="text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-200">{feat.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{feat.description}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="w-full mt-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Get Started
        </button>
      </div>
    </Modal>
  );
}
