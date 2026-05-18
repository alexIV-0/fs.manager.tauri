// components/DroppableColumn.tsx
import { useDroppable } from '@dnd-kit/core';
import { Box } from '@mui/material';

interface DroppableColumnProps {
    id: string;
    path: string;
    source: 'gd' | 'local';
    children: React.ReactNode;
}

export function DroppableColumn({ id, path, source, children }: DroppableColumnProps) {
    const { isOver, setNodeRef } = useDroppable({
        id,
        data: {
            targetPath: path,
            targetSource: source,
        },
    });

    return (
        <Box
            ref={setNodeRef}
            sx={{
                // Контейнер должен иметь измеримые габариты,
                // иначе dnd-kit не сможет вычислить пересечение
                // и over.data в onDragEnd будет null.
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                position: 'relative',
            }}
        >
            {children}
            {/* Overlay для визуального выделения */}
            {isOver && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        border: '2px solid #1976d2',
                        backgroundColor: 'rgba(0, 102, 255, 0.03)',
                        borderRadius: 1,
                        pointerEvents: 'none', // Чтобы не мешал взаимодействию
                        zIndex: 10, // Выше основного контента
                        boxSizing: 'border-box',
                    }}
                />
            )}
        </Box>
    );
}
