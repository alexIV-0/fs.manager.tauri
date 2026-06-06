import { addIndexOf } from '../prototips/addIndexOf';

export function getEffectsFromLayer(_layer: any, _nameArr: string[]) {
	//@ts-ignore
	if (typeof [].indexOf !== 'function') {
		addIndexOf();
	}
	var eff: any = {};
	var effects = _layer.property('ADBE Effect Parade');
	for (var i = 1; i <= effects.numProperties; i++) {
		var effName = effects.property(i).name;
		// var zz = effName.indexOf(_nameArr);
		//@ts-ignore
		var zz = _nameArr.indexOf(effName);

		if (zz != -1) {
			eff[effName] = effects.property(i);
		}
	}
	return eff;
}
