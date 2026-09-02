import { IconButton, Tooltip } from '@mui/material';
import { Square, SquareCheck } from 'lucide-react';
import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { CustomNodeData, Property } from '@/NODE_WIN/definitions/types';
import { greyColor, greenColor } from '@/Store/Color/grayColor';
import { serviceSlugFromOptions } from '@/Utils/vendorServices';

interface ExposeToSiteToggleProps {
	property: Property;
}

/**
 * Галочка «показать параметр на сайте».
 * Переключает property.exposedToSite в данных ноды → флаг попадает в options.json
 * (он сериализуется из reactFlow.toObject(), Rust пишет его как есть). Будущий сайт
 * читает options.json и рендерит свойства с exposedToSite===true этими же
 * property-компонентами в виде стека настроек для пользователя.
 */
export default function ExposeToSiteToggle({ property }: ExposeToSiteToggleProps) {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();
	const exposed = property.exposedToSite ?? false;

	const handleToggle = useCallback(() => {
		reactFlow.updateNode(nodeId, (node) => {
			const nodeData = node.data as CustomNodeData;
			const updatedProperties = nodeData.properties.map((p) => {
				if (p.id !== property.id) return p;
				const next = !(p.exposedToSite ?? false);
				const patched: any = { ...p, exposedToSite: next };

				// Поле УЧЁТКИ внешнего сервиса при включении галочки очищаем.
				//
				// Галочка здесь работает как политика «чей ключ и чьи деньги»
				// (VENDOR_KEYS_CONTRACT.md §6.3): снята — наша учётка, стоит — заполняет
				// клиент на сайте. Оставь мы прежнее значение, в `options.json` осталась
				// бы лежать наша метка (обычно тестовая), и рано или поздно её прочли бы
				// как фолбэк — клиент поехал бы на нашем ключе и за наши деньги.
				//
				// Только для полей учётки: у обычного параметра текущее значение — это
				// осмысленный дефолт, и стирать его при показе на сайте незачем.
				const isAccountField = !!serviceSlugFromOptions(patched.controlProps?.options);
				if (next && isAccountField && patched.controlProps?.value) {
					patched.controlProps = { ...patched.controlProps, value: '' };
				}
				return patched;
			}) as Property[];
			return { ...node, data: { ...nodeData, properties: updatedProperties } };
		});
	}, [nodeId, property.id, reactFlow]);

	return (
		<Tooltip title={exposed ? 'Показывается на сайте' : 'Показать на сайте'} placement='top' arrow>
			<IconButton
				disableRipple
				size='small'
				onClick={handleToggle}
				className='nodrag'
				sx={{
					width: 26,
					padding: 0,
					color: exposed ? greenColor(55) : greyColor(40),
					'&:hover': { color: exposed ? greenColor(65) : greyColor(70) },
				}}
			>
				{exposed ? <SquareCheck size={18} strokeWidth={1.5} /> : <Square size={18} strokeWidth={1.25} />}
			</IconButton>
		</Tooltip>
	);
}
