import { Box, TextField, Typography } from '@mui/material';

/*
    кастомный textInput для чисел. в начале будет текст или крутилка, её можно отключить
*/

interface CustomTextFieldInterface {
	defaultValue: number;
	inputRef: any;
	onChange: any;
	labelText?: string;
}

function CustomTextField(props: CustomTextFieldInterface) {
	const { defaultValue, inputRef, onChange, labelText } = props;

	return (
		<Box sx={{ display: 'flex' }}>
			{labelText && <Typography sx={{ minWidth: '30px' }}>{labelText}</Typography>}
			<TextField
				disabled
				defaultValue={defaultValue}
				inputRef={inputRef}
				onChange={onChange}
				size='small'
				variant='standard'
				sx={{ width: '50px', '& input': { textAlign: 'center' } }}
				slotProps={{
					input: {
						disableUnderline: true, // Отключаем нижнюю черту
					},
				}}
			/>
		</Box>
	);
}

export default CustomTextField;
