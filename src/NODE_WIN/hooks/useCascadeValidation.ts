import { Edge, useReactFlow } from '@xyflow/react';
import { useCallback } from 'react';
import { CustomNode, CustomNodeData, Property } from '../definitions/types';
import { getPropertyValueAndType } from '../utils/getPropertyData';
import { isValueValid } from '../utils/validation';
import { isEdgeActive } from '../utils/edgeActive';
import { typeOfFile_store } from '@/Store/MainWin/pathPattern_store';

// Тип "сноска" в каскаде — несёт всё что downstream-нода должна знать про upstream,
// без чтения через reactFlow.getNode (которое может вернуть stale state внутри
// одной синхронной рекурсии cascade'а).
type SourceUpdate = {
	properties: Property[];
	isValid: boolean;
	computedOutput: Record<string, { value: any; type: string }> | null;
};

export const useCascadeValidation = () => {
	const reactFlow = useReactFlow();

	// Получить все исходящие edges из ноды (только активные — inactive это история).
	const getOutgoingEdges = useCallback(
		(nodeId: string) => {
			return reactFlow.getEdges().filter((edge) => edge.source === nodeId && isEdgeActive(edge));
		},
		[reactFlow],
	);

	// Получить все входящие edges в ноду (только активные).
	const getIncomingEdges = useCallback(
		(nodeId: string) => {
			return reactFlow.getEdges().filter((edge) => edge.target === nodeId && isEdgeActive(edge));
		},
		[reactFlow],
	);

	// Очистить inheritedValue из property
	const clearInheritedValue = useCallback((property: Property): Property => {
		if (property.controlType === 'autocomplete') {
			return {
				...property,
				controlProps: {
					...property.controlProps,
					inheritedValue: undefined,
				},
			} as Property;
		}

		if (property.controlType === 'textedit') {
			return {
				...property,
				controlProps: {
					...property.controlProps,
					inheritedValue: undefined,
				},
			} as Property;
		}

		if (property.controlType === 'convertSettings') {
			return {
				...property,
				controlProps: {
					...property.controlProps,
					inheritedValue: undefined,
				},
			} as Property;
		}

		// link: значение хранится прямо в value, а не в inheritedValue (см. setInheritedValue ниже).
		// Без очистки value downstream-нода с link-входом остаётся "валидной" после удаления связи.
		if (property.controlType === 'link') {
			return {
				...property,
				controlProps: {
					...property.controlProps,
					value: '',
				},
			} as Property;
		}

		return property;
	}, []);

	// Установить inheritedValue в property
	const setInheritedValue = useCallback((property: Property, inheritedValue: any): Property => {
		if (property.controlType === 'autocomplete') {
			return {
				...property,
				controlProps: {
					...property.controlProps,
					inheritedValue,
				},
			} as Property;
		}

		if (property.controlType === 'link') {
			return {
				...property,
				controlProps: {
					...property.controlProps,
					value: inheritedValue,
				},
			} as Property;
		}

		if (property.controlType === 'textedit') {
			const inherited = Array.isArray(inheritedValue) ? inheritedValue[0] : inheritedValue;
			return {
				...property,
				controlProps: {
					...property.controlProps,
					inheritedValue: typeof inherited === 'string' ? inherited : String(inherited ?? ''),
				},
			} as Property;
		}

		if (property.controlType === 'convertSettings') {
			const arr = Array.isArray(inheritedValue) ? inheritedValue : [inheritedValue].filter(Boolean);
			return {
				...property,
				controlProps: {
					...property.controlProps,
					inheritedValue: arr,
				},
			} as Property;
		}

		return property;
	}, []);

	// Валидировать и обновить одну ноду на основе её входящих связей
	const validateAndUpdateNode = useCallback(
		(nodeId: string, clearedPropertyIds?: string[], sourceUpdates?: Map<string, SourceUpdate>): { isValid: boolean; updatedProperties: Property[]; computedOutput: SourceUpdate['computedOutput'] } => {
			const node = reactFlow.getNode(nodeId) as CustomNode;
			if (!node) {
				return { isValid: false, updatedProperties: [], computedOutput: null };
			}

			// ── DISABLED — нода выключена пользователем ───────────────────────────
			// Не валидируем, не вычисляем output. Downstream автоматически становится
			// orphan (isSourceValid → false).
			if ((node.data as any)?.disabled === true) {
				reactFlow.updateNode(nodeId, (n) => ({
					...n,
					data: { ...n.data, isValid: false, computedOutput: null },
				}));
				return { isValid: false, updatedProperties: (node.data.properties as Property[]) ?? [], computedOutput: null };
			}

			// ── SPY (reroute) — passthrough: out = upstream output ───────────────
			// Свой короткий путь: нет properties, нет output config — type/value
			// просто зеркалятся от upstream-ноды через incoming edge на 'in'.
			if (node.type === 'spy') {
				const incomingEdge = getIncomingEdges(nodeId).find((e) => e.targetHandle === 'in');
				let computedOutput: Record<string, { value: any; type: string }> | null = null;
				let isValid = false;
				if (incomingEdge) {
					// Сперва свежие данные из sourceUpdates, потом fallback в store
					const upd = sourceUpdates?.get(incomingEdge.source);
					const sourceIsValid = upd ? upd.isValid : !!(reactFlow.getNode(incomingEdge.source) as CustomNode | undefined)?.data?.isValid;
					const sourceCO = upd ? upd.computedOutput : ((reactFlow.getNode(incomingEdge.source) as CustomNode | undefined)?.data?.computedOutput as any);
					if (sourceIsValid) {
						const sourceOut = sourceCO?.[incomingEdge.sourceHandle ?? ''];
						if (sourceOut?.type) {
							computedOutput = { out: { value: sourceOut.value, type: sourceOut.type } };
							isValid = true;
						}
					}
				}
				reactFlow.updateNode(nodeId, (n) => ({
					...n,
					data: { ...n.data, isValid, computedOutput },
				}));
				return { isValid, updatedProperties: [], computedOutput };
			}

			// ── LOOP нода — синхронное вычисление computedOutput + isValid ───────
			// Раньше тип `inputInLoop`/`loopInput` писался асинхронно из useEffect в
			// LoopGroupProperty, что гонялось с каскадом и приводило к мерцающей
			// невалидности дочерних нод. Теперь Loop считается прямо здесь, в той же
			// синхронной рекурсии, что и остальные ноды.
			if ((node.data as any)?.executionType === 'loop') {
				const incoming = getIncomingEdges(nodeId);

				// Читаем источник, предпочитая свежие sourceUpdates перед (возможно stale) store.
				const readSource = (srcId: string): { isValid: boolean; computedOutput: any } => {
					const upd = sourceUpdates?.get(srcId);
					if (upd) return { isValid: upd.isValid, computedOutput: upd.computedOutput };
					const n = reactFlow.getNode(srcId) as CustomNode | undefined;
					return { isValid: !!n?.data?.isValid, computedOutput: (n?.data?.computedOutput as any) ?? null };
				};

				const typeFromEdge = (edge: Edge | undefined): string => {
					if (!edge) return '';
					const src = readSource(edge.source);
					if (!src.isValid) return '';
					const t = src.computedOutput?.[edge.sourceHandle ?? '']?.type;
					if (!t) return '';
					return Array.isArray(t) ? (t[0] ?? '') : t;
				};

				// loopInput (внешний массив) → тип, который раздаётся в тело через inputInLoop.
				const loopInputEdge = incoming.find((e) => e.targetHandle === 'loopInput');
				// outputInLoop (результат последней ноды тела) → тип выхода Loop наружу.
				const outputInLoopEdge = incoming.find((e) => e.targetHandle === 'outputInLoop');

				const inputInLoopType = typeFromEdge(loopInputEdge);
				const outputType = typeFromEdge(outputInLoopEdge);

				// Валидность Loop = обе внутренние связи на месте (как было в LoopGroupProperty).
				const isValid = !!loopInputEdge && !!outputInLoopEdge;

				const computedOutput = {
					inputInLoop: { value: null, type: inputInLoopType },
					loopInput: { value: null, type: outputType },
				};

				reactFlow.updateNode(nodeId, (n) => ({
					...n,
					data: { ...n.data, isValid, computedOutput },
				}));

				return { isValid, updatedProperties: (node.data.properties as Property[]) ?? [], computedOutput };
			}

			const nodeData = node.data as CustomNodeData;
			const incomingEdges = getIncomingEdges(nodeId);

			// Обновляем каждое property
			const updatedProperties = nodeData.properties.map((property) => {
				// Если это property нужно очистить (связь разорвана)
				if (clearedPropertyIds?.includes(property.id)) {
					return clearInheritedValue(property);
				}

				// Если это не input property - не трогаем
				if (!property.isInput) return property;

				// Проверяем есть ли входящее соединение для этого property
				const incomingEdge = incomingEdges.find((e) => e.targetHandle === property.id);

				// Если нет соединения - очищаем inheritedValue
				if (!incomingEdge) {
					return clearInheritedValue(property);
				}

				// ── SPY source — passthrough: значение/тип лежат в computedOutput.out.
				// У spy нет properties, поэтому стандартный поиск sourceProperty ниже
				// его бы не нашёл и затёр inheritedValue (валидация downstream падала).
				// Приоритет sourceUpdates над store (защита от stale-read в рекурсии).
				const spySource = reactFlow.getNode(incomingEdge.source) as CustomNode | undefined;
				if (spySource?.type === 'spy') {
					const spyUpd = sourceUpdates?.get(incomingEdge.source);
					const spyValid = spyUpd ? spyUpd.isValid : !!spySource.data?.isValid;
					const spyCO = (spyUpd ? spyUpd.computedOutput : spySource.data?.computedOutput) as
						| Record<string, { value: any; type: string }>
						| null;
					const spyOut = spyCO?.['out'];
					if (!spyValid || !spyOut?.type) {
						return clearInheritedValue(property);
					}
					return setInheritedValue(property, spyOut.value);
				}

				// ✅ КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: Сначала проверяем переданные обновления
				let sourceProperty: Property | undefined;

				const srcUpd = sourceUpdates?.get(incomingEdge.source);
				if (srcUpd) {
					sourceProperty = srcUpd.properties.find((p: Property) => p.id === incomingEdge.sourceHandle);
				} else {
					const sourceNode = reactFlow.getNode(incomingEdge.source) as CustomNode;
					if (!sourceNode) return clearInheritedValue(property);
					sourceProperty = sourceNode.data.properties.find((p: Property) => p.id === incomingEdge.sourceHandle);
				}

				// ── LOOP HANDLE SUPPORT ──────────────────────────────────────────
				// Source — Loop-нода, handle — inputInLoop: такого property у Loop нет,
				// тип лежит в computedOutput['inputInLoop']. Создаём виртуальный property.
				// ВАЖНО: работает в ОБОИХ случаях — и когда Loop уже в sourceUpdates
				// (каскад прошёл A → Loop → B), и когда читаем из store (старт прямо на B).
				// Раньше эта ветка жила только в else и B обнулялась при любом апстрим-апдейте.
				if (!sourceProperty && incomingEdge.sourceHandle === 'inputInLoop') {
					const loopComputedOutput = (srcUpd?.computedOutput ??
						(reactFlow.getNode(incomingEdge.source) as CustomNode | undefined)?.data?.computedOutput) as
						| Record<string, { value: any; type: string }>
						| null
						| undefined;
					const loopOutput = loopComputedOutput?.['inputInLoop'];
					if (loopOutput?.type) {
						sourceProperty = {
							id: 'inputInLoop',
							controlType: 'text',
							controlProps: { value: '' },
							outputType: 'accepted',
							acceptedTypes: [loopOutput.type],
						} as any;
					}
				}

				// console.log('[cascade] sourceProperty:', sourceProperty, '| handle:', incomingEdge.sourceHandle);

				if (!sourceProperty) {
					// console.warn('[cascade] ❌ sourceProperty not found, clearing');
					return clearInheritedValue(property);
				}

				// ✅ Проверяем валидность source ноды — приоритет sourceUpdates над store
				// (store может быть stale в синхронной рекурсии cascade'а сразу после updateNode).
				const sourceUpdate = sourceUpdates?.get(incomingEdge.source);
				const sourceNode = reactFlow.getNode(incomingEdge.source) as CustomNode;

				// Для Loop ноды — считаем валидной если inputInLoop имеет тип
				const isLoopSource =
					incomingEdge.sourceHandle === 'inputInLoop' && (sourceNode?.data as any)?.executionType === 'loop';

				const isSourceValid = isLoopSource
					? !!((sourceUpdate?.computedOutput as any)?.inputInLoop?.type ?? (sourceNode?.data?.computedOutput as any)?.inputInLoop?.type)
					: (sourceUpdate ? sourceUpdate.isValid : (sourceNode?.data.isValid ?? false));

				if (!isSourceValid) {
					return clearInheritedValue(property);
				}

				// Source нода валидна - устанавливаем inheritedValue
				// ✅ КЛЮЧЕВОЙ МОМЕНТ: Накапливаем ВЕСЬ путь из source property

				let accumulatedValue: any = [];

				// Если у source property есть inheritedValue - начинаем с него
				if (sourceProperty.controlType === 'autocomplete' && sourceProperty.controlProps?.inheritedValue !== undefined) {
					const sourceInherited = sourceProperty.controlProps.inheritedValue;
					accumulatedValue = Array.isArray(sourceInherited) ? [...sourceInherited] : [sourceInherited];
				}

				// Добавляем собственное значение source property
				const { value } = getPropertyValueAndType(sourceProperty);
				if (value) {
					const sourceValue = Array.isArray(value) ? value : [value];
					accumulatedValue = Array.isArray(accumulatedValue) ? [...accumulatedValue, ...sourceValue] : sourceValue;
				}

				// Если в source ноде есть входные свойства с outputMarker и они подключены —
				// добавляем их маркеры к значению, передаваемому вниз по цепочке
				const sourceNodeAllProps: Property[] = sourceUpdates?.has(incomingEdge.source)
					? sourceUpdates.get(incomingEdge.source)!.properties
					: ((reactFlow.getNode(incomingEdge.source) as CustomNode)?.data?.properties ?? []);
				const sourceIncoming = getIncomingEdges(incomingEdge.source);
				const markers = sourceNodeAllProps
					.filter((p) => p.isInput && p.outputMarker)
					.filter((p) => sourceIncoming.some((e) => e.targetHandle === p.id))
					.map((p) => p.outputMarker as string);
				if (markers.length > 0) {
					accumulatedValue = [...(Array.isArray(accumulatedValue) ? accumulatedValue : [accumulatedValue].filter(Boolean)), ...markers];
				}

				return setInheritedValue(property, accumulatedValue);
			});

			// Проверяем валидность ноды
			const isValid = updatedProperties.filter((p) => p.required).every(isValueValid);

			// ✅ ИСПРАВЛЕНИЕ: Правильно вычисляем computedOutput с типом
			const outputPropertyId = nodeData.output?.sourceProperty;
			const outputProperty = outputPropertyId ? updatedProperties.find((p) => p.id === outputPropertyId) : null;

			let computedOutput = null;

			if (isValid && outputProperty) {
				const propertyData = getPropertyValueAndType(outputProperty);

				// console.log('🔧 Creating computedOutput:', {
				// 	nodeId,
				// 	outputPropertyId,
				// 	outputProperty,
				// 	propertyData,
				// });

				// ✅ КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: Определяем правильный type
				let outputType = propertyData.type;

				// Для typeByExtension нужно найти реальный тип файла
				if (outputProperty.outputType === 'typeByExtension' && outputProperty.controlType === 'autocomplete') {
					const value = outputProperty.controlProps.value?.[0];
					if (value) {
						const typeOfFileStore = typeOfFile_store.getState().patternStore;
						const fileType = typeOfFileStore.find(
							(type) => type.path && Array.isArray(type.path) && type.path.includes(value.toLowerCase()),
						);

						if (fileType) {
							outputType = fileType.name; // 'video', 'audio', etc.
							// console.log(`✅ Resolved type from extension "${value}": ${outputType}`);
						}
					}
				}

				// Для convertSettings + typeByExtension — берём расширение из s.outputExtension
				if (outputProperty.outputType === 'typeByExtension' && outputProperty.controlType === 'convertSettings') {
					const raw = outputProperty.controlProps?.value;
					if (raw) {
						try {
							const s = JSON.parse(raw);
							const ext: string | undefined = s.outputExtension;
							if (ext) {
								const typeOfFileStore = typeOfFile_store.getState().patternStore;
								const fileType = typeOfFileStore.find(
									(type) => type.path && Array.isArray(type.path) && type.path.includes(ext.toLowerCase()),
								);
								if (fileType) {
									outputType = fileType.name;
								}
							}
						} catch { /* ignore */ }
					}
				}

				// ✅ НОВОЕ: Для outputType === 'accepted' берем тип из inheritedValue
				if (outputProperty.outputType === 'accepted' && outputProperty.controlType === 'link') {
					// Ищем входящее соединение для этого property
					const incomingEdge = incomingEdges.find((e) => e.targetHandle === outputProperty.id);

					if (incomingEdge) {
						const sourceNode = reactFlow.getNode(incomingEdge.source) as any;
						if (sourceNode?.data?.computedOutput) {
							const sourceOutput = sourceNode.data.computedOutput[incomingEdge.sourceHandle as string];
							if (sourceOutput?.type) {
								// ✅ Если тип массив - берем первый элемент
								outputType = Array.isArray(sourceOutput.type) ? sourceOutput.type[0] : sourceOutput.type;
								// console.log(`✅ Inherited type from source: ${outputType}`);
							}
						}
					}
				}

				// ✅ ВАЖНО: Убедимся что type всегда строка, не массив
				if (Array.isArray(outputType)) {
					outputType = outputType[0];
					// console.log('🔧 Type was array, extracted first element:', outputType);
				}

				computedOutput = {
					[outputPropertyId as string]: {
						value: propertyData.value,
						type: outputType, // ✅ Правильный тип (всегда строка)
					},
				};

				// Если у входных свойств есть outputMarker и они подключены — добавляем маркер к значению
				const markers = updatedProperties
					.filter((p) => p.isInput && p.outputMarker)
					.filter((p) => incomingEdges.some((e) => e.targetHandle === p.id))
					.map((p) => p.outputMarker as string);

				if (markers.length > 0) {
					const currentValue = computedOutput[outputPropertyId as string].value;
					const valueArr = Array.isArray(currentValue) ? [...currentValue] : (currentValue ? [currentValue] : []);
					computedOutput = {
						...computedOutput,
						[outputPropertyId as string]: {
							...computedOutput[outputPropertyId as string],
							value: [...valueArr, ...markers],
						},
					};
				}

				// console.log('📤 Final computedOutput:', computedOutput);
			}

			// ✅ Обновляем ноду в reactFlow.
			// Loop-ноды сюда не доходят — они обрабатываются в раннем loop-бранче выше.
			reactFlow.updateNode(nodeId, (n) => ({
				...n,
				data: {
					// n.data вместо nodeData чтобы не затереть параллельные обновления (например disabled),
					// зафиксированные в store после старта validateAndUpdateNode.
					...n.data,
					properties: updatedProperties,
					isValid,
					computedOutput,
				},
			}));

			return { isValid, updatedProperties, computedOutput };
		},
		[getIncomingEdges, clearInheritedValue, setInheritedValue, reactFlow],
	);

	/**
	 * Каскадно пересчитать ноду и всё, что от неё зависит — В ТОПОЛОГИЧЕСКОМ ПОРЯДКЕ.
	 *
	 * Раньше здесь был обход в глубину с одним `visited`, и нода считалась ОДИН раз —
	 * по первому пути, который до неё дошёл. На «ромбе» это давало неверный результат:
	 *
	 *     mainSearch → B → D(вход 1)
	 *     mainSearch → C → D(вход 2)
	 *
	 * обход шёл mainSearch → B → D, и вход 2 брался из СТОРА, потому что `C` в этом
	 * каскаде ещё не считался. Когда очередь доходила до `C`, ребро `C → D` упиралось
	 * в `visited` и `D` уже не пересчитывалась — оставалась со значением от старого `C`.
	 * А накопленное значение уходит в маски и пути, то есть в options.json и в плагины.
	 *
	 * Теперь нода считается ровно один раз, но ТОЛЬКО когда посчитаны все её апстримы
	 * внутри затронутого подграфа. Тот же принцип, что в сборке очереди исполнения
	 * (`createProcessQueue`), — здесь его просто не было.
	 *
	 * @param seed        готовые состояния нод, которые пересчитывать не надо
	 *                    (`handleEdgeRemoval` кладёт сюда только что обновлённый target)
	 * @param includeStart считать ли саму `startNodeId` (false — если её уже посчитали)
	 */
	const cascadeValidation = useCallback(
		(
			startNodeId: string,
			opts?: { seed?: Map<string, SourceUpdate>; includeStart?: boolean },
		) => {
			const includeStart = opts?.includeStart !== false;
			const sourceUpdates = opts?.seed ?? new Map<string, SourceUpdate>();

			// 1. Затронутый подграф — сама нода и все её потомки по АКТИВНЫМ рёбрам.
			const affected = new Set<string>();
			const stack = [startNodeId];
			while (stack.length) {
				const id = stack.pop()!;
				if (affected.has(id)) continue;
				affected.add(id);
				for (const e of getOutgoingEdges(id)) stack.push(e.target);
			}

			// 2. Входящая степень считается ТОЛЬКО по рёбрам внутри подграфа. Рёбра
			//    извне не считаем: их источники не менялись (они не ниже startNodeId),
			//    и их значения корректно читаются из стора.
			const inDegree = new Map<string, number>();
			for (const id of affected) inDegree.set(id, 0);
			for (const id of affected) {
				for (const e of getOutgoingEdges(id)) {
					if (affected.has(e.target)) inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
				}
			}

			const done = new Set<string>();
			const compute = (id: string) => {
				done.add(id);
				if (!includeStart && id === startNodeId) return;
				const { updatedProperties, isValid, computedOutput } = validateAndUpdateNode(id, undefined, sourceUpdates);
				sourceUpdates.set(id, { properties: updatedProperties, isValid, computedOutput });
			};

			// 3. Kahn: снимаем нулевые степени, затем понижаем степени потомкам.
			const queue = [...affected].filter((id) => (inDegree.get(id) ?? 0) === 0);
			while (queue.length) {
				const id = queue.shift()!;
				if (done.has(id)) continue;
				compute(id);
				for (const e of getOutgoingEdges(id)) {
					if (!affected.has(e.target)) continue;
					const left = (inDegree.get(e.target) ?? 1) - 1;
					inDegree.set(e.target, left);
					if (left === 0) queue.push(e.target);
				}
			}

			// 4. Страховка от цикла: узел в цикле до нулевой степени не доходит и в
			//    очередь не попадает. Редактор замкнуть цикл больше не даёт, но в уже
			//    сохранённом флоу он может лежать — такие ноды считаем как есть, лишь
			//    бы не остались вовсе непосчитанными.
			for (const id of affected) {
				if (!done.has(id)) compute(id);
			}
		},
		[validateAndUpdateNode, getOutgoingEdges],
	);

	// Обработка удаления edge
	const handleEdgeRemoval = useCallback(
		(edge: Edge) => {
			if (!edge) return;

			// Явно очищаем конкретное property target-ноды: не полагаемся на то, что
			// ребро уже исчезло из стора.
			const { updatedProperties, isValid, computedOutput } = validateAndUpdateNode(edge.target, [
				edge.targetHandle as string,
			]);

			// Свежее состояние target отдаём каскаду ЗАТРАВКОЙ. Без этого downstream
			// читал target из стора — тот самый stale-read, ради которого `sourceUpdates`
			// и существует; связь удалили, а нода ниже оставалась «валидной».
			cascadeValidation(edge.target, {
				seed: new Map([[edge.target, { properties: updatedProperties, isValid, computedOutput }]]),
				includeStart: false,
			});
		},
		[validateAndUpdateNode, cascadeValidation],
	);

	// Обработка добавления edge
	const handleEdgeAdd = useCallback(
		(targetNodeId: string) => {
			// Обновляем target ноду и всех потомков
			cascadeValidation(targetNodeId);
		},
		[cascadeValidation],
	);

	// Обработка изменения значения в ноде
	const handleNodePropertyChange = useCallback(
		(nodeId: string) => {
			// Обновляем эту ноду и всех потомков
			cascadeValidation(nodeId);
		},
		[cascadeValidation],
	);

	return {
		cascadeValidation,
		validateAndUpdateNode,
		handleEdgeRemoval,
		handleEdgeAdd,
		handleNodePropertyChange,
	};
};
