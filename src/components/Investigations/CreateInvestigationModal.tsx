import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Dices, BookOpen } from 'lucide-react';
import { Modal } from '../Common/Modal';
import { cn } from '../../lib/utils';

export interface CreateInvestigationModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, options?: { playbook?: string; color?: string; icon?: string }) => void;
  onOpenNameGenerator?: () => void;
  onOpenPlaybookPicker?: () => void;
  generatedName?: string;
}

type TabId = 'quick' | 'name-gen' | 'playbook';

const TABS: { id: TabId; labelKey: string }[] = [
  { id: 'quick',    labelKey: 'create.quickCreate' },
  { id: 'name-gen', labelKey: 'create.nameGenerator' },
  { id: 'playbook', labelKey: 'create.fromPlaybook' },
];

export function CreateInvestigationModal({ open, onClose, onCreate, onOpenNameGenerator, onOpenPlaybookPicker, generatedName }: CreateInvestigationModalProps) {
  const { t } = useTranslation('investigations');
  const [activeTab, setActiveTab] = useState<TabId>('quick');
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');

  // When a generated name comes in, pre-fill and switch to Quick Create
  useEffect(() => {
    if (generatedName) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: syncing generated name from parent
      setName(generatedName);
      setActiveTab('quick');
    }
  }, [generatedName]);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t('create.nameRequired'));
      return;
    }
    setNameError('');
    onCreate(trimmed);
    setName('');
    onClose();
  };

  const handleClose = () => {
    setName('');
    setNameError('');
    setActiveTab('quick');
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title={t('create.title')}>
      {/* Tabs */}
      <div className="flex gap-0.5 p-0.5 bg-bg-deep rounded-lg mb-4" role="tablist" aria-label="Investigation creation method">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors',
              activeTab === tab.id
                ? 'bg-bg-active text-text-primary'
                : 'text-text-muted hover:text-text-secondary',
            )}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'quick' && (
        <div>
          <label htmlFor="inv-name" className="block text-xs font-medium text-text-secondary mb-1.5">
            Investigation name
          </label>
          <input
            id="inv-name"
            autoFocus
            value={name}
            onChange={(e) => { setName(e.target.value); if (nameError) setNameError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            placeholder="e.g. Operation Midnight Storm"
            aria-required="true"
            aria-invalid={!!nameError}
            aria-describedby={nameError ? 'inv-name-error' : undefined}
            className={cn(
              'w-full bg-bg-deep border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-purple transition-colors',
              nameError ? 'border-red-500' : 'border-border-medium',
            )}
          />
          {nameError && (
            <p id="inv-name-error" className="text-xs text-red-400 mt-1">{nameError}</p>
          )}
          <button
            onClick={handleCreate}
            disabled={!name.trim()}
            className={cn(
              'mt-4 w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              name.trim()
                ? 'bg-purple text-white hover:brightness-110'
                : 'bg-bg-deep text-text-muted cursor-not-allowed',
            )}
          >
            <Plus size={16} />
            Create Investigation
          </button>
        </div>
      )}

      {activeTab === 'name-gen' && (
        <div className="flex flex-col items-center justify-center py-8 rounded-lg border border-border-subtle bg-bg-deep/30 gap-3">
          <Dices size={32} className="text-text-muted" />
          <p className="text-sm text-text-secondary">Generate a random operation name with the slot machine</p>
          <p className="text-xs text-text-muted">After generating a name, it will be pre-filled in the Quick Create tab</p>
          <button
            onClick={() => { onOpenNameGenerator?.(); }}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:brightness-110 transition-all flex items-center gap-2"
          >
            <Dices size={16} />
            Open Name Generator
          </button>
        </div>
      )}

      {activeTab === 'playbook' && (
        <div className="flex flex-col items-center justify-center py-8 rounded-lg border border-border-subtle bg-bg-deep/30 gap-3">
          <BookOpen size={32} className="text-text-muted" />
          <p className="text-sm text-text-secondary">Start from a playbook template with pre-configured tasks and notes</p>
          <button
            onClick={() => { onOpenPlaybookPicker?.(); }}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:brightness-110 transition-all flex items-center gap-2"
          >
            <BookOpen size={16} />
            Browse Playbooks
          </button>
        </div>
      )}
    </Modal>
  );
}
