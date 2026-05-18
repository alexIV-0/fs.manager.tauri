import { Divider, Typography } from "@mui/material";
import { dividerStyle } from "../mainStyles";

interface Props {
  text?: string;
  disablePadding?: boolean;
}

function MyDivider(props: Props) {
  const { text, disablePadding } = props;

  const isPadding = typeof disablePadding === "undefined";

  return (
    <Divider textAlign="center" sx={{ ...dividerStyle, p: isPadding ? "3px" : "0" }}>
      {text && (
        <Typography
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {text}
        </Typography>
      )}
    </Divider>
  );
}

export default MyDivider;
