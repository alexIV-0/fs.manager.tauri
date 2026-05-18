import { Box, TextField, Typography } from '@mui/material';
import { useState } from 'react';

interface Props {
    innerText: string;
    onChange?: (newText: string) => void; // функция, вызываемая при сохранении
    sx?: any;
}

function MyTypography({ innerText, onChange, sx }: Props) {
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(innerText);

    const handleDoubleClick = () => {
        setIsEditing(true);
    };

    const handleSave = () => {
        onChange?.(value);
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setValue(innerText);
        } else {
            e.stopPropagation(); // 👈 блокируем пробел/стрелки для списка
        }
    };

    return (
        <Box
            sx={{
                display: 'inline-block',
                minWidth: '160px',
                pr: '6px',
                ...sx,
            }}
        >
            {isEditing ? (
                <TextField
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    variant='standard'
                    size='small'
                    onFocus={(e) => e.target.select()}
                    sx={{ fontSize: 'inherit', overflow: 'hidden', pl: '6px' }}
                />
            ) : (
                <Typography
                    variant='body1'
                    onDoubleClick={handleDoubleClick}
                    sx={{
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        height: '100%',
                        width: '100%',
                        pl: '6px',
                        overflow: 'hidden',
                        // borderBottom: `0.5px solid ${gray}`,
                        // '&:hover': { backgroundColor: gray[20] },
                        ...sx,
                    }}
                >
                    {value}
                </Typography>
            )}
        </Box>
    );
}

export default MyTypography;
