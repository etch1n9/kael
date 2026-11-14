import React, { useEffect, useRef } from 'react';
import '../styles/dialog.css';

interface ModalDialogProps {
  children: React.ReactNode;
  onClose: () => void;
  label?: string;
  labelledBy?: string;
  closeDisabled?: boolean;
}

export function ModalDialog({ children, onClose, label, labelledBy, closeDisabled = false }: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropPressed = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fitViewport = () => {
      const viewport = window.visualViewport;
      dialog.style.left = `${viewport?.offsetLeft || 0}px`;
      dialog.style.top = `${viewport?.offsetTop || 0}px`;
      dialog.style.right = 'auto';
      dialog.style.bottom = 'auto';
      dialog.style.inlineSize = `${viewport?.width || window.innerWidth}px`;
      dialog.style.blockSize = `${viewport?.height || window.innerHeight}px`;
      dialog.style.maxBlockSize = `${viewport?.height || window.innerHeight}px`;
    };
    fitViewport();
    dialog.showModal();
    window.addEventListener('resize', fitViewport);
    window.visualViewport?.addEventListener('resize', fitViewport);
    window.visualViewport?.addEventListener('scroll', fitViewport);
    return () => {
      window.removeEventListener('resize', fitViewport);
      window.visualViewport?.removeEventListener('resize', fitViewport);
      window.visualViewport?.removeEventListener('scroll', fitViewport);
      if (dialog.open) dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      onCancel={(event) => { event.preventDefault(); if (!closeDisabled) onClose(); }}
      className="kael-modal-dialog"
    >
      <div
        className="kael-modal-dialog-viewport"
        onPointerDown={(event) => { backdropPressed.current = event.target === event.currentTarget; }}
        onClick={(event) => {
          const dismiss = backdropPressed.current && event.target === event.currentTarget;
          backdropPressed.current = false;
          if (dismiss && !closeDisabled) onClose();
        }}
      >
        {children}
      </div>
    </dialog>
  );
}
