import { createTheme, CssBaseline, ThemeProvider } from "@mui/material";
import { themeOptions } from "./themeOptions";

const theme = createTheme(themeOptions);

export default function ThemeWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
