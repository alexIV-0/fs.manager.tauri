let _sendToMW: (type: string, payload: any) => void = () => {};

export function onLoad(api: any) {
	_sendToMW = api.sendToMW;
}

export function sendToMW(type: string, payload: any) {
	_sendToMW(type, payload);
}
