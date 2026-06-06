import { basename } from '../fs/path/basename';
import { extname } from '../fs/path/extname';

export function compFromFootage(item: FootageItem): CompItem {
	return app.project.items.addComp(
		basename(item.name, extname(item.name)),
		item.width,
		item.height,
		item.pixelAspect,
		item.duration,
		item.frameRate,
	);
}
