/**
 * Типы файлов по расширению
 * Перенесено из electron/main/fileSistem/getFileTypeByExtname
 */

export enum TypeByExt {
	Images = 'images',
	Video = 'video',
	Audio = 'audio',
	AI = 'ai',
	PSD = 'psd',
	Othes = 'othes',
	Text = 'text',
	Title = 'title',
	Aep = 'aep',
	Moho = 'moho',
	Xlsx = 'xlsx',
}

/**
 * Получить тип файла по расширению
 */
export function getFileTypeByExtname(extname: string): TypeByExt {
	const ext = extname.toLowerCase().replace('.', '');
	
	switch (ext) {
		// Images
		case 'jpg':
		case 'jpeg':
		case 'png':
		case 'tiff':
		case 'tga':
		case 'pdf':
		case 'gif':
		case 'pgf':
			return TypeByExt.Images;
		
		// Video
		case 'avi':
		case 'mov':
		case 'mp4':
		case 'mpeg':
		case 'mpg':
		case 'm2v':
		case 'm4v':
		case 'ts':
		case 'mxf':
		case 'wmv':
		case 'mkv':
			return TypeByExt.Video;
		
		// Audio
		case 'wav':
		case 'mp3':
		case 'aac':
		case 'm4a':
		case 'flac':
		case 'ogg':
		case 'aiff':
		case 'aif':
		case 'opus':
		case 'wma':
			return TypeByExt.Audio;
		
		// Text
		case 'txt':
		case 'json':
			return TypeByExt.Text;
		
		// Title (subtitles)
		case 'vtt':
		case 'lrc':
		case 'srt':
			return TypeByExt.Title;
		
		// AI
		case 'ai':
		case 'eps':
			return TypeByExt.AI;
		
		// PSD
		case 'psd':
		case 'psb':
			return TypeByExt.PSD;
		
		// After Effects
		case 'aep':
			return TypeByExt.Aep;
		
		// Moho
		case 'moho':
			return TypeByExt.Moho;
		
		// Excel
		case 'xlsx':
		case 'tsv':
		case 'csv':
			return TypeByExt.Xlsx;
		
		default:
			return TypeByExt.Othes;
	}
}
