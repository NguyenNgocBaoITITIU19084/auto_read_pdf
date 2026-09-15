import React, { useState } from 'react';
import { Modal } from './Modal';
import { useApp } from '../../context/AppContext';

export interface NewCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewCollectionModal: React.FC<NewCollectionModalProps> = ({ isOpen, onClose }) => {
  const { t, handleCreateCollection } = useApp();
  const [newColName, setNewColName] = useState('');

  const submitCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColName.trim()) return;
    await handleCreateCollection(newColName.trim());
    setNewColName('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t.common.newCollection}
      maxWidth="max-w-md"
    >
      <form onSubmit={submitCreateCollection} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
            {t.common.collection}
          </label>
          <input
            type="text"
            required
            autoFocus
            value={newColName}
            onChange={(e) => setNewColName(e.target.value)}
            placeholder={t.common.enterCollectionName}
            className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >
            {t.common.cancel}
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-xl shadow-md shadow-primary-500/20 transition-colors"
          >
            {t.common.save}
          </button>
        </div>
      </form>
    </Modal>
  );
};
export default NewCollectionModal;
