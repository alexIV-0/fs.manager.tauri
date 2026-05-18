import { Button, Typography } from "@mui/material";
import { buttonStyle } from "../mainStyles";

interface Props {
  innerText: string;
  onClick: () => void;
  disabled?: boolean;
  sx?: any;
}

function MyButton(props: Props) {
  const { innerText, onClick, disabled, sx } = props;

  return (
    <Button
      variant="contained"
      sx={{ ...buttonStyle, ...sx }}
      onClick={onClick}
      disabled={disabled}
    >
      <Typography variant="inherit" noWrap>
        {innerText}
      </Typography>
    </Button>
  );
}

export default MyButton;
