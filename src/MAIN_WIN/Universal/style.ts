import { createTheme } from '@mui/material';

const mainBox = {
    p: '5px',
    m: '0',
    width: '100%',
    height: '100vh',
    overflow: 'hidden',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    minWidth: '500px',
    backgroundColor: '#2a2a2a',
};

const buttonStyle = {
    flex: 1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textTransform: 'none',
    width: '-webkit-fill-available',
    height: '26px',
    // backgroundColor: '#ccc',
};

const contentStyle = {
    display: 'flex',
    gab: '5px',
    justifyContent: 'space-between',
    height: '-webkit-fill-available',
    overflow: 'hidden',
    mb: '90px',
};
const bottomBoxStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    p: '0px 5px 5px 5px',
    overflow: 'hidden',
    boxSizing: 'border-box',
};

const infoBarStyle = {
    display: 'flex',
    gap: '5px',
    justifyContent: 'space-between',
    alignItems: 'center',
    overflow: 'hidden',
};
const startButtonBoxStyle = {
    display: 'flex',
    gap: '5px',
    pt: '5px',
    overflow: 'hidden',
    boxSizing: 'border-box',
};

const dividerStyle = {
    mb: '0px',
    color: '#ffffff91',
    borderColor: '#ffffff91',
};

const buttonAlignmentStyle = {
    minWidth: '3px',
    m: '0px 2px',
    color: '#878787',
    p: '2px 3px',
    flex: 1,
};

export const theme = createTheme({
    palette: {
        mode: 'dark',
        background: {
            default: '#212121',
        },
    },
    components: {
        MuiCssBaseline: {
            styleOverrides: {
                body: {
                    overflow: 'hidden',
                    minHeight: '500px',
                },
                '*::-webkit-scrollbar': {
                    display: 'none',
                },
                '*': {
                    msOverflowStyle: 'none',
                    scrollbarWidth: 'none',
                },
            },
        },
    },
});

export // buttonStyle,
// buttonAlignmentStyle,
// contentStyle,
// mainBox,
// bottomBoxStyle,
// infoBarStyle,
// startButtonBoxStyle,
// dividerStyle,
 {};
