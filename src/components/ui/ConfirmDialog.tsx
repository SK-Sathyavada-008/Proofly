import React from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { AlertTriangle, Info } from 'lucide-react';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose?: () => void;
  onCancel?: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  message?: string;
  confirmText?: string;
  confirmLabel?: string;
  cancelText?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  isLoading?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onCancel,
  onConfirm,
  title,
  description,
  message,
  confirmText,
  confirmLabel,
  cancelText,
  cancelLabel,
  variant = 'primary',
  isLoading = false,
}) => {
  const handleClose = onClose || onCancel || (() => {});
  const resolvedDesc = description || message || '';
  const resolvedConfirm = confirmText || confirmLabel || 'Confirm';
  const resolvedCancel = cancelText || cancelLabel || 'Cancel';

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      maxWidth="md"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={handleClose} disabled={isLoading}>
            {resolvedCancel}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            size="sm"
            onClick={onConfirm}
            isLoading={isLoading}
          >
            {resolvedConfirm}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-4">
        <div
          className={`p-2.5 rounded-full shrink-0 ${
            variant === 'danger'
              ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400'
              : 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400'
          }`}
        >
          {variant === 'danger' ? <AlertTriangle size={22} /> : <Info size={22} />}
        </div>
        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{resolvedDesc}</p>
        </div>
      </div>
    </Modal>
  );
};

export default ConfirmDialog;
