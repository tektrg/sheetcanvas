
import React from 'react';
import { CommandBar } from './CommandBar';
import { useCommandService } from '../hooks/useCommandService';
import { SelectionContext, ChartType } from '../types';

interface GlobalCommandBarProps {
  isOpen: boolean;
  onClose: () => void;
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
  activeSelection: SelectionContext;
  onAddTable: () => void;
  onAddNote: () => void;
  onImport: () => void;
  onConnectData: () => void;
  onCopyImage: () => void;
  onInitChart: (sheetId: string, colIndex?: number, selectedCols?: number[], initialType?: ChartType) => void;
  onInitPivot: (sheetId: string, colIndex?: number) => void;
  onInitSparkline: (sheetId: string) => void;
}

export const GlobalCommandBar: React.FC<GlobalCommandBarProps> = (props) => {
  const commands = useCommandService({
    darkMode: props.darkMode,
    setDarkMode: props.setDarkMode,
    activeSelection: props.activeSelection,
    onAddTable: props.onAddTable,
    onAddNote: props.onAddNote,
    onImport: props.onImport,
    onConnectData: props.onConnectData,
    onCopyImage: props.onCopyImage,
    onInitChart: props.onInitChart,
    onInitPivot: props.onInitPivot,
    onInitSparkline: props.onInitSparkline
  });

  return (
    <CommandBar 
      isOpen={props.isOpen} 
      onClose={props.onClose} 
      commands={commands} 
    />
  );
};
