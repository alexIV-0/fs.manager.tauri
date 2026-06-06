// =========================================================================================
// изменяем размер слоя в зависимости от _objPref.scale
// если текст - растягиваем слой на всю эту велечину,
// если цифра - выставляем в зависимости от размера композиции
// _size - если указано, то отталкиваемся от этих размеров, а не от размера композиции
// width - вписать изобрашение по ширине в размер композиции по ширине
// height - то же самое по высоте
// fit - сделать так что бы картир=нка полностью помещалась в композицию и не выходила за края.
// fill - полностью заполнить композицию, часть изображения будет выходить за пределы картинки
// =========================================================================================
export function scaleCurLayer(_layer: any, _scale: 'width' | 'height' | 'fit' | 'fill' | number, _size?: number[]) {
	if (typeof _scale == 'undefined') {
		return 0;
	}

	_scale = !isNaN(Number(_scale)) ? Number(_scale) : _scale;

	var newScale = 100;
	switch (typeof _scale) {
		case 'string':
			var size: any = {
				width: _layer.containingComp.width,
				height: _layer.containingComp.height,
			};
			if (typeof _size != 'undefined') {
				size.width = _size[0];
				size.height = _size[1];
			}
			if (_scale == 'fit' || _scale == 'fill') {
				var sWidth = (size.width / _layer.width) * 100;
				var sHight = (size.height / _layer.height) * 100;
				var testW = (sHight * _layer.width) / 100;
				if (_scale == 'fit') {
					newScale = Math.min(sWidth, sHight);
				} else if (_scale == 'fill') {
					newScale = Math.max(sWidth, sHight);
				}
				// if (testW < size[0]) {
				// 	newScale = (size.width / _layer.width) * 100;
				// } else {
				// 	newScale = sHight;
				// }
			} else {
				newScale = (size[_scale.toLowerCase()] / _layer[_scale.toLowerCase()]) * 100;
			}
			break;
		case 'number':
			newScale = (_layer.containingComp.height * _scale) / _layer.width;
			break;
	}
	_layer.transform.scale.setValue([newScale, newScale]);
	return newScale;
}
