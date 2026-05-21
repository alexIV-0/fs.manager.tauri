import fs from "fs";
// =========================================================================================
// проверяем, есть ли папка и если такой нет - создаем
// =========================================================================================
export const testAndCreateFolder = (_path: string) => {
	console.log("Checking folder:", _path);
	if (fs.existsSync(_path)) return _path;

	fs.mkdirSync(_path, { recursive: true });
	console.log("Folder created:", _path);

	return _path;
};
