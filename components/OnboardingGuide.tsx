import React, { useEffect, useRef } from 'react';
import './OnboardingGuide.css';

interface OnboardingGuideProps {
  isOpen: boolean;
  onClose: () => void;
  darkMode: boolean;
}

const DESIGN_FRAME_PATH = '/landing-page-design/SheetCanvas.html?v=20260526-4';

type WiredFrameWindow = Window & {
  __sheetcanvasWelcomeWired?: boolean;
};

export const OnboardingGuide: React.FC<OnboardingGuideProps> = ({ isOpen, onClose, darkMode }) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const designFrameSrc = `${DESIGN_FRAME_PATH}&theme=${darkMode ? 'dark' : 'light'}`;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const applyFrameSettings = () => {
    const frame = frameRef.current;
    const frameDocument = frame?.contentDocument;
    const frameWindow = frame?.contentWindow;
    const frameDocumentElement = frameDocument?.documentElement;
    const sheet = frame?.closest('.bottom-sheet-welcome__sheet');

    if (!frameDocumentElement || !sheet) {
      return;
    }

    const hiddenBottomInset = Math.max(0, -parseFloat(window.getComputedStyle(sheet).marginBottom));

    frameDocumentElement.toggleAttribute('data-theme', darkMode);
    frameDocumentElement.dataset.visibleBottomInset = String(hiddenBottomInset);

    if (frameWindow) {
      frameWindow.dispatchEvent(new frameWindow.Event('scroll'));
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    applyFrameSettings();
    window.addEventListener('resize', applyFrameSettings);
    return () => window.removeEventListener('resize', applyFrameSettings);
  }, [isOpen, darkMode]);

  if (!isOpen) {
    return null;
  }

  const wireDesignControls = () => {
    const frame = frameRef.current;
    const frameWindow = frame?.contentWindow as WiredFrameWindow | null;
    const frameDocument = frame?.contentDocument;

    if (!frameWindow || !frameDocument || frameWindow.__sheetcanvasWelcomeWired) {
      return;
    }

    frameWindow.__sheetcanvasWelcomeWired = true;
    applyFrameSettings();

    frameWindow.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    });

    frameDocument.addEventListener('click', (event) => {
      const clickedElement = event.target instanceof frameWindow.Element ? event.target : null;
      const clickedLink = clickedElement?.closest('a');
      const linkText = clickedLink?.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() ?? '';

      if (linkText.startsWith('launch sheetcanvas') || linkText.startsWith('open sheetcanvas')) {
        event.preventDefault();
        onClose();
      }
    });
  };

  return (
    <div className="bottom-sheet-welcome" data-theme={darkMode ? 'dark' : 'light'} role="presentation">
      <button
        type="button"
        className="bottom-sheet-welcome__scrim"
        aria-label="Close welcome"
        onClick={onClose}
      />
      <section
        className="bottom-sheet-welcome__sheet"
        role="dialog"
        aria-modal="true"
        aria-label="SheetCanvas welcome"
      >
        <iframe
          ref={frameRef}
          className="bottom-sheet-welcome__frame"
          title="SheetCanvas welcome design"
          src={designFrameSrc}
          onLoad={wireDesignControls}
        />
        <button
          type="button"
          className="bottom-sheet-welcome__close"
          onClick={onClose}
        >
          watch later
        </button>
      </section>
    </div>
  );
};
