import { ChevronDown } from 'lucide-react';
import MuiAccordion, { AccordionProps } from '@mui/material/Accordion';
import MuiAccordionDetails from '@mui/material/AccordionDetails';
import MuiAccordionSummary, { AccordionSummaryProps } from '@mui/material/AccordionSummary';
import { styled } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { greyColor } from '@/Store/Color/grayColor';

const Accordion = styled((props: AccordionProps) => <MuiAccordion disableGutters elevation={0} square {...props} />)(({ theme }) => ({
	border: `1px solid ${theme.palette.divider}`,
	'&:not(:last-child)': {
		borderBottom: 0,
	},
	'&::before': {
		display: 'none',
	},
}));

export default function MyAccordionEl({ panelId, summary, children, expanded, handleChange }: any) {
	const AccordionSummary = styled((props: AccordionSummaryProps) => <MuiAccordionSummary expandIcon={<ChevronDown size={20} />} {...props} />)(
		({ theme }) => ({
			backgroundColor: expanded == panelId ? greyColor(35) : greyColor(20),
			// borderRadius: !expanded ? '4px' : '4px 4px 0 0',
			flexDirection: 'row-reverse',
			'& .MuiAccordionSummary-expandIconWrapper.Mui-expanded': {
				transform: 'rotate(-90deg)',
			},
			'& .MuiAccordionSummary-content': {
				marginLeft: theme.spacing(1),
			},
		}),
	);

	const AccordionDetails = styled(MuiAccordionDetails)(({ theme }) => ({
		padding: theme.spacing(2),
		borderTop: `1px solid ${greyColor(20)}`,
		backgroundColor: greyColor(15),
		// backgroundColor: expanded ? gray[35] : gray[20],
		// borderRadius: expanded ? '4px' : '0 0 4px 4px',
	}));
	return (
		<Accordion expanded={expanded === panelId} onChange={handleChange(panelId)}>
			<AccordionSummary aria-controls={`${panelId}-content`} id={`${panelId}-header`}>
				<Typography>{summary}</Typography>
			</AccordionSummary>
			<AccordionDetails sx={{ overflow: 'hidden' }}>{children}</AccordionDetails>
		</Accordion>
	);
}
