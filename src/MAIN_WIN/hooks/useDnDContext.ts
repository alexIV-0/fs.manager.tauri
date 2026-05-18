// hooks/useDnDContext.ts
import { createContext, useContext } from 'react';

export interface DragData {
    type: 'file' | 'folder';
    source: 'gd' | 'local';
    path: string;
    name: string;
    columnIndex?: number;
}

interface DnDContextType {
    onDrop: (data: DragData, targetPath: string, targetSource: 'gd' | 'local') => void;
}

export const DnDContext = createContext<DnDContextType | undefined>(undefined);

export const useDnDContext = () => {
    const context = useContext(DnDContext);
    if (!context) {
        throw new Error('useDnDContext must be used within a DnDProvider');
    }
    return context;
};
