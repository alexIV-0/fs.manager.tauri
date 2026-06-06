export function addIndexOf() {
	//@ts-ignore
	Array.prototype.indexOf = function (elem: any) {
		for (var i = 0; i < this.length; i++) {
			if (this[i] == elem) {
				return i;
			}
		}
		return -1;
	};
}
